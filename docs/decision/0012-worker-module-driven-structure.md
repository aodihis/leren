# 0012. Module-driven structure for the worker

- Status: Accepted
- Date: 2026-11-19
- Affects: apps/worker, packages/queue, docs/rules/backend.md, docs/rules/architecture.md

## Context

[0001](0001-api-module-driven-structure.md) organises the API by feature. The worker will gain a consumer for each stage of the email pipeline, so it faces the same growth. Today it groups code by technical layer: `jobs/`, `agents/` and `queue/`. With [0005](0005-rabbitmq-for-queues.md) the queue implementation moves to `packages/queue`, which leaves the worker with only the jobs and the runtime that runs them.

Packages are source-only ([packages rules](../rules/packages.md)), so the worker must be able to import TypeScript source from `@leren/queue`. The worker's `tsc` build with `NodeNext` resolution cannot do that.

## Decision

Organise the worker by feature module under `src/modules/:module-name/`, mirroring the API:

```
src/modules/:module-name/
  job.ts       the job definition: queue name, payload schema, retry policy and handler binding
  schema.ts    zod schemas and the types inferred from them
  service.ts   business logic, with no queue concerns
```

- `job.ts` exports a job created with `defineJob`. It validates the payload with `schema.ts` and calls `service.ts`. It holds no business logic.
- `service.ts` does not import from `job.ts` or from `@leren/queue`.
- `src/modules/index.ts` lists every job. The worker registers one consumer for each.
- A module's job name is the name of its queue.
- `src/job.ts` holds `defineJob` and the job types, and `src/worker.ts` holds the runtime that binds jobs to a `QueueClient`. Neither belongs to a feature.
- Modules do not import each other's `job.ts` or `service.ts`. Shared code goes in a package.
- A job whose payload fails validation throws `NonRetryableError` so that it is dead-lettered at once.

The worker is run with `tsx` and typechecked with `Bundler` module resolution, like the packages and `apps/platform`. It has no `tsc` build step.

## Consequences

- A feature lives in one folder in both backends, so it is easy to find and remove.
- The `example` job is removed, and the `run-agent` job becomes a module.
- The worker cannot be started from compiled output. The `start` script runs `tsx`.
