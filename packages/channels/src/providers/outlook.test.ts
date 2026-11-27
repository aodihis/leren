import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import {
  createOutlookDraft,
  fetchNewOutlookMail,
  parseOutlookMessage,
  readOutlookAddress,
  readOutlookReplyContext,
  sendOutlookReply,
} from "./outlook";
import { DeliveryNotSentError, DeliveryRejectedError } from "./types";
import type { OutboundReply } from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0/me";

function respond(body: unknown, status = 200): Response {
  return status === 202 || status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status });
}

function outlookMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    conversationId: "c1",
    from: { emailAddress: { name: "Ana", address: "Ana@Example.com" } },
    toRecipients: [
      { emailAddress: { address: "me@example.com" } },
      { emailAddress: { address: "bo@example.com" } },
    ],
    ccRecipients: [],
    subject: "Opening hours",
    body: { contentType: "text", content: "What time do you open?\r\n" },
    receivedDateTime: "2026-11-26T09:00:00Z",
    isDraft: false,
    ...overrides,
  };
}

function urlOf(send: Mock<typeof fetch>, call: number): URL {
  return new URL(String(send.mock.calls[call]?.[0]));
}

function methodOf(send: Mock<typeof fetch>, call: number): string {
  return send.mock.calls[call]?.[1]?.method ?? "GET";
}

function bodyOf(send: Mock<typeof fetch>, call: number): Record<string, unknown> {
  return JSON.parse(String(send.mock.calls[call]?.[1]?.body)) as Record<string, unknown>;
}

describe("parseOutlookMessage", () => {
  it("reads the addresses, subject, body, ids and time of a message", () => {
    expect(parseOutlookMessage(outlookMessage())).toEqual({
      providerMessageId: "m1",
      providerThreadId: "c1",
      from: "ana@example.com",
      to: ["me@example.com", "bo@example.com"],
      cc: [],
      subject: "Opening hours",
      body: "What time do you open?",
      isReply: false,
      isBulk: false,
      receivedAt: new Date("2026-11-26T09:00:00Z"),
    });
  });

  it("reads whether the message is a reply or bulk from its internet headers", () => {
    const email = parseOutlookMessage(
      outlookMessage({
        internetMessageHeaders: [
          { name: "In-Reply-To", value: "<a@example.com>" },
          { name: "List-Unsubscribe", value: "<mailto:u@example.com>" },
        ],
      }),
    );

    expect(email).toMatchObject({ isReply: true, isBulk: true });
  });
});

describe("fetchNewOutlookMail", () => {
  it("starts from a delta of the inbox filtered to mail received from now on", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond({ value: [], "@odata.deltaLink": "https://delta/1" }));

    const result = await fetchNewOutlookMail(send, "token", null);

    expect(result).toEqual({
      emails: [],
      cursor: "https://delta/1",
      baseline: true,
      unreadable: [],
    });
    expect(urlOf(send, 0).pathname).toBe("/v1.0/me/mailFolders/inbox/messages/delta");
    expect(urlOf(send, 0).searchParams.get("$filter")).toMatch(/^receivedDateTime ge \d{4}-/);
    expect(send.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer token",
      prefer: expect.stringContaining('IdType="ImmutableId"'),
    });
  });

  it("reads every page and returns new mail without removed messages, drafts or deleted mail", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        respond({
          value: [{ id: "m1" }, { id: "gone", "@removed": { reason: "deleted" } }],
          "@odata.nextLink": "https://delta/page-2",
        }),
      )
      .mockResolvedValueOnce(
        respond({
          value: [{ id: "draft" }, { id: "deleted" }, { id: "broken" }],
          "@odata.deltaLink": "https://delta/2",
        }),
      )
      .mockResolvedValueOnce(respond(outlookMessage()))
      .mockResolvedValueOnce(respond(outlookMessage({ id: "draft", isDraft: true })))
      .mockResolvedValueOnce(respond({ error: { code: "ErrorItemNotFound" } }, 404))
      .mockResolvedValueOnce(respond({ id: "broken" }));

    const result = await fetchNewOutlookMail(send, "token", "https://delta/1");

    expect(result.emails.map((email) => email.providerMessageId)).toEqual(["m1"]);
    expect(result).toMatchObject({
      cursor: "https://delta/2",
      baseline: false,
      unreadable: ["broken"],
    });
    expect(String(send.mock.calls[0]?.[0])).toBe("https://delta/1");
    expect(String(send.mock.calls[1]?.[0])).toBe("https://delta/page-2");
  });

  it("starts again from now when Graph can no longer resume from the cursor", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ error: { code: "SyncStateNotFound" } }, 410))
      .mockResolvedValueOnce(respond({ value: [], "@odata.deltaLink": "https://delta/new" }));

    const result = await fetchNewOutlookMail(send, "token", "https://delta/old");

    expect(result).toMatchObject({ emails: [], cursor: "https://delta/new", baseline: true });
  });

  it("fails without moving the cursor when a message cannot be read", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ value: [{ id: "m1" }], "@odata.deltaLink": "https://d/2" }))
      .mockResolvedValueOnce(respond({ error: { code: "ServiceUnavailable" } }, 503));

    await expect(fetchNewOutlookMail(send, "token", "https://d/1")).rejects.toThrow(/status 503/);
  });
});

