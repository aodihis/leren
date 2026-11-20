# Architecture rules

## Layout

```
apps/       deployable applications (api, platform, worker)
packages/   shared libraries (agents, ui, observability, db)
tests/      end-to-end tests (Playwright)
tooling/    development tooling (oxlint rules)
docs/       decisions and rules
```

## Dependency direction

- Apps may depend on packages. Packages never depend on apps.
- Apps do not import from each other. Share code through a package.
- Packages should depend on as few other packages as possible.
- `tooling/` is not imported by application code.

## Process boundaries

- `apps/api` handles requests and stays fast. Long-running or retryable work goes to `apps/worker` as a job.
- AI agent execution runs in the worker through the `run-agent` job.

## Decisions

- [0001 API module-driven structure](../decision/0001-api-module-driven-structure.md)
- [0002 Frontend module-driven structure](../decision/0002-frontend-module-driven-structure.md)
- [0005 RabbitMQ for background queues](../decision/0005-rabbitmq-for-queues.md)
- [0012 Worker module-driven structure](../decision/0012-worker-module-driven-structure.md)

See also [backend](backend.md), [frontend](frontend.md), [packages](packages.md) and [general](general.md).
