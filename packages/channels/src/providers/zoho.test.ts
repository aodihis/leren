import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { InvalidGrantError } from "./types";
import { createZohoProvider } from "./zoho";

const REDIRECT_URI = "http://localhost:3000/api/channel-accounts/zoho/callback";

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function createProvider(fetchMock: Mock<typeof fetch>, region: "com" | "eu" = "com") {
  return createZohoProvider({
    clientId: "client-id",
    clientSecret: "client-secret",
    region,
    fetch: fetchMock,
  });
}

function sentForm(fetchMock: Mock<typeof fetch>, call = 0) {
  return Object.fromEntries(new URLSearchParams(fetchMock.mock.calls[call]?.[1]?.body?.toString()));
}

const TOKENS = { access_token: "access", refresh_token: "refresh", expires_in: 3600 };

const ACCOUNTS = {
  data: [{ accountId: "100", zuid: "7", type: "ZOHO_ACCOUNT", primaryEmailAddress: "Me@Acme.eu" }],
};

describe("Zoho provider", () => {
  it("builds an offline authorization URL with PKCE, state and comma-separated scopes in the region", () => {
    const started = createProvider(vi.fn<typeof fetch>(), "eu").start({
      state: "the-state",
      codeChallenge: "the-challenge",
      redirectUri: REDIRECT_URI,
      userEmail: "user@example.com",
    });

    const url = new URL(started.kind === "redirect" ? started.url : "");

    expect(url.origin + url.pathname).toBe("https://accounts.zoho.eu/oauth/v2/auth");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")?.split(",")).toEqual(
      expect.arrayContaining(["ZohoMail.messages.READ", "ZohoMail.messages.CREATE"]),
    );
  });

  it("identifies the account from its Zoho Mail account and records the position of the inbox", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(200, TOKENS))
      .mockResolvedValueOnce(respond(200, ACCOUNTS))
      .mockResolvedValueOnce(
        respond(200, { data: [{ folderId: "1", folderType: "Inbox", path: "/Inbox" }] }),
      )
      .mockResolvedValueOnce(respond(200, { data: [] }));

    const account = await createProvider(fetchMock, "eu").finish({
      code: "the-code",
      codeVerifier: "the-verifier",
      redirectUri: REDIRECT_URI,
    });

    expect(account).toMatchObject({
      providerAccountId: "7:100",
      label: "me@acme.eu",
      tokens: { accessToken: "access", refreshToken: "refresh" },
    });
    expect(JSON.parse(account.syncCursor ?? "")).toMatchObject({ accountId: "100", folderId: "1" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://accounts.zoho.eu/oauth/v2/token");
    expect(sentForm(fetchMock)).toMatchObject({ code: "the-code", code_verifier: "the-verifier" });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://mail.zoho.eu/api/accounts");
  });

  it("keeps the refresh token, which Zoho does not replace on a refresh", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond(200, { access_token: "new-access", expires_in: 3600 }));

    const tokens = await createProvider(fetchMock).refresh({
      accessToken: "old",
      refreshToken: "kept",
      expiresAt: null,
    });

    expect(tokens).toMatchObject({ accessToken: "new-access", refreshToken: "kept" });
  });

  it("reports a refresh token that Zoho no longer honours as an invalid grant, though the status is 200", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond(200, { error: "invalid_code" }));

    await expect(
      createProvider(fetchMock).refresh({ accessToken: "a", refreshToken: "r", expiresAt: null }),
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it("reports any other token error as a failure that may succeed on a retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond(200, { error: "Access Denied" }));

    const failure = createProvider(fetchMock).refresh({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: null,
    });

    await expect(failure).rejects.toThrow(/token request failed/);
    await expect(failure).rejects.not.toBeInstanceOf(InvalidGrantError);
  });

  it("revokes the refresh token with the client credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(respond(200, {}));

    await createProvider(fetchMock).revoke({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: null,
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://accounts.zoho.com/oauth/v2/revoke/token",
    );
    expect(sentForm(fetchMock)).toEqual({ token: "refresh", token_type: "refresh_token" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    });
  });
});
