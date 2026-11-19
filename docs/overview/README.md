# High-level design

Leren is a monorepo of three applications that share a set of internal packages.

## Components

| Component  | Role                                                                  |
| ---------- | --------------------------------------------------------------------- |
| `platform` | The web application that users interact with.                         |
| `api`      | The HTTP service that the platform calls. It validates every request. |
| `worker`   | Runs background jobs and AI agents outside the request path.          |

## How they fit together

```
platform  ──HTTP──▶  api  ──enqueue──▶  worker
                      │                   │
                      └──── packages ─────┘
                        (db, agents, observability)
```

1. The platform sends requests to the API.
2. The API handles quick work directly. Long-running or retryable work is queued as a job.
3. The worker takes jobs from the queue, validates their payloads and runs them. AI agents run as jobs.

## Shared packages

| Package                | Purpose                    |
| ---------------------- | -------------------------- |
| `@leren/db`            | Database client and schema |
| `@leren/vector-db`     | Vector store abstraction   |
| `@leren/agents`        | Contracts for AI agents    |
| `@leren/observability` | Logging                    |
| `@leren/ui`            | Shared React components    |

## Current limitations

The job queue is in memory and exists only inside the worker process. Jobs are lost when the worker restarts, and the API cannot enqueue jobs until a persistent queue is chosen.
