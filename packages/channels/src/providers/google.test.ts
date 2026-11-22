import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { createGoogleProvider } from "./google";
import { InvalidGrantError } from "./types";

const REDIRECT_URI = "http://localhost:3000/api/channel-accounts/google/callback";

function idToken(claims: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function fetchReturning(status: number, body: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(respond(status, body));
}

function createProvider(fetchMock: Mock<typeof fetch>) {
  return createGoogleProvider({
    clientId: "client-id",
    clientSecret: "client-secret",
    fetch: fetchMock,
  });
}

function sentBody(fetchMock: Mock<typeof fetch>) {
  const body = fetchMock.mock.calls[0]?.[1]?.body;

  return Object.fromEntries(new URLSearchParams(body?.toString()));
}

describe("Google provider", () => {
  it("builds an offline authorization URL with PKCE, state and the Gmail scopes", () => {
    const provider = createProvider(vi.fn<typeof fetch>());

    const started = provider.start({
      state: "the-state",
      codeChallenge: "the-challenge",
      redirectUri: REDIRECT_URI,
      userEmail: "user@example.com",
    });

    expect(started.kind).toBe("redirect");

    const url = new URL(started.kind === "redirect" ? started.url : "");

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining([
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
      ]),
    );
  });

  it("identifies the account by the sub claim and sends the code verifier", async () => {
    const fetchMock = fetchReturning(200, {
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      id_token: idToken({ sub: "1234", email: "work@company.com" }),
    });

    const account = await createProvider(fetchMock).finish({
      code: "the-code",
      codeVerifier: "the-verifier",
      redirectUri: REDIRECT_URI,
    });

    expect(account).toMatchObject({
      providerAccountId: "1234",
      label: "work@company.com",
      tokens: { accessToken: "access", refreshToken: "refresh" },
    });
    expect(sentBody(fetchMock)).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      code_verifier: "the-verifier",
    });
  });

  it("records the position of the mailbox when the account connects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        respond(200, {
          access_token: "access",
          refresh_token: "refresh",
          id_token: idToken({ sub: "1", email: "a@b.c" }),
        }),
      )
      .mockResolvedValueOnce(respond(200, { historyId: "77" }));

    const account = await createProvider(fetchMock).finish({
      code: "c",
      codeVerifier: "v",
      redirectUri: REDIRECT_URI,
    });

    expect(account.syncCursor).toBe("77");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({ headers: { authorization: "Bearer access" } });
  });

  it("connects without a position when the mailbox cannot be read", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        respond(200, {
          access_token: "access",
          refresh_token: "refresh",
          id_token: idToken({ sub: "1", email: "a@b.c" }),
        }),
      )
      .mockResolvedValueOnce(respond(500, {}));

    const account = await createProvider(fetchMock).finish({
      code: "c",
      codeVerifier: "v",
      redirectUri: REDIRECT_URI,
    });

    expect(account.syncCursor).toBeNull();
  });

  it("fails when Google returns no refresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        respond(200, { access_token: "access", id_token: idToken({ sub: "1", email: "a@b.c" }) }),
      );

    await expect(
      createProvider(fetchMock).finish({ code: "c", codeVerifier: "v", redirectUri: REDIRECT_URI }),
    ).rejects.toThrow(/refresh token/);
  });

  it("keeps the refresh token when a refresh returns none", async () => {
    const fetchMock = fetchReturning(200, { access_token: "new-access", expires_in: 3600 });

    const tokens = await createProvider(fetchMock).refresh({
      accessToken: "old",
      refreshToken: "kept",
      expiresAt: null,
    });

    expect(tokens).toMatchObject({ accessToken: "new-access", refreshToken: "kept" });
  });

  it("reports a rejected refresh token as an invalid grant and other failures as errors", async () => {
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: null };

    await expect(
      createProvider(fetchReturning(400, { error: "invalid_grant" })).refresh(tokens),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    const failure = createProvider(fetchReturning(503, {})).refresh(tokens);

    await expect(failure).rejects.toThrow(/status 503/);
    await expect(failure).rejects.not.toBeInstanceOf(InvalidGrantError);
  });

  it("revokes the refresh token", async () => {
    const fetchMock = fetchReturning(200, {});

    await createProvider(fetchMock).revoke({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: null,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(sentBody(fetchMock)).toEqual({ token: "refresh" });
  });
});
