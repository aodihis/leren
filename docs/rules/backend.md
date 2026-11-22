# Backend rules

Applies to `apps/api` and `apps/worker`. Background: [0001](../decision/0001-api-module-driven-structure.md).

## API modules

Each feature lives in `apps/api/src/modules/:module-name/`:

| File         | Responsibility                                  |
| ------------ | ----------------------------------------------- |
| `router.ts`  | Hono routes and `zValidator` request validation |
| `schema.ts`  | zod schemas and inferred types                  |
| `service.ts` | Business logic, independent of HTTP             |

- Validate every request body, query and param with `validate` from `src/validation.ts` (a `zValidator` that responds with `400` and `{ fieldErrors }`) and a schema from `schema.ts`.
- Chain the routes of a router on the `Hono` instance and return it, so Hono RPC can infer their types for the platform. Export any other type the platform needs from `src/client.ts`, which must stay type-only.
- Keep route handlers thin: parse, call the service, return the response.
- Services take plain arguments and return plain values. They do not touch Hono's context.
- Do not import another module's `router.ts` or `service.ts` internals. Move shared code to a package.
- Mount each module's router in `createApp` in `src/app.ts`.
- Protect a route that serves user data with `requireUser` from the `auth` module and scope every query by `c.get("userId")`. See [0013](../decision/0013-better-auth-email-code.md).
- The `/mcp` route does not use `requireUser`. It accepts only a bearer session token, which `@leren/mcp-server` verifies against `mcp_sessions`. Routes that mint or revoke those sessions use `requireUser`. See [0031](../decision/0031-mcp-sessions-audit-and-proposals.md) and [0032](../decision/0032-assistant-writes-with-confirmation.md). Tools that change data call the same services as the routes. Each module builds its own in `mcp-actions.ts`, and `createApp` composes them and passes them to `@leren/mcp-server`, so no module imports another module's service.
- The `assistant` module serves the chat over Anvia's client protocol and keeps conversations in Anvia's Drizzle memory store, which is the only chat state. See [0034](../decision/0034-assistant-chat-over-anvia-protocol.md).

## Worker modules

Each feature lives in `apps/worker/src/modules/:module-name/`. Background: [0012](../decision/0012-worker-module-driven-structure.md).

| File         | Responsibility                                        |
| ------------ | ----------------------------------------------------- |
| `job.ts`     | `defineJob`: queue name, payload schema, retry policy |
| `schema.ts`  | zod schemas and inferred types                        |
| `service.ts` | Business logic, independent of the queue              |

- A job's name is the name of its queue. Register each job in `modules/index.ts`.
- Keep `job.ts` thin: pass the validated payload to the service. The worker validates the payload against the job's schema and dead-letters an invalid one without retrying.
- Services take plain arguments and return plain values. They do not import `@leren/queue`.
- Do not import another module's `job.ts` or `service.ts`. Move shared code to a package.
- Delivery is at least once, so jobs must be safe to retry. Use `runOnce` from `@leren/queue` with the message's `idempotencyKey` when a repeat would have a visible effect.
- Respect the `signal` passed in the job context so work can be cancelled.
- Throw `NonRetryableError` when another attempt cannot succeed.
- Run AI agents through the `run-agent` job, not directly from the API.
