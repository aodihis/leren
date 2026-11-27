import { InvalidGrantError } from "@leren/channels";
import { describe, expect, it, vi } from "vitest";

import { defineConnector } from "./definitions";
import { createConnector } from "./oauth";

const METADATA = {
  issuer: "https://mcp.notion.com",
  authorization_endpoint: "https://mcp.notion.com/authorize",
  token_endpoint: "https://mcp.notion.com/token",
  registration_endpoint: "https://mcp.notion.com/register",
  revocation_endpoint: "https://mcp.notion.com/token",
};

/** Answers each address of Notion's authorization server the way the real server does. */
function createNotionServer(overrides: { token?: Response } = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);

    if (url.endsWith("/.well-known/oauth-authorization-server")) {
      return Response.json(METADATA);
    }

    if (url.endsWith("/register")) {
      return Response.json({ client_id: "registered-client" });
    }

    return (
      overrides.token ??
      Response.json({
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        workspace_id: "ws-1",
        workspace_name: "Acme",
      })
    );
  });
}

function lastRequestBody(send: ReturnType<typeof createNotionServer>) {
  const [, init] = send.mock.calls.at(-1) ?? [];

  return new URLSearchParams(String(init?.body));
}

describe("the Notion connector", () => {
  const definition = defineConnector("notion");

  it("registers a public client and builds an authorization URL bound to the resource", async () => {
    const connector = createConnector(definition, { fetch: createNotionServer() });

    const { url, clientId } = await connector.start({
      state: "s",
      codeChallenge: "c",
      redirectUri: "http://api/cb",
    });

    const parsed = new URL(url);

    expect(clientId).toBe("registered-client");
    expect(parsed.origin + parsed.pathname).toBe(METADATA.authorization_endpoint);
    expect(parsed.searchParams.get("client_id")).toBe("registered-client");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("resource")).toBe("https://mcp.notion.com/mcp");
    expect(parsed.searchParams.has("scope")).toBe(false);
  });

  it("identifies the workspace and keeps the client id with the tokens", async () => {
    const send = createNotionServer();
    const connector = createConnector(definition, { fetch: send });

    const result = await connector.finish({
      code: "c",
      codeVerifier: "v",
      redirectUri: "u",
      clientId: "registered-client",
    });

    const body = lastRequestBody(send);

    expect(result.identity).toEqual({ providerAccountId: "ws-1", label: "Acme" });
    expect(result.tokens).toMatchObject({ refreshToken: "r", clientId: "registered-client" });
    expect(body.get("client_id")).toBe("registered-client");
    expect(body.get("resource")).toBe("https://mcp.notion.com/mcp");
    expect(body.has("client_secret")).toBe(false);
  });

  it("refreshes as the client that the tokens were issued to", async () => {
    const send = createNotionServer();
    const connector = createConnector(definition, { fetch: send });

    const refreshed = await connector.refresh({
      accessToken: "old",
      refreshToken: "r",
      expiresAt: null,
      clientId: "registered-client",
    });

    expect(refreshed.clientId).toBe("registered-client");
    expect(lastRequestBody(send).get("client_id")).toBe("registered-client");
  });

  it("reports a rejected refresh token as an invalid grant", async () => {
    const connector = createConnector(definition, {
      fetch: createNotionServer({
        token: Response.json({ error: "invalid_grant" }, { status: 400 }),
      }),
    });

    await expect(
      connector.refresh({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        clientId: "registered-client",
      }),
    ).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it("refuses metadata that names another issuer", async () => {
    const connector = createConnector(definition, {
      fetch: vi.fn<typeof fetch>(async () =>
        Response.json({ ...METADATA, issuer: "https://evil.example" }),
      ),
    });

    await expect(
      connector.start({ state: "s", codeChallenge: "c", redirectUri: "u" }),
    ).rejects.toThrow(/issuer/);
  });
});

describe("the Google Sheets connector", () => {
  it("uses the product's own client and sends its secret", async () => {
    const claims = Buffer.from(JSON.stringify({ sub: "g-1", email: "me@example.com" }));

    const send = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "a", id_token: `x.${claims.toString("base64url")}.y` }),
    );

    const connector = createConnector(defineConnector("google_sheets"), {
      clientId: "google-id",
      clientSecret: "google-secret",
      fetch: send,
    });

    const { url, clientId } = await connector.start({
      state: "s",
      codeChallenge: "c",
      redirectUri: "u",
    });

    expect(clientId).toBe("google-id");
    expect(new URL(url).searchParams.get("scope")).toContain("spreadsheets.readonly");
    expect(new URL(url).searchParams.has("resource")).toBe(false);

    const result = await connector.finish({
      code: "c",
      codeVerifier: "v",
      redirectUri: "u",
      clientId,
    });

    expect(result.identity).toEqual({ providerAccountId: "g-1", label: "me@example.com" });
    expect(result.tokens.clientId).toBeNull();
    expect(lastRequestBody(send as never).get("client_secret")).toBe("google-secret");
  });
});

