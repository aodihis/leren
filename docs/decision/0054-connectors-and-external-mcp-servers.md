# 0054. Connectors and external MCP servers for the assistant

- Status: Accepted
- Date: 2026-11-25
- Affects: packages/db, packages/connectors, packages/agents, packages/assistant-agent, apps/api, apps/platform, prompts/assistant.md, .env.example, docs/overview/README.md

## Context

Users keep facts that belong in playbooks in other tools, such as a holiday list in Notion. The Assistant Agent can reach only Leren's own MCP server ([0008](0008-mcp-server-in-api.md)). A user should be able to link a tool and let the assistant read it, and a tool that the user has not linked must never be visible to the agent.

## Decision

- A **connector** is a user's OAuth authorisation of one external MCP server. The first connectors are `notion`, `google_docs` and `google_sheets`.
- A definition in `@leren/connectors` describes each connector: the MCP address, the OAuth endpoints and scopes, how to read the account out of the token response, and `allowedTools`. `allowedTools` holds only tools that read. The client drops every other tool that the server advertises, so the assistant cannot change data in a connected tool. Definitions are code and not plugins ([0011](0011-harness-config-and-plugins.md)), because a plugin is trusted code that is loaded once for every user, while a connector is registered for one user and one run.
- The environment variable `CONNECTORS` lists the enabled connectors and defaults to empty. The API fails at startup when an enabled connector lacks its variables. An enabled connector needs `CHANNEL_TOKEN_ENCRYPTION_KEY`. The Google connectors need `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The MCP addresses are fixed in the definitions and are not configurable.
- A connector registers its OAuth client in one of two ways. A `static` client is the deployment's own Google client. A `dynamic` client is registered at the authorization server for each connection, as a public client (RFC 7591), and Notion works this way. The endpoints of a `dynamic` connector are discovered from the server's metadata (RFC 8414), and the issuer must equal the origin of the metadata address. The authorization and token requests carry the `resource` parameter (RFC 8707). The client id of a connection is stored with its encrypted tokens, because a refresh must present the same client.
- The `connectors` table holds the user, the connector, the provider's account id, a label, encrypted credentials and a status of `active` or `revoked`. It is unique on the user and the connector. Credentials use the encryption of [0038](0038-channel-providers-and-google-oauth.md), with the id of the row as the additional authenticated data. A token is refreshed when it is used and has expired. When the authorization server rejects the refresh token, the connection becomes `revoked`.
- The routes are `GET /api/connectors`, `POST /api/connectors/:connector/connect`, `GET /api/connectors/:connector/callback` and `DELETE /api/connectors/:connector`. The connect flow is the one of 0038: a random `state`, PKCE and a signed cookie that expires after ten minutes. Disconnecting revokes the tokens when the authorization server has a revocation endpoint and then deletes the row.
- Each run of the Assistant Agent opens an MCP client for every **active** connection of the signed-in user whose connector is enabled, and for no other. A user without connections registers no external server. A connection whose token or server is unavailable is skipped and logged, and the run goes on. The address is checked against loopback and private ranges, because it does not belong to Leren. The tools of each server get the connector id as a prefix. The Reply Agent and every other agent never receive connectors.
- Text that the assistant reads from a connected tool is data. The prompt tells the assistant to ignore any instruction inside it, and a playbook is still saved only after the user confirms its exact content ([0032](0032-assistant-writes-with-confirmation.md)).
- The skill `connector-to-playbook` turns what the assistant read into draft playbooks. A single date becomes a one-day period, a range becomes its first and last day, a topic is generated when the user gives none, and the user is asked whether to refine the information. The assistant asks for the fields it still lacks, such as the timezone, the senders or the reply mode, in one message, as a bulleted list when there is more than one.

## Consequences

- A connection grants read access to the user's data in the external tool until the user disconnects it. Reading is limited to the tools in `allowedTools`.
- The tool names in `allowedTools` must match the server. A name that does not match exposes no tool, so a wrong value fails closed. Notion exposes `notion-search`, `notion-fetch` and `notion-query-data-sources`, and Google Sheets exposes `get_spreadsheet` and `get_values`. Google Docs exposes `read_doc` and `update_doc`, and only `read_doc` is allowed.
- Notion's hosted MCP server issues tokens through its own authorization server, and no deployment setting is needed for it.
- A Google connector uses a read-only scope of Google, and Google's verification rules for sensitive scopes apply, as they do in 0038.
- The connection list is per user, and the Connectors page is the only place where a user adds or removes a connector.
