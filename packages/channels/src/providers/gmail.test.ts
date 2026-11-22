import { describe, expect, it, vi } from "vitest";

import { fetchNewGmail, parseGmailMessage } from "./gmail";

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
