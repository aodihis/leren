import { describe, expect, it, vi } from "vitest";

import {
  buildRawReply,
  createGmailDraft,
  fetchNewGmail,
  parseGmailMessage,
  readGmailReplyContext,
  sendGmailReply,
} from "./gmail";
import { DeliveryNotSentError, DeliveryRejectedError } from "./types";
import type { OutboundReply } from "./types";

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function gmailMessage(
  overrides: {
    id?: string;
    headers?: Record<string, string>;
    payload?: Record<string, unknown>;
  } = {},
) {
  return {
    id: overrides.id ?? "m1",
    threadId: "t1",
    internalDate: "1700000000000",
    payload: {
      mimeType: "text/plain",
      headers: Object.entries({
        From: "Ana Silva <Ana@Example.com>",
        To: "me@example.com, Bo <bo@example.com>",
        Subject: "Opening hours",
        ...overrides.headers,
      }).map(([name, value]) => ({ name, value })),
      body: { data: encode("What time do you open?") },
      ...overrides.payload,
    },
  };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("parseGmailMessage", () => {
  it("reads the addresses, subject, body and ids of a plain message", () => {
    const email = parseGmailMessage(gmailMessage());

    expect(email).toEqual({
      providerMessageId: "m1",
      providerThreadId: "t1",
      from: "ana@example.com",
      to: ["me@example.com", "bo@example.com"],
      cc: [],
      subject: "Opening hours",
      body: "What time do you open?",
      isReply: false,
      isBulk: false,
      receivedAt: new Date(1_700_000_000_000),
    });
  });

  it("takes the address in angle brackets, not one written in the display name", () => {
    const email = parseGmailMessage(
      gmailMessage({
        headers: {
          From: '"boss@company.com" <attacker@evil.com>',
          To: '"Smith, Ana" <ana@example.com>, "me@example.com" <other@example.com>',
          Cc: "bo@example.com",
        },
      }),
    );

    expect(email.from).toBe("attacker@evil.com");
    expect(email.to).toEqual(["ana@example.com", "other@example.com"]);
    expect(email.cc).toEqual(["bo@example.com"]);
  });

  it("ignores an address in angle brackets inside a quoted display name", () => {
    const email = parseGmailMessage(
      gmailMessage({
        headers: {
          From: '"<boss@company.com>" <attacker@evil.com>',
          To: '"say \\"<a@b.com>\\"" <ana@example.com>',
        },
      }),
    );

    expect(email.from).toBe("attacker@evil.com");
    expect(email.to).toEqual(["ana@example.com"]);
  });

  it("prefers the plain part of a multipart message", () => {
    const email = parseGmailMessage(
      gmailMessage({
        payload: {
          mimeType: "multipart/alternative",
          body: {},
          parts: [
            { mimeType: "text/html", body: { data: encode("<p>Hello</p>") } },
            { mimeType: "text/plain", body: { data: encode("Hello") } },
          ],
        },
      }),
    );

    expect(email.body).toBe("Hello");
  });

  it("converts the html part to text when there is no plain part", () => {
    const email = parseGmailMessage(
      gmailMessage({
        payload: {
          mimeType: "text/html",
          body: { data: encode("<style>p{}</style><p>Fish &amp; chips</p><p>Open at 9</p>") },
        },
      }),
    );

    expect(email.body).toBe("Fish & chips\nOpen at 9");
  });

  it("marks a message that names the message it answers as a reply", () => {
    expect(parseGmailMessage(gmailMessage({ headers: { "In-Reply-To": "<a@b>" } })).isReply).toBe(
      true,
    );
    expect(parseGmailMessage(gmailMessage({ headers: { References: "<a@b>" } })).isReply).toBe(
      true,
    );
  });

  it.each([
    [{ "List-Unsubscribe": "<mailto:x@y>" }, true],
    [{ Precedence: "Bulk" }, true],
    [{ "Auto-Submitted": "auto-generated" }, true],
    [{ "Auto-Submitted": "no" }, false],
    [{ Precedence: "first-class" }, false],
  ])("reads the bulk flag from %j", (headers, expected) => {
    expect(parseGmailMessage(gmailMessage({ headers })).isBulk).toBe(expected);
  });
});

describe("fetchNewGmail", () => {
  it("returns the current position and no mail when there is no cursor", async () => {
    const send = vi.fn<typeof fetch>(async () => reply({ historyId: "500" }));

    const result = await fetchNewGmail(send, "token", null);

    expect(result).toEqual({ emails: [], cursor: "500", baseline: true, unreadable: [] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0])).toContain("/profile");
  });

  it("reads every page of the history and skips the account's own mail", async () => {
    const send = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/history")) {
        expect(url.searchParams.get("startHistoryId")).toBe("100");
        expect(url.searchParams.get("labelId")).toBe("INBOX");

        return url.searchParams.get("pageToken") === "next"
          ? reply({
              history: [{ messagesAdded: [{ message: { id: "m3", labelIds: ["INBOX"] } }] }],
              historyId: "300",
            })
          : reply({
              history: [
                { messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX"] } }] },
                { messagesAdded: [{ message: { id: "m2", labelIds: ["SENT"] } }] },
                { messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX"] } }] },
              ],
              nextPageToken: "next",
              historyId: "200",
            });
      }

      return reply(gmailMessage({ id: url.pathname.split("/").pop() ?? "" }));
    });

    const result = await fetchNewGmail(send, "token", "100");

    expect(result.baseline).toBe(false);
    expect(result.cursor).toBe("300");
    expect(result.emails.map((email) => email.providerMessageId)).toEqual(["m1", "m3"]);
  });

  it("keeps the cursor when there is no new mail", async () => {
    const send = vi.fn(async () => reply({ historyId: "100" }));

    expect(await fetchNewGmail(send, "token", "100")).toEqual({
      emails: [],
      cursor: "100",
      baseline: false,
      unreadable: [],
    });
  });

  it("starts again from the current position when Gmail no longer holds the history", async () => {
    const send = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/history") ? reply({}, 404) : reply({ historyId: "900" }),
    );

    expect(await fetchNewGmail(send, "token", "1")).toEqual({
      emails: [],
      cursor: "900",
      baseline: true,
      unreadable: [],
    });
  });

  it("skips a message that was deleted after it arrived", async () => {
    const send = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/history")) {
        return reply({
          history: [
            {
              messagesAdded: [
                { message: { id: "gone", labelIds: ["INBOX"] } },
                { message: { id: "kept", labelIds: ["INBOX"] } },
              ],
            },
          ],
          historyId: "200",
        });
      }

      return url.includes("/gone") ? reply({}, 404) : reply(gmailMessage({ id: "kept" }));
    });

    const result = await fetchNewGmail(send, "token", "100");

    expect(result.emails.map((email) => email.providerMessageId)).toEqual(["kept"]);
    expect(result.cursor).toBe("200");
  });

  it("leaves out a message that does not have the expected shape and reports it", async () => {
    const send = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/history")) {
        return reply({
          history: [
            {
              messagesAdded: [
                { message: { id: "bad", labelIds: ["INBOX"] } },
                { message: { id: "good", labelIds: ["INBOX"] } },
              ],
            },
          ],
          historyId: "200",
        });
      }

      return url.includes("/bad")
        ? reply({ id: "bad", internalDate: "not-a-number", payload: {} })
        : reply(gmailMessage({ id: "good" }));
    });

    const result = await fetchNewGmail(send, "token", "100");

    expect(result.emails.map((email) => email.providerMessageId)).toEqual(["good"]);
    expect(result.unreadable).toEqual(["bad"]);
    expect(result.cursor).toBe("200");
  });

  it("fails on any other error, so the cursor does not advance", async () => {
    const send = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/history")
        ? reply({
            history: [{ messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX"] } }] }],
            historyId: "200",
          })
        : reply({}, 500),
    );

    await expect(fetchNewGmail(send, "token", "100")).rejects.toThrow("status 500");
  });

  it("sends the access token as a bearer token", async () => {
    const send = vi.fn(async () => reply({ historyId: "5" }));

    await fetchNewGmail(send, "secret-token", null);

    expect(send).toHaveBeenCalledWith(expect.any(String), {
      headers: { authorization: "Bearer secret-token" },
    });
  });
});

