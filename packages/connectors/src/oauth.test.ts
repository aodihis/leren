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
