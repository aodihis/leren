import { z } from "zod";

import type { ConnectorDefinition, ConnectorId, TokenResponse } from "./types";

const googleIdTokenSchema = z.object({ sub: z.string().min(1), email: z.string().min(1) });

const notionIdentitySchema = z.object({
  workspace_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  bot_id: z.string().min(1).optional(),
  workspace_name: z.string().nullish(),
});

/** Reads the claims of a Google ID token. The token comes straight from Google's token endpoint. */
function readGoogleIdentity(response: TokenResponse) {
  const idToken = z.string().parse(response.id_token);
  const [, payload] = idToken.split(".");

  const claims = googleIdTokenSchema.parse(
    JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")),
  );

  return { providerAccountId: claims.sub, label: claims.email };
}

const GOOGLE_OAUTH = {
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  authorizationParameters: { access_type: "offline", prompt: "consent" },
  registration: "static",
} as const;

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";

const GOOGLE_SHEETS_MCP_URL = "https://sheetsmcp.googleapis.com/mcp/v1";
const GOOGLE_DOCS_MCP_URL = "https://docsmcp.googleapis.com/mcp/v1";

/**
 * Builds the definition of a connector. Every tool in `allowedTools` only reads. The MCP addresses
 * are fixed, because they are the hosted servers of the providers.
 */
export function defineConnector(id: ConnectorId): ConnectorDefinition {
  switch (id) {
    case "notion":
      return {
        id,
        displayName: "Notion",
        mcpUrl: NOTION_MCP_URL,
        allowedTools: ["notion-search", "notion-fetch", "notion-query-data-sources"],
        oauth: {
          registration: "dynamic",
          metadataUrl: "https://mcp.notion.com/.well-known/oauth-authorization-server",
          scopes: [],
          resource: NOTION_MCP_URL,
        },
        identify(response) {
          const parsed = notionIdentitySchema.parse(response);

          return {
            providerAccountId: parsed.workspace_id ?? parsed.user_id ?? parsed.bot_id ?? "notion",
            label: parsed.workspace_name ?? "Notion workspace",
          };
        },
      };
    case "google_docs":
      return {
        id,
        displayName: "Google Docs",
        mcpUrl: GOOGLE_DOCS_MCP_URL,
        allowedTools: ["read_doc"],
        oauth: {
          ...GOOGLE_OAUTH,
          scopes: ["openid", "email", "https://www.googleapis.com/auth/documents.readonly"],
        },
        identify: readGoogleIdentity,
      };
    case "google_sheets":
      return {
        id,
        displayName: "Google Sheets",
        mcpUrl: GOOGLE_SHEETS_MCP_URL,
        allowedTools: ["get_spreadsheet", "get_values"],
        oauth: {
          ...GOOGLE_OAUTH,
          scopes: ["openid", "email", "https://www.googleapis.com/auth/spreadsheets.readonly"],
        },
        identify: readGoogleIdentity,
      };
  }
}