const REPLY: OutboundReply = {
  to: "ana@example.com",
  subject: "Re: Opening hours",
  body: "We open at 9.\nSee you soon.",
  providerMessageId: "m1",
  threadId: "t1",
  messageId: "<leren-1@leren.local>",
  inReplyTo: "<original@example.com>",
  references: "<first@example.com> <original@example.com>",
};

function decodeRaw(raw: string): { headers: Map<string, string>; body: string } {
  const [head = "", body = ""] = Buffer.from(raw, "base64url").toString("utf8").split("\r\n\r\n");

  return {
    headers: new Map(
      head
        .split("\r\n")
        .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]),
    ),
    body: Buffer.from(body.replaceAll("\r\n", ""), "base64").toString("utf8"),
  };
}

type SentBody = { raw?: string; threadId?: string; message?: { raw: string; threadId?: string } };

function sentBody(send: ReturnType<typeof vi.fn>): SentBody {
  return JSON.parse(String(send.mock.calls[0]?.[1]?.body)) as SentBody;
}

describe("buildRawReply", () => {
  it("writes the headers that thread the reply and the body as base64", () => {
    const { headers, body } = decodeRaw(buildRawReply(REPLY));

    expect(headers.get("To")).toBe("ana@example.com");
    expect(headers.get("Subject")).toBe("Re: Opening hours");
    expect(headers.get("Message-ID")).toBe("<leren-1@leren.local>");
    expect(headers.get("In-Reply-To")).toBe("<original@example.com>");
    expect(headers.get("References")).toBe("<first@example.com> <original@example.com>");
    expect(headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
    expect(body).toBe("We open at 9.\nSee you soon.");
  });

  it("omits the threading headers that the original did not have", () => {
    const { headers } = decodeRaw(buildRawReply({ ...REPLY, inReplyTo: null, references: null }));

    expect(headers.has("In-Reply-To")).toBe(false);
    expect(headers.has("References")).toBe(false);
  });

  it("cannot be made to add a header through a line break in a value", () => {
    const { headers } = decodeRaw(
      buildRawReply({
        ...REPLY,
        subject: "Re: Hi\r\nBcc: attacker@evil.com",
        to: "a@example.com\r\nBcc: x@evil.com",
      }),
    );

    expect(headers.has("Bcc")).toBe(false);
  });

  it("encodes a subject that has characters outside ASCII", () => {
    const { headers } = decodeRaw(buildRawReply({ ...REPLY, subject: "Re: Jadwal buka café" }));
    const encoded = Buffer.from("Re: Jadwal buka café").toString("base64");

    expect(headers.get("Subject")).toBe(`=?UTF-8?B?${encoded}?=`);
  });
});

describe("readGmailReplyContext", () => {
  it("reads the Message-ID, References and Reply-To of the original", async () => {
    const send = vi.fn().mockResolvedValue(
      reply(
        gmailMessage({
          headers: {
            "Message-ID": "<original@example.com>",
            References: "<first@example.com>",
            "Reply-To": "Support <support@example.com>",
          },
        }),
      ),
    );

    expect(await readGmailReplyContext(send, "token", "m1")).toEqual({
      messageId: "<original@example.com>",
      references: "<first@example.com>",
      replyTo: "support@example.com",
    });
    expect(String(send.mock.calls[0]?.[0])).toContain("/messages/m1?format=metadata");
  });

  it("returns nulls when the original has none of the headers", async () => {
    const send = vi.fn().mockResolvedValue(reply(gmailMessage()));

    expect(await readGmailReplyContext(send, "token", "m1")).toEqual({
      messageId: null,
      references: null,
      replyTo: null,
    });
  });
});

describe("createGmailDraft and sendGmailReply", () => {
  it("creates a draft in the thread and returns its id with the whole answer", async () => {
    const answer = { id: "d1", message: { id: "m9", threadId: "t1" } };
    const send = vi.fn().mockResolvedValue(reply(answer));

    expect(await createGmailDraft(send, "token", REPLY)).toEqual({ id: "d1", response: answer });
    expect(send).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(sentBody(send).message?.threadId).toBe("t1");
    expect(decodeRaw(sentBody(send).message?.raw ?? "").headers.get("To")).toBe("ana@example.com");
  });

  it("sends the reply in the thread and returns the id of the sent message", async () => {
    const answer = { id: "m9", threadId: "t1", labelIds: ["SENT"] };
    const send = vi.fn().mockResolvedValue(reply(answer));

    expect(await sendGmailReply(send, "token", REPLY)).toEqual({ id: "m9", response: answer });
    expect(send).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      expect.objectContaining({ method: "POST" }),
    );
    expect(sentBody(send).threadId).toBe("t1");
  });

  it("leaves out the thread when the original has none", async () => {
    const send = vi.fn().mockResolvedValue(reply({ id: "m9" }));

    await sendGmailReply(send, "token", { ...REPLY, threadId: null });

    expect(sentBody(send)).not.toHaveProperty("threadId");
  });

  it.each([
    [403, "forbidden"],
    [400, "rejected"],
    [404, "rejected"],
  ])("reports status %i as a refusal of kind %s", async (status, reason) => {
    const send = vi.fn().mockResolvedValue(reply({ error: {} }, status));

    await expect(sendGmailReply(send, "token", REPLY)).rejects.toMatchObject({
      name: "DeliveryRejectedError",
      reason,
    });
  });

  it.each([
    [429, { error: {} }],
    [401, { error: {} }],
    [403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }],
    [403, { error: { status: "RESOURCE_EXHAUSTED" } }],
  ])(
    "reports status %i with a rate limit or invalid credentials as a delivery that did not happen",
    async (status, body) => {
      const send = vi.fn().mockResolvedValue(reply(body, status));

      await expect(createGmailDraft(send, "token", REPLY)).rejects.toBeInstanceOf(
        DeliveryNotSentError,
      );
    },
  );

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])(
    "reports a %s failure as a delivery that did not happen",
    async (code) => {
      const cause = Object.assign(new Error(code), { code });
      const send = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));

      await expect(sendGmailReply(send, "token", REPLY)).rejects.toBeInstanceOf(
        DeliveryNotSentError,
      );
    },
  );

  it("does not claim that a delivery did not happen when the outcome is unknown", async () => {
    const cause = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const reset = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    const failure = vi.fn().mockResolvedValue(reply({ error: {} }, 503));

    for (const send of [reset, failure]) {
      const error: unknown = await sendGmailReply(send, "token", REPLY).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DeliveryNotSentError);
      expect(error).not.toBeInstanceOf(DeliveryRejectedError);
    }
  });

  it("fails when Gmail answers without an id", async () => {
    const send = vi.fn().mockResolvedValue(reply({}));

    await expect(sendGmailReply(send, "token", REPLY)).rejects.toThrow();
  });
});

