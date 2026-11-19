# 0005. RabbitMQ for background queues

- Status: Accepted
- Date: 2026-11-19
- Affects: apps/worker, apps/api, packages/queue, docker-compose.yml, docs/rules/backend.md, docs/overview/README.md

## Context

The worker queue is in memory, so jobs are lost on restart and the API cannot enqueue work. The email pipeline needs durable stages with retries and dead-letter handling. The expected volume is small: tens to hundreds of emails per auto-reply rule.

## Decision

Use RabbitMQ. Add a `packages/queue` package that wraps publish and consume, retry with backoff, dead-letter queues and idempotency keys. The queues are `email.received`, `email.process`, `email.send` and `knowledge.index`. The existing `defineJob` contract in `apps/worker` is kept on top of the package. Kafka was considered and rejected: replay and very high throughput are not needed, and it is heavier to run.

## Consequences

- Jobs survive worker restarts and failed jobs end up in a dead-letter queue.
- Every handler must be idempotent, because delivery is at least once.
- Local development needs a RabbitMQ container in `docker-compose.yml`.
