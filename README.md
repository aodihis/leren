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

Copy `.env.example` to `.env` first and set `BETTER_AUTH_SECRET`. The worker needs `RABBITMQ_URL` and `EMBEDDING_API_KEY`, which is an OpenRouter key by default, and the API needs `RABBITMQ_URL`.

To keep `.env` encrypted with [dotenvx](https://dotenvx.com/docs/quickstart), run `pnpm env:encrypt`. It writes the private key to `.env.keys`, which must never be committed. Then start the processes with `pnpm api:dev:secure`, `pnpm worker:dev:secure`, `pnpm runner:assistant:secure` or `pnpm runner:reply:secure`. The `api:start:secure` and `worker:start:secure` scripts run without file watching.

`pnpm services:up` starts the local services from `docker-compose.dev.yml`, which is for development only: PostgreSQL, Qdrant, RabbitMQ and Mailpit. Mailpit catches every email the API sends. Open its inbox at http://localhost:58025 to read sign-in codes.

Apply the database migrations with `pnpm --filter @leren/db db:migrate`.

## Commands

| Command             | Purpose           |
| ------------------- | ----------------- |
| `pnpm lint`         | Run oxlint        |
| `pnpm format`       | Format with oxfmt |
| `pnpm format:check` | Check formatting  |
| `pnpm test`         | Run unit tests    |
| `pnpm test:e2e`     | Run Playwright    |

## Repository layout

| Folder      | Contents                                      |
| ----------- | --------------------------------------------- |
| `apps/`     | `api`, `platform` and `worker`                |
| `packages/` | Shared packages under the `@leren` scope      |
| `tests/`    | End-to-end tests                              |
| `tooling/`  | Local development tooling, such as lint rules |
| `docs/`     | Overview, decisions, rules                    |

## Documentation

- [Overview and high-level design](docs/overview/README.md)
