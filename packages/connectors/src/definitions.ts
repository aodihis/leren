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

/** The hosted Google Sheets MCP server, which a deployment can replace with `GOOGLE_SHEETS_MCP_URL`. */
const GOOGLE_SHEETS_MCP_URL = "https://sheetsmcp.googleapis.com/mcp/v1";

/** The settings that the definitions need from the environment. */
export type DefinitionSettings = {
  GOOGLE_DOCS_MCP_URL?: string | undefined;
  GOOGLE_SHEETS_MCP_URL?: string | undefined;
};

/**
 * Builds the definition of a connector. Every tool in `allowedTools` only reads. The Google MCP
 * addresses come from the environment, because they belong to the deployment's Google project.
 */
export function defineConnector(
  id: ConnectorId,
  settings: DefinitionSettings,
): ConnectorDefinition {
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
        mcpUrl: settings.GOOGLE_DOCS_MCP_URL ?? "",
        allowedTools: ["search_documents", "get_document"],
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
        mcpUrl: settings.GOOGLE_SHEETS_MCP_URL ?? GOOGLE_SHEETS_MCP_URL,
        allowedTools: ["get_spreadsheet", "get_values"],
        oauth: {
          ...GOOGLE_OAUTH,
          scopes: ["openid", "email", "https://www.googleapis.com/auth/spreadsheets.readonly"],
        },
        identify: readGoogleIdentity,
      };
  }
}
