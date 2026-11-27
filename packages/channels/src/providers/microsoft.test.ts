import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { createMicrosoftProvider } from "./microsoft";
import { InvalidGrantError } from "./types";

const REDIRECT_URI = "http://localhost:3000/api/channel-accounts/microsoft/callback";

function idToken(claims: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function createProvider(fetchMock: Mock<typeof fetch>) {
  return createMicrosoftProvider({
    clientId: "client-id",
    clientSecret: "client-secret",
    fetch: fetchMock,
  });
}

function sentBody(fetchMock: Mock<typeof fetch>) {
  const body = fetchMock.mock.calls[0]?.[1]?.body;

  return Object.fromEntries(new URLSearchParams(body?.toString()));
}

const TOKENS = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
  id_token: idToken({ tid: "tenant", oid: "object", preferred_username: "a.silva@company.com" }),
};

const PROFILE = { mail: "Ana@Company.com", userPrincipalName: "a.silva@company.com" };

describe("Microsoft provider", () => {
  it("builds an authorization URL on the common tenant with PKCE, state and offline access", () => {
    const started = createProvider(vi.fn<typeof fetch>()).start({
      state: "the-state",
      codeChallenge: "the-challenge",
      redirectUri: REDIRECT_URI,
      userEmail: "user@example.com",
    });

    const url = new URL(started.kind === "redirect" ? started.url : "");

    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining([
        "offline_access",
        "https://graph.microsoft.com/Mail.ReadWrite",
        "https://graph.microsoft.com/Mail.Send",
      ]),
    );
  });

  it("identifies the account by tenant and object id, labels it with the mailbox address and records the position of the inbox", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(200, TOKENS))
      .mockResolvedValueOnce(respond(200, PROFILE))
      .mockResolvedValueOnce(respond(200, { value: [], "@odata.deltaLink": "https://delta/1" }));

    const account = await createProvider(fetchMock).finish({
      code: "the-code",
      codeVerifier: "the-verifier",
      redirectUri: REDIRECT_URI,
    });

    expect(account).toMatchObject({
      providerAccountId: "tenant:object",
      label: "ana@company.com",
      syncCursor: "https://delta/1",
      tokens: { accessToken: "access", refreshToken: "refresh" },
    });
    expect(sentBody(fetchMock)).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      code_verifier: "the-verifier",
    });
  });

  it("labels an account without a mail address with its user principal name", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(200, TOKENS))
      .mockResolvedValueOnce(respond(200, { mail: null, userPrincipalName: "Ana@Outlook.com" }))
      .mockResolvedValueOnce(respond(200, { value: [], "@odata.deltaLink": "https://delta/1" }));

    const account = await createProvider(fetchMock).finish({
      code: "c",
      codeVerifier: "v",
      redirectUri: REDIRECT_URI,
    });

    expect(account.label).toBe("ana@outlook.com");
  });

  it("connects without a position when the inbox cannot be read", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(200, TOKENS))
      .mockResolvedValueOnce(respond(200, PROFILE))
      .mockResolvedValueOnce(respond(500, {}));

    const account = await createProvider(fetchMock).finish({
      code: "c",
      codeVerifier: "v",
      redirectUri: REDIRECT_URI,
    });

    expect(account.syncCursor).toBeNull();
  });

  it("fails when Microsoft returns no refresh token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond(200, { ...TOKENS, refresh_token: undefined }));

    await expect(
      createProvider(fetchMock).finish({ code: "c", codeVerifier: "v", redirectUri: REDIRECT_URI }),
    ).rejects.toThrow(/refresh token/);
  });

  it("returns the new refresh token that a refresh issues", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond(200, { access_token: "new-access", refresh_token: "rotated" }));

    const tokens = await createProvider(fetchMock).refresh({
      accessToken: "old",
      refreshToken: "previous",
      expiresAt: null,
    });

    expect(tokens).toMatchObject({ accessToken: "new-access", refreshToken: "rotated" });
    expect(sentBody(fetchMock)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "previous",
    });
  });

  it.each(["invalid_grant", "interaction_required", "consent_required"])(
    "reports a refresh answered with %s as an invalid grant, so the user connects again",
    async (error) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(respond(400, { error }));

      await expect(
        createProvider(fetchMock).refresh({ accessToken: "a", refreshToken: "r", expiresAt: null }),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    },
  );

  it("makes no request to revoke, because Microsoft cannot revoke one application's tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await createProvider(fetchMock).revoke({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