describe("the read-only allow-lists", () => {
  it("name no tool that writes", () => {
    const writes = /create|update|delete|append|write|move|comment|insert|duplicate|restore/;

    for (const id of ["notion", "google_docs", "google_sheets"] as const) {
      for (const tool of defineConnector(id).allowedTools) {
        expect(tool).not.toMatch(writes);
      }
    }
  });
});

describe("the OAuth client of a connector", () => {
  const sheets = defineConnector("google_sheets");
  const notion = defineConnector("notion");
  const tokens = { accessToken: "a", refreshToken: "r", expiresAt: null, clientId: null };

  it("refuses a connector that has neither metadata nor endpoints", async () => {
    const connector = createConnector(
      { ...sheets, oauth: { ...sheets.oauth, authorizationUrl: undefined } },
      { fetch: vi.fn<typeof fetch>() },
    );

    await expect(
      connector.start({ state: "s", codeChallenge: "c", redirectUri: "u" }),
    ).rejects.toThrow("has no OAuth endpoints");
  });

  it("discovers the endpoints again after a failed metadata request", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockImplementation(createNotionServer());

    const connector = createConnector(notion, { fetch: send });
    const start = () => connector.start({ state: "s", codeChallenge: "c", redirectUri: "u" });

    await expect(start()).rejects.toThrow("metadata request failed (503)");
    await expect(start()).resolves.toMatchObject({ clientId: "registered-client" });
  });

  it("refuses dynamic registration when the server offers none", async () => {
    const connector = createConnector(notion, {
      fetch: vi.fn<typeof fetch>(async () =>
        Response.json({ ...METADATA, registration_endpoint: undefined }),
      ),
    });

    await expect(
      connector.start({ state: "s", codeChallenge: "c", redirectUri: "u" }),
    ).rejects.toThrow("does not offer client registration");
  });

  it("reports a refused client registration", async () => {
    const connector = createConnector(notion, {
      fetch: vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith("/register")
          ? new Response("no", { status: 403 })
          : Response.json(METADATA),
      ),
    });

    await expect(
      connector.start({ state: "s", codeChallenge: "c", redirectUri: "u" }),
    ).rejects.toThrow("client registration failed (403)");
  });

  it.each([
    ["another error code", Response.json({ error: "invalid_client" }, { status: 400 })],
    ["a body that is not JSON", new Response("Bad gateway", { status: 502 })],
  ])("reports a token request refused with %s as a failure to retry", async (_name, answer) => {
    const connector = createConnector(sheets, { fetch: vi.fn<typeof fetch>(async () => answer) });

    const failure = await connector.refresh(tokens).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(InvalidGrantError);
    expect(String(failure)).toContain("token request failed");
  });

  it("refuses to refresh a connection that has no refresh token", async () => {
    const send = vi.fn<typeof fetch>();
    const connector = createConnector(sheets, { fetch: send });

    await expect(connector.refresh({ ...tokens, refreshToken: null })).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the refresh token and the expiry open when the provider returns neither", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ access_token: "new" }));
    const connector = createConnector(sheets, { clientId: "google-id", fetch: send });

    expect(await connector.refresh(tokens)).toEqual({
      accessToken: "new",
      refreshToken: "r",
      expiresAt: null,
      clientId: null,
    });
    expect(lastRequestBody(send as never).get("client_id")).toBe("google-id");
  });

  it("revokes the refresh token, or the access token when there is none", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const connector = createConnector(sheets, { clientId: "google-id", fetch: send });

    await connector.revoke(tokens);
    await connector.revoke({ ...tokens, refreshToken: null });

    expect(String(send.mock.calls[0]?.[0])).toBe("https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(String(send.mock.calls[0]?.[1]?.body)).get("token")).toBe("r");
    expect(new URLSearchParams(String(send.mock.calls[1]?.[1]?.body)).get("token")).toBe("a");
  });

  it("does nothing to revoke when the provider has no revocation endpoint", async () => {
    const send = vi.fn<typeof fetch>();

    const connector = createConnector(
      { ...sheets, oauth: { ...sheets.oauth, revokeUrl: undefined } },
      { fetch: send },
    );

    await connector.revoke(tokens);

    expect(send).not.toHaveBeenCalled();
  });

  it("reports a refused revocation", async () => {
    const connector = createConnector(sheets, {
      fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 500 })),
    });

    await expect(connector.revoke(tokens)).rejects.toThrow(
      "token revocation failed with status 500",
    );
  });
});
