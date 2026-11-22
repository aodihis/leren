# 0015. API runs from source

- Status: Accepted
- Date: 2026-11-20
- Affects: apps/api, docs/rules/backend.md

## Context

The API imports workspace packages that are source-only ([packages rules](../rules/packages.md)). The `NodeNext` resolution that `tsc` used to build the API requires file extensions in relative imports and cannot compile that source, as described in [0012](0012-worker-module-driven-structure.md) for the worker.

## Decision

The API follows the worker: `tsconfig.json` uses `Bundler` resolution with `noEmit`, there is no `build` script, and `pnpm --filter @leren/api start` runs `tsx` on the TypeScript source. `start` and `dev` read the repository's `.env` when it exists.

## Consequences

- A deployment runs `tsx` on the source, or introduces a bundler through a new decision.
- Type errors are caught by `pnpm typecheck` and not by a build step.