describe("readOutlookReplyContext", () => {
  it("reads the Message-ID and Reply-To of the original", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      respond({
        internetMessageId: "<original@example.com>",
        replyTo: [{ emailAddress: { address: "Support@Example.com" } }],
      }),
    );

    expect(await readOutlookReplyContext(send, "token", "m1")).toEqual({
      messageId: "<original@example.com>",
      references: null,
      replyTo: "support@example.com",
    });
    expect(urlOf(send, 0).pathname).toBe("/v1.0/me/messages/m1");
  });
});

const REPLY: OutboundReply = {
  to: "ana@example.com",
  subject: "Re: Opening hours",
  body: "We open at 9.",
  providerMessageId: "original",
  threadId: "c1",
  messageId: "<leren-1@leren.local>",
  inReplyTo: "<original@example.com>",
  references: "<original@example.com>",
};

describe("createOutlookDraft and sendOutlookReply", () => {
  it("creates a reply to the original and sets its one recipient, subject and body", async () => {
    const updated = { id: "draft-1", subject: "Re: Opening hours" };

    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ id: "draft-1" }, 201))
      .mockResolvedValueOnce(respond(updated));

    expect(await createOutlookDraft(send, "token", REPLY)).toEqual({
      id: "draft-1",
      response: updated,
    });
    expect(methodOf(send, 0)).toBe("POST");
    expect(String(send.mock.calls[0]?.[0])).toBe(`${GRAPH}/messages/original/createReply`);
    expect(methodOf(send, 1)).toBe("PATCH");
    expect(bodyOf(send, 1)).toEqual({
      subject: "Re: Opening hours",
      body: { contentType: "text", content: "We open at 9." },
      toRecipients: [{ emailAddress: { address: "ana@example.com" } }],
      ccRecipients: [],
      bccRecipients: [],
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("deletes the draft and reports a delivery that did not happen when its content cannot be set", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ id: "draft-1" }, 201))
      .mockResolvedValueOnce(respond({ error: { code: "ServiceUnavailable" } }, 503))
      .mockResolvedValueOnce(respond(null, 204));

    await expect(createOutlookDraft(send, "token", REPLY)).rejects.toBeInstanceOf(
      DeliveryNotSentError,
    );
    expect(methodOf(send, 2)).toBe("DELETE");
    expect(String(send.mock.calls[2]?.[0])).toBe(`${GRAPH}/messages/draft-1`);
  });

  it("refuses the delivery when the draft whose content failed cannot be deleted, so no retry adds a second draft", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ id: "draft-1" }, 201))
      .mockResolvedValueOnce(respond({ error: { code: "InvalidAuthenticationToken" } }, 401))
      .mockResolvedValueOnce(respond({ error: { code: "InvalidAuthenticationToken" } }, 401));

    await expect(createOutlookDraft(send, "token", REPLY)).rejects.toMatchObject({
      name: "DeliveryRejectedError",
      reason: "rejected",
    });
  });

  it("refuses the delivery when Graph creates the reply without returning its id", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(respond({}, 201));

    await expect(createOutlookDraft(send, "token", REPLY)).rejects.toBeInstanceOf(
      DeliveryRejectedError,
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("sends the draft and returns its id", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ id: "draft-1" }, 201))
      .mockResolvedValueOnce(respond({ id: "draft-1" }))
      .mockResolvedValueOnce(respond(null, 202));

    expect(await sendOutlookReply(send, "token", REPLY)).toMatchObject({ id: "draft-1" });
    expect(String(send.mock.calls[2]?.[0])).toBe(`${GRAPH}/messages/draft-1/send`);
  });

  it.each([
    [429, DeliveryNotSentError],
    [403, DeliveryRejectedError],
  ])("deletes the draft when the send is refused with status %i", async (status, errorType) => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ id: "draft-1" }, 201))
      .mockResolvedValueOnce(respond({ id: "draft-1" }))
      .mockResolvedValueOnce(respond({ error: { code: "x" } }, status))
      .mockResolvedValueOnce(respond(null, 204));

    await expect(sendOutlookReply(send, "token", REPLY)).rejects.toBeInstanceOf(errorType);
    expect(methodOf(send, 3)).toBe("DELETE");
  });

  it("keeps the draft and reports an unknown outcome when the answer to the send is lost", async () => {
    const cause = Object.assign(new Error("reset"), { code: "ECONNRESET" });

    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ id: "draft-1" }, 201))
      .mockResolvedValueOnce(respond({ id: "draft-1" }))
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause }));

    const error: unknown = await sendOutlookReply(send, "token", REPLY).catch(
      (caught: unknown) => caught,
    );

    expect(error).not.toBeInstanceOf(DeliveryNotSentError);
    expect(error).not.toBeInstanceOf(DeliveryRejectedError);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each([
    [401, DeliveryNotSentError],
    [400, DeliveryRejectedError],
  ])("reports status %i on creating the reply as %o", async (status, errorType) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(respond({ error: { code: "x" } }, status));

    await expect(createOutlookDraft(send, "token", REPLY)).rejects.toBeInstanceOf(errorType);
    expect(send).toHaveBeenCalledOnce();
  });

  it("reports a refused connection as a delivery that did not happen", async () => {
    const cause = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    const send = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed", { cause }));

    await expect(sendOutlookReply(send, "token", REPLY)).rejects.toBeInstanceOf(
      DeliveryNotSentError,
    );
  });
});

