import type { FetchMessageObject, ListResponse, MailboxObject } from "imapflow";
import { describe, expect, it, vi } from "vitest";

import {
  createImapDraft,
  fetchNewImapMail,
  MAX_UIDS_PER_POLL,
  readImapReplyContext,
  sendImapReply,
} from "./imap-mail";
import type { ImapClient, MailServers, SmtpSession } from "./imap-servers";
import type { ImapSettings } from "./imap-settings";
import {
  DeliveryNotSentError,
  DeliveryRejectedError,
  InvalidGrantError,
  SignInError,
} from "./types";
import type { OutboundReply } from "./types";

const SETTINGS: ImapSettings = {
  address: "me@acme.com",
  username: "me@acme.com",
  password: "secret",
  imapHost: "mail.acme.com",
  imapPort: 993,
  smtpHost: "mail.acme.com",
  smtpPort: 465,
};

const REPLY: OutboundReply = {
  to: "ana@example.com",
  subject: "Re: Opening hours",
  body: "We open at 9.",
  providerMessageId: "7:42",
  threadId: null,
  messageId: "<leren-1@leren.local>",
  inReplyTo: "<original@example.com>",
  references: "<first@example.com> <original@example.com>",
};

/** Builds the raw source of a plain-text message, with any extra header lines. */
function source(uid: number, ...extraHeaders: string[]): Buffer {
  const headers = [
    "From: Ana <ana@example.com>",
    "To: me@acme.com",
    "Cc: Bo <bo@example.com>",
    `Subject: Message ${uid}`,
    `Message-ID: <m${uid}@example.com>`,
    ...extraHeaders,
    "Content-Type: text/plain; charset=utf-8",
  ];

  return Buffer.from(`${headers.join("\r\n")}\r\n\r\nBody of ${uid}`);
}

function mailbox(uidValidity: number, uidNext: number): MailboxObject {
  return {
    path: "INBOX",
    delimiter: "/",
    flags: new Set(),
    uidValidity: BigInt(uidValidity),
    uidNext,
    exists: uidNext - 1,
  };
}

function listed(path: string, specialUse?: string): ListResponse {
  return {
    path,
    pathAsListed: path,
    name: path,
    delimiter: "/",
    parent: [],
    parentPath: "",
    flags: new Set(),
    specialUse,
    listed: true,
    subscribed: true,
  };
}

/** A fake IMAP client whose inbox holds `messages`, keyed by UID. */
function createClient(options: {
  uidValidity?: number;
  uidNext?: number;
  messages?: Record<number, Buffer | undefined>;
  mailboxes?: ListResponse[];
}) {
  const messages = options.messages ?? {};

  const client = {
    mailboxOpen: vi.fn<ImapClient["mailboxOpen"]>(async () =>
      mailbox(options.uidValidity ?? 7, options.uidNext ?? 1),
    ),
    fetch: vi.fn((range: unknown) => {
      const [from, to] = String(range).split(":").map(Number);

      return (async function* () {
        for (const [uid, raw] of Object.entries(messages)) {
          if (Number(uid) >= (from ?? 0) && Number(uid) <= (to ?? 0)) {
            const message: FetchMessageObject = { seq: Number(uid), uid: Number(uid), source: raw };

            yield message;
          }
        }
      })();
    }),
    fetchOne: vi.fn<ImapClient["fetchOne"]>(async () => false),
    list: vi.fn<ImapClient["list"]>(async () => options.mailboxes ?? []),
    append: vi.fn<ImapClient["append"]>(async (path) => ({ destination: String(path), uid: 5 })),
    logout: vi.fn<ImapClient["logout"]>(async () => {}),
  } satisfies ImapClient;

  return client;
}

function createSmtp() {
  return {
    send: vi.fn<SmtpSession["send"]>(async () => "250 2.0.0 Ok: queued"),
    quit: vi.fn(),
  } satisfies SmtpSession;
}

function serversOf(client: ImapClient, smtp: SmtpSession = createSmtp()): MailServers {
  return { openImap: vi.fn(async () => client), openSmtp: vi.fn(async () => smtp) };
}

