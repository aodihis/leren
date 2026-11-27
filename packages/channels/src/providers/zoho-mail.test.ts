import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { DeliveryNotSentError, DeliveryRejectedError } from "./types";
import type { OutboundReply } from "./types";
import {
  createZohoDraft,
  fetchNewZohoMail,
  readZohoPosition,
  readZohoReplyContext,
  sendZohoReply,
} from "./zoho-mail";

const API = "https://mail.zoho.com";

const ACCOUNTS = {
  data: [{ accountId: "100", zuid: "7", type: "ZOHO_ACCOUNT", primaryEmailAddress: "Me@Acme.com" }],
};

const FOLDERS = {
  data: [
    { folderId: "9", folderType: "Inbox", path: "/Projects" },
    { folderId: "1", folderType: "Inbox", path: "/Inbox" },
    { folderId: "2", folderType: "Sent", path: "/Sent" },
  ],
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function listed(messageId: string, receivedTime: number) {
  return {
    messageId,
    folderId: "1",
    threadId: "t1",
    receivedTime: String(receivedTime),
    fromAddress: "ana@example.com",
    subject: `Subject ${messageId}`,
  };
}

function header(fields: Record<string, string>) {
  return respond({
    data: {
      headerContent: Object.fromEntries(
        Object.entries(fields).map(([name, value]) => [name, [value]]),
      ),
    },
  });
}

/**
 * Answers each request by its path, so a test states what the mailbox holds and not the order of
 * the requests.
 */
function mailbox(routes: Record<string, (url: URL) => Response>): Mock<typeof fetch> {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const route = Object.entries(routes).find(([path]) => url.pathname.endsWith(path));

    return route ? route[1](url) : respond({}, 404);
  });
}

const CURSOR = JSON.stringify({ accountId: "100", folderId: "1", after: 1000, seen: ["m1"] });

describe("readZohoPosition", () => {
  it("starts after the newest message of the inbox, not of a folder that is also of type Inbox", async () => {
    const send = mailbox({
      "/api/accounts": () => respond(ACCOUNTS),
      "/folders": () => respond(FOLDERS),
      "/messages/view": () => respond({ data: [listed("m2", 2000), listed("m1", 1000)] }),
    });

    expect(JSON.parse(await readZohoPosition(send, API, "token"))).toEqual({
      accountId: "100",
      folderId: "1",
      after: 2000,
      seen: ["m2"],
    });
    expect(send.mock.calls[0]?.[1]?.headers).toEqual({ authorization: "Zoho-oauthtoken token" });
  });
});

describe("fetchNewZohoMail", () => {
  it("returns the mail received after the cursor, oldest first, and moves the cursor", async () => {
    const send = mailbox({
      "/messages/view": () =>
        respond({ data: [listed("m3", 3000), listed("m2", 1000), listed("m1", 1000)] }),
      "/header": (url) =>
        url.pathname.includes("/m3/")
          ? header({ From: "Ana <ana@example.com>", To: "me@acme.com", "List-Unsubscribe": "<x>" })
          : header({ From: "bo@example.com", To: "me@acme.com", "In-Reply-To": "<a@b>" }),
      "/content": () => respond({ data: { content: "<div>Hello &amp; welcome</div>" } }),
    });

    const result = await fetchNewZohoMail(send, API, "token", CURSOR);

    expect(result.emails.map((email) => email.providerMessageId)).toEqual(["1:m2", "1:m3"]);
    expect(result.emails[1]).toMatchObject({
      from: "ana@example.com",
      to: ["me@acme.com"],
      subject: "Subject m3",
      body: "Hello & welcome",
      isBulk: true,
      receivedAt: new Date(3000),
    });
    expect(result.emails[0]).toMatchObject({ isReply: true });
    expect(JSON.parse(result.cursor)).toMatchObject({ after: 3000, seen: ["m3"] });
    expect(result.baseline).toBe(false);
  });

  it("keeps the cursor and records nothing when no new mail arrived", async () => {
    const send = mailbox({ "/messages/view": () => respond({ data: [listed("m1", 1000)] }) });

    expect(await fetchNewZohoMail(send, API, "token", CURSOR)).toEqual({
      emails: [],
      cursor: CURSOR,
      baseline: false,
      unreadable: [],
    });
  });

  it("skips a message deleted after it was listed and reports one that cannot be read", async () => {
    const send = mailbox({
      "/messages/view": () => respond({ data: [listed("gone", 3000), listed("broken", 2000)] }),
      "/header": (url) =>
        url.pathname.includes("/gone/") ? respond({}, 404) : respond({ data: {} }),
    });

    const result = await fetchNewZohoMail(send, API, "token", CURSOR);

    expect(result.emails).toEqual([]);
    expect(result.unreadable).toEqual(["1:broken"]);
  });

  it("starts from the current position when the cursor cannot be read", async () => {
    const send = mailbox({
      "/api/accounts": () => respond(ACCOUNTS),
      "/folders": () => respond(FOLDERS),
      "/messages/view": () => respond({ data: [] }),
    });

    const result = await fetchNewZohoMail(send, API, "token", "not a cursor");

    expect(result).toMatchObject({ emails: [], baseline: true });
    expect(JSON.parse(result.cursor)).toMatchObject({ after: 0, seen: [] });
  });

  it("fails without moving the cursor when a message cannot be fetched", async () => {
    const send = mailbox({
      "/messages/view": () => respond({ data: [listed("m2", 2000)] }),
      "/header": () => respond({}, 500),
    });

    await expect(fetchNewZohoMail(send, API, "token", CURSOR)).rejects.toThrow(/status 500/);
  });
});

