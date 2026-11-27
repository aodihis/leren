import type { MailboxObject } from "imapflow";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createImapProvider } from "./imap";
import type { ImapClient, MailServers, SmtpSession } from "./imap-servers";
import { imapOpenFailure, smtpOpenFailure } from "./imap-servers";
import { SignInError } from "./types";

const SETTINGS = {
  address: "Me@Acme.com",
  password: "secret",
  imapHost: "Mail.Acme.com",
  imapPort: 993,
  smtpHost: "smtp.acme.com",
  smtpPort: 587,
};

const INBOX: MailboxObject = {
  path: "INBOX",
  delimiter: "/",
  flags: new Set(),
  uidValidity: 7n,
  uidNext: 51,
  exists: 50,
};

function createServers() {
  const client = {
    mailboxOpen: vi.fn<ImapClient["mailboxOpen"]>(async () => INBOX),
    fetch: vi.fn<ImapClient["fetch"]>(),
    fetchOne: vi.fn<ImapClient["fetchOne"]>(),
    list: vi.fn<ImapClient["list"]>(),
    append: vi.fn<ImapClient["append"]>(),
    logout: vi.fn<ImapClient["logout"]>(async () => {}),
  } satisfies ImapClient;

  const smtp = { send: vi.fn<SmtpSession["send"]>(), quit: vi.fn() } satisfies SmtpSession;

  const servers = {
    openImap: vi.fn<MailServers["openImap"]>(async () => client),
    openSmtp: vi.fn<MailServers["openSmtp"]>(async () => smtp),
  } satisfies MailServers;

  return { client, smtp, servers };
}

describe("createImapProvider", () => {
  it("signs in to both servers and returns the account with the position of the inbox", async () => {
    const { client, smtp, servers } = createServers();

    const account = await createImapProvider(servers).signIn(SETTINGS);

    const stored = {
      address: "me@acme.com",
      password: "secret",
      imapHost: "mail.acme.com",
      imapPort: 993,
      smtpHost: "smtp.acme.com",
      smtpPort: 587,
      username: "me@acme.com",
    };

    expect(account).toEqual({
      providerAccountId: "mail.acme.com/me@acme.com",
      label: "me@acme.com",
      tokens: { accessToken: JSON.stringify(stored), refreshToken: null, expiresAt: null },
      syncCursor: JSON.stringify({ uidValidity: "7", uid: 50 }),
    });
    expect(servers.openImap).toHaveBeenCalledWith(stored);
    expect(client.logout).toHaveBeenCalledOnce();
    expect(servers.openSmtp).toHaveBeenCalledWith(stored);
    expect(smtp.quit).toHaveBeenCalledOnce();
  });

  it("keeps a user name that differs from the address", async () => {
    const { servers } = createServers();

    const account = await createImapProvider(servers).signIn({ ...SETTINGS, username: "me" });

    expect(account.providerAccountId).toBe("mail.acme.com/me");
  });

  it("does not try SMTP when the IMAP sign-in fails", async () => {
    const { servers } = createServers();

    servers.openImap.mockRejectedValueOnce(new SignInError("authentication_failed", "refused"));

    await expect(createImapProvider(servers).signIn(SETTINGS)).rejects.toMatchObject({
      reason: "authentication_failed",
    });
    expect(servers.openSmtp).not.toHaveBeenCalled();
  });

  it.each([
    { imapPort: 110 },
    { smtpPort: 25 },
    { imapHost: "mail.acme.com/evil" },
    { address: "not an address" },
    { password: "" },
  ])("refuses settings with %o before connecting", async (change) => {
    const { servers } = createServers();

    await expect(
      createImapProvider(servers).signIn({ ...SETTINGS, ...change }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(servers.openImap).not.toHaveBeenCalled();
  });

  it("never expires its credentials and has nothing to revoke", async () => {
    const tokens = { accessToken: "{}", refreshToken: null, expiresAt: null };
    const provider = createImapProvider(createServers().servers);

    expect(await provider.refresh(tokens)).toBe(tokens);
    await expect(provider.revoke(tokens)).resolves.toBeUndefined();
  });
});

describe("classifying a failure to open a session", () => {
  it.each([
    [{ authenticationFailed: true }, "authentication_failed"],
    [{ serverResponseCode: "AUTHENTICATIONFAILED" }, "authentication_failed"],
    [{ tlsFailed: true }, "encryption_failed"],
    [{ code: "CERT_HAS_EXPIRED" }, "encryption_failed"],
    [{ code: "ECONNREFUSED" }, "server_unreachable"],
    [{ code: "CONNECT_TIMEOUT" }, "server_unreachable"],
  ])("reads the IMAP error %o as %s", (details, reason) => {
    expect(imapOpenFailure(Object.assign(new Error("failed"), details))).toBe(reason);
  });

  it.each([
    [{ code: "EAUTH", responseCode: 535 }, "authentication_failed"],
    [{ code: "ETLS" }, "encryption_failed"],
    [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "encryption_failed"],
    [{ code: "ECONNECTION" }, "server_unreachable"],
  ])("reads the SMTP error %o as %s", (details, reason) => {
    expect(smtpOpenFailure(Object.assign(new Error("failed"), details))).toBe(reason);
  });
});
