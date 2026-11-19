# Package rules

Applies to everything in `packages/`.

- Name packages `@leren/<name>`.
- Packages are source-only: `exports` points at the TypeScript entry file and there is no build step.
- Consume them from apps with `"@leren/<name>": "workspace:*"`.
- Each package exposes its public API from `src/index.ts`. Do not import deep paths from another package. Test-only helpers live in a separate entry point, such as `@leren/db/testing`, so production code does not import them.
- Packages never import from `apps/*`.
- Each package has a `typecheck` script.
- `@leren/ui` lists `react` as a peer dependency. Other packages should avoid framework dependencies unless that is their purpose.
- `@leren/ui` holds shadcn/ui components, which are excluded from the linter and formatter. See [0004](../decision/0004-shadcn-in-ui-package.md).

## Current packages

| Package                | Purpose                    |
| ---------------------- | -------------------------- |
| `@leren/agents`        | AI agent contracts         |
| `@leren/ui`            | Shared React components    |
| `@leren/observability` | Logging and tracing        |
| `@leren/db`            | Database client and schema |
| `@leren/vector-db`     | Vector store abstraction   |