describe("parseOutlookMessage with missing fields", () => {
  it("reads a message without a conversation, sender, recipients, subject or body", () => {
    expect(
      parseOutlookMessage(
        outlookMessage({
          conversationId: null,
          from: { emailAddress: { address: "  " } },
          toRecipients: null,
          ccRecipients: [{ emailAddress: null }],
          subject: null,
          body: null,
        }),
      ),
    ).toMatchObject({ providerThreadId: null, from: "", to: [], cc: [], subject: "", body: "" });
  });
});

describe("fetchNewOutlookMail and its delta links", () => {
  it("starts again from now when Graph asks for a full resync with another status", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond({ error: { code: "resyncRequired" } }, 400))
      .mockResolvedValueOnce(respond({ value: [], "@odata.deltaLink": "https://delta/new" }));

    expect(await fetchNewOutlookMail(send, "token", "https://delta/old")).toMatchObject({
      cursor: "https://delta/new",
      baseline: true,
    });
  });

  it("fails and keeps the cursor when the delta fails for another reason", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("down", { status: 503 }));

    await expect(fetchNewOutlookMail(send, "token", "https://delta/old")).rejects.toThrow(
      /status 503/,
    );
  });

  it("fails on a delta page that has neither a next link nor a delta link", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(respond({ value: [] }));

    await expect(fetchNewOutlookMail(send, "token", "https://delta/old")).rejects.toThrow(
      "without a next link or a delta link",
    );
  });
});

describe("readOutlookAddress", () => {
  it.each([
    [
      "the primary address",
      { mail: "Ana@Example.com", userPrincipalName: "ana@corp" },
      "ana@example.com",
    ],
    [
      "the user principal name when there is no address",
      { mail: null, userPrincipalName: "Ana@Corp.onmicrosoft.com" },
      "ana@corp.onmicrosoft.com",
    ],
  ])("returns %s", async (_name, profile, address) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(respond(profile));

    expect(await readOutlookAddress(send, "token")).toBe(address);
  });

  it("fails when Graph returns no address", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond({ mail: "", userPrincipalName: null }));

    await expect(readOutlookAddress(send, "token")).rejects.toThrow("did not return the address");
  });
});

describe("readOutlookReplyContext without headers", () => {
  it("returns nothing for a blank Message-ID and a missing Reply-To", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(respond({ internetMessageId: " " }));

    expect(await readOutlookReplyContext(send, "token", "m1")).toEqual({
      messageId: null,
      references: null,
      replyTo: null,
    });
  });
});
