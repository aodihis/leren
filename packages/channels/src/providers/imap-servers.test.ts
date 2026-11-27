import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImapSettings } from "./imap-settings";

type Callback = (error?: Error | null, info?: { response: string }) => void;

const imap = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  connect: vi.fn<() => Promise<void>>(),
  close: vi.fn(),
}));

const smtp = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  connect: vi.fn<(callback: Callback) => void>(),
  login: vi.fn<(credentials: unknown, callback: Callback) => void>(),
  send: vi.fn<(envelope: unknown, message: Buffer, callback: Callback) => void>(),
  close: vi.fn(),
  quit: vi.fn(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(options: Record<string, unknown>) {
      imap.options.push(options);
    }

    on = vi.fn();
    connect = imap.connect;
    close = imap.close;
  },
}));

vi.mock("nodemailer/lib/smtp-connection", () => ({
  default: class {
    constructor(options: Record<string, unknown>) {
      smtp.options.push(options);
    }

    on = vi.fn();
    connect = smtp.connect;
    login = smtp.login;
    send = smtp.send;
    close = smtp.close;
    quit = smtp.quit;
  },
}));

const { createMailServers } = await import("./imap-servers");
const { SignInError } = await import("./types");

const settings: ImapSettings = {
  address: "ada@mail.test",
  username: "ada",
  password: "secret",
  imapHost: "imap.mail.test",
  imapPort: 993,
  smtpHost: "smtp.mail.test",
  smtpPort: 465,
};

const publicHost = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

/** The reason of the `SignInError` that `promise` rejects with. */
async function reasonOf(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(SignInError);

  return (error as InstanceType<typeof SignInError>).reason;
}

describe("createMailServers", () => {
  beforeEach(() => {
    imap.options.length = 0;
    smtp.options.length = 0;
    imap.connect.mockResolvedValue(undefined);
    smtp.connect.mockImplementation((callback) => callback());
    smtp.login.mockImplementation((_credentials, callback) => callback());
  });

  describe("openImap", () => {
    it("connects to the checked address with implicit TLS on port 993 and verifies the host name", async () => {
      await createMailServers(publicHost).openImap(settings);

      expect(imap.options[0]).toMatchObject({
        host: "93.184.216.34",
        port: 993,
        secure: true,
        doSTARTTLS: undefined,
        servername: "imap.mail.test",
        tls: { servername: "imap.mail.test", rejectUnauthorized: true },
        auth: { user: "ada", pass: "secret" },
      });
    });

    it("requires STARTTLS on another port", async () => {
      await createMailServers(publicHost).openImap({ ...settings, imapPort: 143 });

      expect(imap.options[0]).toMatchObject({ secure: false, doSTARTTLS: true });
    });

    it("closes the client and explains a refused sign-in", async () => {
      imap.connect.mockRejectedValue(
        Object.assign(new Error("no"), { authenticationFailed: true }),
      );

      expect(await reasonOf(createMailServers(publicHost).openImap(settings))).toBe(
        "authentication_failed",
      );
      expect(imap.close).toHaveBeenCalled();
    });

    it("refuses a host that resolves to a private address", async () => {
      const privateHost = vi.fn(async () => [{ address: "10.0.0.5", family: 4 }]);

      expect(await reasonOf(createMailServers(privateHost).openImap(settings))).toBe(
        "host_not_allowed",
      );
      expect(imap.options).toHaveLength(0);
    });

    it("reports a host that cannot be resolved as unreachable", async () => {
      const unknownHost = vi.fn(async () => {
        throw new Error("ENOTFOUND");
      });

      expect(await reasonOf(createMailServers(unknownHost).openImap(settings))).toBe(
        "server_unreachable",
      );
    });
  });

  describe("openSmtp", () => {
    it("signs in with implicit TLS on port 465, sends a message and quits", async () => {
      smtp.send.mockImplementation((_envelope, _message, callback) =>
        callback(null, { response: "250 OK" }),
      );

      const session = await createMailServers(publicHost).openSmtp(settings);

      const answer = await session.send(
        { from: "ada@mail.test", to: ["bo@x.test"] },
        Buffer.from("Hi"),
      );

      session.quit();

      expect(smtp.options[0]).toMatchObject({
        host: "93.184.216.34",
        port: 465,
        secure: true,
        requireTLS: false,
        tls: { servername: "smtp.mail.test", rejectUnauthorized: true },
      });
      expect(smtp.login).toHaveBeenCalledWith(
        { user: "ada", pass: "secret" },
        expect.any(Function),
      );
      expect(answer).toBe("250 OK");
      expect(smtp.quit).toHaveBeenCalledOnce();
    });

    it("requires STARTTLS on another port", async () => {
      await createMailServers(publicHost).openSmtp({ ...settings, smtpPort: 587 });

      expect(smtp.options[0]).toMatchObject({ secure: false, requireTLS: true });
    });

    it("rejects a message that the server refuses", async () => {
      smtp.send.mockImplementation((_envelope, _message, callback) =>
        callback(Object.assign(new Error("refused"), { responseCode: 550 })),
      );

      const session = await createMailServers(publicHost).openSmtp(settings);

      await expect(
        session.send({ from: "ada@mail.test", to: ["bo@x.test"] }, Buffer.from("Hi")),
      ).rejects.toThrow("refused");
    });

    it.each([
      [
        "a refused sign-in",
        () =>
          smtp.login.mockImplementation((_c, callback) =>
            callback(Object.assign(new Error("auth"), { code: "EAUTH", responseCode: 535 })),
          ),
        "authentication_failed",
      ],
      [
        "a failed connection",
        () =>
          smtp.connect.mockImplementation((callback) =>
            callback(Object.assign(new Error("tls"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })),
          ),
        "encryption_failed",
      ],
    ])("closes the connection and explains %s", async (_name, arrange, reason) => {
      arrange();

      expect(await reasonOf(createMailServers(publicHost).openSmtp(settings))).toBe(reason);
      expect(smtp.close).toHaveBeenCalled();
    });
  });
});
