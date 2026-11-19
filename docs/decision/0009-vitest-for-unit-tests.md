# 0009. Vitest with V8 coverage for unit tests

- Status: Accepted
- Date: 2026-11-19
- Affects: package.json, vitest.config.ts, apps/api, apps/worker, apps/platform, packages/db, packages/ui, packages/vector-db, packages/observability, docs/rules/general.md

## Context

The repository has no test runner for application code. Only the custom lint rules have tests. The team wants unit tests that check a flow by replacing collaborators with test doubles, and a coverage floor that fails the run when it is not met.

The platform already builds with Vite, so a Vite-based runner reuses the same transform pipeline. Agent behavior in `packages/agents` is evaluated with evals, so unit-test coverage is not a useful measure there.

## Decision

Use Vitest as the test runner for every app and package, configured once in `vitest.config.ts` at the repository root. Collect coverage with `@vitest/coverage-v8`.

- Tests live next to the code as `*.test.ts` or `*.test.tsx` under `src/`.
- Coverage thresholds are 80% for lines, branches, functions and statements, measured across the source of all apps and packages.
- `packages/agents` is excluded from coverage. Generated and vendored files are excluded as well: `routeTree.gen.ts` and the shadcn files in `packages/ui`.
- Tests run in the `node` environment. A package that needs a DOM adds a per-package environment when its first component test is written.

## Consequences

- `pnpm test` runs the tests, and `pnpm test:coverage` runs them with the coverage thresholds. A drop below 80% fails the run.
- Coverage is measured on the combined source, so the threshold fails until enough tests exist. `pnpm test:coverage` is not a required check until the first tests are written.
- Thresholds are not lowered to make a change pass.
- Component tests need a DOM environment and a testing library. Adding them is a separate decision.
- The `build` scripts of `apps/api` and `apps/worker` compile `src` with `tsc`, so test files are emitted into `dist` unless those packages exclude them.
