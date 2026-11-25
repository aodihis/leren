# 0056. Production runs a bundled build

- Status: Accepted
- Date: 2026-11-25
- Affects: tooling/build, docker/app.Dockerfile, docker-compose.prod.yml, .github/workflows/deploy.yml, packages/db, package.json

## Context

[0015](0015-api-runs-from-source.md) and [0012](0012-worker-module-driven-structure.md) make the API and the worker run from TypeScript source with `tsx`. That choice is for local development. [0055](0055-docker-deployment-on-one-host.md) reused it in the production image, which therefore holds the whole source tree, the development dependencies and `tsx`, and which runs the migration with `drizzle-kit`.

## Decision

- Production runs a build. `pnpm build:app` bundles the API, the worker, the migration script and the harness config with esbuild into `out/`. Each bundle contains the workspace packages and every dependency, so `out/` needs no `node_modules`.
- The files that the code reads at run time are copied to `out/` at the relative paths they have next to a bundle in the source tree: `drizzle/`, `skills/`, `prompts/` and `harness.config.js`. The process finds the config through `HARNESS_CONFIG`.
- The migration is `packages/db/src/migrate.ts`, which uses the migrator of Drizzle ORM, so production needs no `drizzle-kit`.
- The image of the API and the worker is built in two stages and the final stage holds only `out/`. The container command selects `dist/api.js` or `dist/worker.js`.
- Local development keeps running from source with `tsx` as before. [0015](0015-api-runs-from-source.md) stays in force for development.
- The Docker build context leaves out `docs/` and the repository's README files.

## Consequences

- The production image contains no source code and no development dependencies.
- A new file that the code reads at run time must be copied by `tooling/build/build.mjs` to the path the code expects.
- A dependency that is loaded by a name that esbuild cannot see, such as a logger transport, does not work in the bundle. The production logger writes JSON lines and needs no transport.
- Type errors are still caught by `pnpm typecheck`, and not by the build.
- This decision replaces the last consequence of [0055](0055-docker-deployment-on-one-host.md), which says that the images run `tsx` on the source.