describe("Gmail edge cases", () => {
  it("reads a message without headers, thread or body", () => {
    expect(
      parseGmailMessage({
        id: "m1",
        internalDate: "1700000000000",
        payload: { mimeType: "multipart/mixed", parts: [] },
      } as never),
    ).toMatchObject({ providerThreadId: null, from: "", to: [], subject: "", body: "" });
  });

  it("reads history entries that add no message or carry no labels", async () => {
    const send = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/history")
        ? reply({
            history: [{ labelsAdded: [] }, { messagesAdded: [{ message: { id: "m1" } }] }],
            historyId: "200",
          })
        : reply(gmailMessage()),
    );

    const result = await fetchNewGmail(send, "token", "100");

    expect(result.emails.map((email) => email.providerMessageId)).toEqual(["m1"]);
  });

  it("fails and keeps the cursor when the history cannot be read", async () => {
    const send = vi.fn(async () => reply({}, 503));

    await expect(fetchNewGmail(send, "token", "100")).rejects.toThrow("status 503");
  });

  it("writes an empty body for an empty reply", () => {
    const raw = Buffer.from(buildRawReply({ ...REPLY, body: "" }), "base64url").toString();

    expect(raw.endsWith("\r\n\r\n\r\n")).toBe(true);
  });

  it("returns nulls when the original has no headers at all", async () => {
    const send = vi.fn(async () => reply({ payload: { mimeType: "text/plain" } }));

    expect(await readGmailReplyContext(send, "token", "m1")).toEqual({
      messageId: null,
      references: null,
      replyTo: null,
    });
  });
});
