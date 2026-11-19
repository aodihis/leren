# 0001. Module-driven structure for the API

- Status: Accepted
- Date: 2026-11-19
- Affects: apps/api

## Context

`apps/api` will grow with each feature. Grouping code by technical layer (all routers together, all services together) spreads one feature across many folders and makes features hard to find, change or remove.

## Decision

Organise the API by feature module under `src/modules/:module-name/`:

```
src/modules/:module-name/
  router.ts    HTTP routes (Hono) and request validation
  schema.ts    zod schemas and the types inferred from them
  service.ts   business logic, with no HTTP concerns
```

- `router.ts` exports a Hono instance that `src/index.ts` mounts.
- `router.ts` calls `service.ts`. It does not hold business logic.
- `service.ts` does not import from `router.ts` or from Hono.
- `schema.ts` is the single source for the module's input and output shapes.

## Consequences

- A feature lives in one folder, so it is easy to find and remove.
- The current inline routes in `apps/api/src/index.ts` should move into modules as they are touched.
- Code shared by several modules goes in a `packages/*` package or an explicit shared folder, not by importing from another module's internals.