describe("fetchNewImapMail", () => {
  it("returns the current position as a baseline without a cursor", async () => {
    const client = createClient({ uidValidity: 7, uidNext: 51 });

    expect(await fetchNewImapMail(serversOf(client), SETTINGS, null)).toEqual({
      emails: [],
      cursor: JSON.stringify({ uidValidity: "7", uid: 50 }),
      baseline: true,
      unreadable: [],
    });
    expect(client.mailboxOpen).toHaveBeenCalledWith("INBOX", { readOnly: true });
    expect(client.logout).toHaveBeenCalledOnce();
  });

  it("starts again from the current position when the inbox was renumbered", async () => {
    const client = createClient({ uidValidity: 8, uidNext: 3 });

    const result = await fetchNewImapMail(
      serversOf(client),
      SETTINGS,
      JSON.stringify({ uidValidity: "7", uid: 40 }),
    );

    expect(result).toMatchObject({ baseline: true, cursor: '{"uidValidity":"8","uid":2}' });
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it("reads the messages after the cursor oldest first and moves the cursor to the last UID", async () => {
    const client = createClient({
      uidNext: 13,
      messages: { 12: source(12, "In-Reply-To: <x@example.com>"), 11: source(11) },
    });

    const result = await fetchNewImapMail(
      serversOf(client),
      SETTINGS,
      JSON.stringify({ uidValidity: "7", uid: 10 }),
    );

    expect(client.fetch).toHaveBeenCalledWith(
      "11:12",
      { uid: true, source: true, internalDate: true },
      { uid: true },
    );
    expect(result.baseline).toBe(false);
    expect(result.cursor).toBe(JSON.stringify({ uidValidity: "7", uid: 12 }));
    expect(result.emails).toEqual([
      expect.objectContaining({
        providerMessageId: "7:11",
        providerThreadId: null,
        from: "ana@example.com",
        to: ["me@acme.com"],
        cc: ["bo@example.com"],
        subject: "Message 11",
        body: "Body of 11",
        isReply: false,
        isBulk: false,
      }),
      expect.objectContaining({ providerMessageId: "7:12", isReply: true }),
    ]);
  });

  it("reads at most a fixed number of UIDs and leaves the rest to the next poll", async () => {
    const client = createClient({ uidNext: 1000 });

    const result = await fetchNewImapMail(
      serversOf(client),
      SETTINGS,
      JSON.stringify({ uidValidity: "7", uid: 10 }),
    );

    expect(client.fetch).toHaveBeenCalledWith(
      `11:${10 + MAX_UIDS_PER_POLL}`,
      expect.anything(),
      expect.anything(),
    );
    expect(result.cursor).toBe(JSON.stringify({ uidValidity: "7", uid: 10 + MAX_UIDS_PER_POLL }));
  });

  it("reports a message without a source as unreadable and still moves past it", async () => {
    const client = createClient({ uidNext: 12, messages: { 11: undefined } });

    const result = await fetchNewImapMail(
      serversOf(client),
      SETTINGS,
      JSON.stringify({ uidValidity: "7", uid: 10 }),
    );

    expect(result).toMatchObject({ emails: [], unreadable: ["7:11"] });
    expect(result.cursor).toBe(JSON.stringify({ uidValidity: "7", uid: 11 }));
  });

  it("throws InvalidGrantError when the server refuses the password", async () => {
    const servers: MailServers = {
      openImap: vi.fn(async () => {
        throw new SignInError("authentication_failed", "refused");
      }),
      openSmtp: vi.fn(),
    };

    await expect(fetchNewImapMail(servers, SETTINGS, null)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it("throws any other failure to open the session as it is, so the poll is retried", async () => {
    const failure = new SignInError("server_unreachable", "down");

    const servers: MailServers = {
      openImap: vi.fn().mockRejectedValue(failure),
      openSmtp: vi.fn(),
    };

    await expect(fetchNewImapMail(servers, SETTINGS, null)).rejects.toBe(failure);
  });
});

describe("readImapReplyContext", () => {
  it("reads the headers of the original by its UID", async () => {
    const client = createClient({ uidValidity: 7, uidNext: 50 });

    client.fetchOne.mockResolvedValueOnce({
      seq: 1,
      uid: 42,
      headers: Buffer.from(
        "Message-ID: <original@example.com>\r\nReferences: <first@example.com>\r\n <second@example.com>\r\nReply-To: Desk <desk@example.com>\r\n",
      ),
    });

    expect(await readImapReplyContext(serversOf(client), SETTINGS, "7:42")).toEqual({
      messageId: "<original@example.com>",
      references: "<first@example.com> <second@example.com>",
      replyTo: "desk@example.com",
    });
    expect(client.fetchOne).toHaveBeenCalledWith(
      "42",
      { uid: true, headers: ["message-id", "references", "reply-to"] },
      { uid: true },
    );
  });

  it("fails when the inbox was renumbered since the original was read", async () => {
    const client = createClient({ uidValidity: 8, uidNext: 50 });

    await expect(readImapReplyContext(serversOf(client), SETTINGS, "7:42")).rejects.toThrow(
      /renumbered/,
    );
  });
});

describe("createImapDraft", () => {
  it("appends the reply to the Drafts mailbox with the deliverer's Message-ID", async () => {
    const client = createClient({ mailboxes: [listed("INBOX"), listed("Entwürfe", "\\Drafts")] });

    const receipt = await createImapDraft(serversOf(client), SETTINGS, REPLY);

    expect(receipt).toEqual({
      id: "<leren-1@leren.local>",
      response: { mailbox: "Entwürfe", uid: 5 },
    });

    const [path, raw, flags] = client.append.mock.calls[0] ?? [];
    const text = String(raw);

    expect(path).toBe("Entwürfe");
    expect(flags).toEqual(["\\Draft", "\\Seen"]);
    expect(text).toContain("Message-ID: <leren-1@leren.local>");
    expect(text).toContain("In-Reply-To: <original@example.com>");
    expect(text).toContain("References: <first@example.com> <original@example.com>");
    expect(text).toContain("From: me@acme.com");
  });

  it("falls back to a mailbox named Drafts when none has the special use", async () => {
    const client = createClient({ mailboxes: [listed("INBOX.Drafts")] });

    await createImapDraft(serversOf(client), SETTINGS, REPLY);

    expect(client.append).toHaveBeenCalledWith(
      "INBOX.Drafts",
      expect.anything(),
      expect.anything(),
    );
  });

  it("rejects the delivery when the account has no Drafts mailbox", async () => {
    const client = createClient({ mailboxes: [listed("INBOX")] });

    await expect(createImapDraft(serversOf(client), SETTINGS, REPLY)).rejects.toBeInstanceOf(
      DeliveryRejectedError,
    );
  });

  it("rejects the delivery when the server refuses the append", async () => {
    const client = createClient({ mailboxes: [listed("Drafts", "\\Drafts")] });

    client.append.mockRejectedValueOnce(Object.assign(new Error("no"), { responseStatus: "NO" }));

    await expect(createImapDraft(serversOf(client), SETTINGS, REPLY)).rejects.toBeInstanceOf(
      DeliveryRejectedError,
    );
  });

  it("leaves the outcome unknown when the connection fails during the append", async () => {
    const client = createClient({ mailboxes: [listed("Drafts", "\\Drafts")] });

    client.append.mockRejectedValueOnce(new Error("Connection closed"));

    const failure = await createImapDraft(serversOf(client), SETTINGS, REPLY).catch(
      (error: unknown) => error,
    );

    expect(failure).not.toBeInstanceOf(DeliveryNotSentError);
    expect(failure).not.toBeInstanceOf(DeliveryRejectedError);
  });
});

describe("sendImapReply", () => {
  it("sends the reply over SMTP and saves a copy in the Sent mailbox", async () => {
    const client = createClient({ mailboxes: [listed("Sent Items", "\\Sent")] });
    const smtp = createSmtp();

    const receipt = await sendImapReply(serversOf(client, smtp), SETTINGS, REPLY);

    expect(receipt).toEqual({
      id: "<leren-1@leren.local>",
      response: { smtp: "250 2.0.0 Ok: queued", sentCopy: "saved in Sent Items" },
    });
    expect(smtp.send).toHaveBeenCalledWith(
      { from: "me@acme.com", to: ["ana@example.com"] },
      expect.any(Buffer),
    );
    expect(smtp.quit).toHaveBeenCalledOnce();
    expect(client.append).toHaveBeenCalledWith("Sent Items", expect.any(Buffer), ["\\Seen"]);
  });

  it("keeps a sent reply delivered when its copy cannot be saved", async () => {
    const client = createClient({});
    const smtp = createSmtp();

    const servers: MailServers = {
      openImap: vi.fn().mockRejectedValue(new SignInError("server_unreachable", "down")),
      openSmtp: vi.fn(async () => smtp),
    };

    const receipt = await sendImapReply(servers, SETTINGS, REPLY);

    expect(receipt.response).toMatchObject({ sentCopy: expect.stringMatching(/^failed/) });
    expect(client.append).not.toHaveBeenCalled();
  });

  it.each([
    [421, DeliveryNotSentError],
    [550, DeliveryRejectedError],
  ])("maps an SMTP refusal with %i", async (responseCode, expected) => {
    const smtp = createSmtp();

    smtp.send.mockRejectedValueOnce(Object.assign(new Error("refused"), { responseCode }));

    await expect(
      sendImapReply(serversOf(createClient({}), smtp), SETTINGS, REPLY),
    ).rejects.toBeInstanceOf(expected);
    expect(smtp.quit).toHaveBeenCalledOnce();
  });

  it("leaves the outcome unknown when the connection fails while the reply is handed over", async () => {
    const smtp = createSmtp();

    smtp.send.mockRejectedValueOnce(Object.assign(new Error("closed"), { code: "ECONNECTION" }));

    const failure = await sendImapReply(serversOf(createClient({}), smtp), SETTINGS, REPLY).catch(
      (error: unknown) => error,
    );

    expect(failure).not.toBeInstanceOf(DeliveryNotSentError);
    expect(failure).not.toBeInstanceOf(DeliveryRejectedError);
  });

  it.each([
    ["authentication_failed", InvalidGrantError],
    ["server_unreachable", DeliveryNotSentError],
  ] as const)("maps a failure to open the SMTP session for %s", async (reason, expected) => {
    const servers: MailServers = {
      openImap: vi.fn(),
      openSmtp: vi.fn().mockRejectedValue(new SignInError(reason, "failed")),
    };

    await expect(sendImapReply(servers, SETTINGS, REPLY)).rejects.toBeInstanceOf(expected);
  });
});
