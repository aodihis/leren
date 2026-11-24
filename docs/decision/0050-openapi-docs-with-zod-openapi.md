# 0050. OpenAPI documentation with zod-openapi and Scalar

- Status: Accepted
- Date: 2026-11-24
- Affects: apps/api, docs/rules/backend.md

## Context

The API had no reference that a reader could open. The routes already validate requests with zod, so the same schemas can describe them.

## Decision

`createApp` builds an `OpenAPIHono` application from `@hono/zod-openapi`. A route is declared with `createRoute` and mounted with `.openapi()`, so its request and response schemas are the OpenAPI description and the types that Hono RPC infers (decision 0017). The application serves the document at `/openapi.json` and the Scalar reference at `/scalar`. A failed validation answers `400` with `{ fieldErrors }` through `validationHook`.

The module layout does not change. The playbooks module is documented first. A router that is still a plain `Hono` instance works as before and is not in the document until it moves to `OpenAPIHono`.

## Consequences

- New routes use `createRoute` and `.openapi()`. Middleware is attached with `router.use()` before the chain, because `.use()` in the chain loses the `OpenAPIHono` type.
- Response bodies that come from services are typed with `z.custom<Type>()` and described as objects.
- The routes of the other modules are added to the document as they are migrated.
