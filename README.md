# Leren

Leren is a pnpm monorepo with a web platform, an HTTP API and a background worker for jobs and AI agents.

For how the system fits together, read the [high-level design](docs/overview/README.md).

## Requirements

- Node.js 20 or later
- pnpm 11

## Getting started

```sh
pnpm install
pnpm services:up
pnpm --filter @leren/api dev
pnpm --filter @leren/platform dev
pnpm --filter @leren/worker dev
```

Copy `.env.example` to `.env` first and set `BETTER_AUTH_SECRET`. The worker needs `RABBITMQ_URL`.

`pnpm services:up` starts the local services from `docker-compose.dev.yml`, which is for development only: PostgreSQL, Qdrant, RabbitMQ and Mailpit. Mailpit catches every email the API sends. Open its inbox at http://localhost:58025 to read sign-in codes.

Apply the database migrations with `pnpm --filter @leren/db db:migrate`.

## Commands

| Command             | Purpose           |
| ------------------- | ----------------- |
| `pnpm lint`         | Run oxlint        |
| `pnpm format`       | Format with oxfmt |
| `pnpm format:check` | Check formatting  |

## Repository layout

| Folder      | Contents                                      |
| ----------- | --------------------------------------------- |
| `apps/`     | `api`, `platform` and `worker`                |
| `packages/` | Shared packages under the `@leren` scope      |
| `tooling/`  | Local development tooling, such as lint rules |
| `docs/`     | Overview, decisions, rules                    |

## Documentation

- [Overview and high-level design](docs/overview/README.md)
