/**
 * Type-only entry point for clients of the API. The platform imports these types with
 * `import type` to call the API through Hono RPC and to type the Better Auth client. It must never
 * export a runtime value.
 */
export type { AppType } from "./app";

export type { Auth } from "./modules/auth/service";

export type { PlaybookInput } from "./modules/playbooks/schema";
