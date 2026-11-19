# Backend rules

Applies to `apps/api` and `apps/worker`. Background: [0001](../decision/0001-api-module-driven-structure.md).

## API modules

Each feature lives in `apps/api/src/modules/:module-name/`:

| File         | Responsibility                                  |
| ------------ | ----------------------------------------------- |
| `router.ts`  | Hono routes and `zValidator` request validation |
| `schema.ts`  | zod schemas and inferred types                  |
| `service.ts` | Business logic, independent of HTTP             |

- Validate every request body, query and param with `zValidator` and a schema from `schema.ts`.
- Keep route handlers thin: parse, call the service, return the response.
- Services take plain arguments and return plain values. They do not touch Hono's context.
- Do not import another module's `router.ts` or `service.ts` internals. Move shared code to a package.
- Mount each module's router in `src/index.ts`.

## Worker

- Define each job with `defineJob` and a zod payload schema, then register it in `jobs/index.ts`.
- Jobs must be safe to retry.
- Respect the `signal` passed in the job context so work can be cancelled.
- Run AI agents through the `run-agent` job, not directly from the API.
