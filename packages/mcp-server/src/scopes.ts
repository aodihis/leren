/** The scopes that gate MCP tools and resources. */
export const SCOPES = ["playbooks:read", "playbooks:write"] as const;

export type Scope = (typeof SCOPES)[number];

/** The built-in clients of the MCP server. */
export const CLIENT_ROLES = ["assistant", "reply"] as const;

export type ClientRole = (typeof CLIENT_ROLES)[number];

/** The most scopes each role may hold. */
export const ROLE_SCOPES: Record<ClientRole, readonly Scope[]> = {
  assistant: ["playbooks:read", "playbooks:write"],
  reply: ["playbooks:read"],
};

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}
