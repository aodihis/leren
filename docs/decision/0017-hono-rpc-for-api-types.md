# 0017. Hono RPC for API types

- Status: Accepted
- Date: 2026-11-20
- Affects: apps/api, apps/platform, docs/rules/architecture.md, docs/rules/backend.md, docs/rules/frontend.md, AGENTS.md

## Context

The platform redefined the shapes the API already knows: the profile form had its own zod schema and the auth client re-declared the extra user fields. Two definitions of one contract drift apart. A shared `packages/contract` package was considered. It would still need the API and the platform to each import and keep in sync a schema that mirrors the routes.

## Decision

The API exposes its types through Hono RPC. `apps/api` has a type-only entry point, `@leren/api/client`, that exports `AppType` and the Better Auth `Auth` type. The platform imports them with `import type`, builds a typed client with `hc<AppType>` in `src/modules/api/api-client.ts`, and types the Better Auth client with `inferAdditionalFields<Auth>()`.

This is the only exception to the rule that apps do not import from each other. The entry point must contain only type exports, so no API code reaches the browser bundle. The platform does not define zod schemas for data the API validates. The API owns validation and responds to an invalid request with `400` and `{ fieldErrors }`, using the `validate` helper in `apps/api/src/validation.ts`, and the platform shows those messages next to the fields.

Routes that the platform calls are chained on the Hono instance, because Hono infers types from the chain.

## Consequences

- A change to a route's input or output is a type error in the platform until the call sites are updated.
- The platform typechecks against the API's source, so an API type error also fails the platform's typecheck.
- Form validation messages come from the API, so a form needs a round trip to show them.
- Routes handled by Better Auth under `/api/auth` are typed by its own client, not by Hono RPC.
