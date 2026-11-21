/** The scopes that gate MCP tools, resources and prompts. */
export const SCOPES = ["playbooks:read", "playbooks:write"] as const;

export type Scope = (typeof SCOPES)[number];

/** The built-in clients of the MCP server. */
export const CLIENT_ROLES = ["assistant", "reply"] as const;

export type ClientRole = (typeof CLIENT_ROLES)[number];

/**
 * The most scopes each role may hold. A session never receives a scope outside its role's set, and
 * the reply role has no scope that changes data.
 */
export const ROLE_SCOPES: Record<ClientRole, readonly Scope[]> = {
  assistant: ["playbooks:read", "playbooks:write"],
  reply: ["playbooks:read"],
};

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}