describe("readZohoReplyContext", () => {
  it("reads the Message-ID, References and Reply-To of the original from its folder", async () => {
    const send = mailbox({
      "/api/accounts": () => respond(ACCOUNTS),
      "/header": () =>
        header({
          "Message-ID": "<original@example.com>",
          References: "<first@example.com>",
          "Reply-To": "Support <Support@Example.com>",
        }),
    });

    expect(await readZohoReplyContext(send, API, "token", "1:m1")).toEqual({
      messageId: "<original@example.com>",
      references: "<first@example.com>",
      replyTo: "support@example.com",
    });
    expect(String(send.mock.calls[1]?.[0])).toBe(
      `${API}/api/accounts/100/folders/1/messages/m1/header?raw=false`,
    );
  });
});

const REPLY: OutboundReply = {
  to: "ana@example.com",
  subject: "Re: Opening hours",
  body: "We open at 9.",
  providerMessageId: "1:m1",
  threadId: "t1",
  messageId: "<leren-1@leren.local>",
  inReplyTo: "<original@example.com>",
  references: "<first@example.com> <original@example.com>",
};

function bodyOf(send: Mock<typeof fetch>, call: number): Record<string, unknown> {
  return JSON.parse(String(send.mock.calls[call]?.[1]?.body)) as Record<string, unknown>;
}

describe("createZohoDraft and sendZohoReply", () => {
  it("saves a plain-text draft from the account's address that names the original", async () => {
    const answer = { status: { code: 200 }, data: { messageId: "d1" } };

    const send = mailbox({
      "/api/accounts": () => respond(ACCOUNTS),
      "/api/accounts/100/messages": () => respond(answer),
    });

    expect(await createZohoDraft(send, API, "token", REPLY)).toEqual({
      id: "d1",
      response: answer,
    });
    expect(bodyOf(send, 1)).toEqual({
      fromAddress: "me@acme.com",
      toAddress: "ana@example.com",
      subject: "Re: Opening hours",
      content: "We open at 9.",
      mailFormat: "plaintext",
      mode: "draft",
      inReplyTo: "<original@example.com>",
      refHeader: "<first@example.com> <original@example.com>",
    });
  });

  it("sends the reply with the reply action on the original", async () => {
    const send = mailbox({
      "/api/accounts": () => respond(ACCOUNTS),
      "/api/accounts/100/messages/m1": () =>
        respond({ status: { code: 200 }, data: { messageId: "s1" } }),
    });

    expect(await sendZohoReply(send, API, "token", REPLY)).toMatchObject({ id: "s1" });
    expect(bodyOf(send, 1)).toMatchObject({
      fromAddress: "me@acme.com",
      toAddress: "ana@example.com",
      action: "reply",
    });
  });

  it("reports an unknown outcome when Zoho accepts the reply without naming its id", async () => {
    const send = mailbox({
      "/api/accounts": () => respond(ACCOUNTS),
      "/api/accounts/100/messages/m1": () => respond({ status: { code: 200 } }),
    });

    const failure = await sendZohoReply(send, API, "token", REPLY).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DeliveryNotSentError);
    expect(failure).not.toBeInstanceOf(DeliveryRejectedError);
  });

  it.each([
    [401, DeliveryNotSentError],
    [429, DeliveryNotSentError],
    [403, DeliveryRejectedError],
    [400, DeliveryRejectedError],
  ])("reports status %i as %o", async (status, errorType) => {
    const send = mailbox({
      "/api/accounts": () => respond(ACCOUNTS),
      "/api/accounts/100/messages/m1": () => respond({ status: { code: status } }, status),
    });

    await expect(sendZohoReply(send, API, "token", REPLY)).rejects.toBeInstanceOf(errorType);
  });

  it("reports an unknown outcome when Zoho fails after receiving the reply", async () => {
    const send = mailbox({
      "/api/accounts": () => respond(ACCOUNTS),
      "/api/accounts/100/messages/m1": () => respond({}, 500),
    });

    const error: unknown = await sendZohoReply(send, API, "token", REPLY).catch(
      (caught: unknown) => caught,
    );

    expect(error).not.toBeInstanceOf(DeliveryNotSentError);
    expect(error).not.toBeInstanceOf(DeliveryRejectedError);
  });

  it("reports a failure to read the account as a delivery that did not happen", async () => {
    const send = mailbox({ "/api/accounts": () => respond({}, 500) });

    await expect(createZohoDraft(send, API, "token", REPLY)).rejects.toBeInstanceOf(
      DeliveryNotSentError,
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
