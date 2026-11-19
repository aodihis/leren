# 0002. Module-driven structure for the frontend

- Status: Accepted
- Date: 2026-11-19
- Affects: apps/platform, packages/ui

## Context

`apps/platform` uses TanStack Router with file-based routing, so route files already define the pages. Everything else needs a consistent home so features stay cohesive.

## Decision

Organise reusable feature code by module under `src/modules/:module-name/`:

```
src/modules/:module-name/
  components/   reusable components only
  hooks/        reusable hooks only
  types.ts      types for the module
```

- Pages and routes are written in `src/routes/`, not in modules.
- `components/` and `hooks/` hold only code that is reused. Code used by a single route stays in that route file.
- Generic, app-agnostic components belong in `packages/ui`, not in a module.

## Consequences

- Route files stay the single place to find a page, matching TanStack Router file-based routing.
- Modules hold only what is shared, so they stay small.
- Deciding whether something is "reusable" is a judgement call. Start inside the route and extract to a module when a second use appears.
