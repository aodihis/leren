# Leren

Leren is a pnpm monorepo with a web platform, an HTTP API and a background worker for jobs and AI agents.

For how the system fits together, read the [high-level design](docs/overview/README.md).

## Requirements

- Node.js 20 or later
- pnpm 11

## Getting started

```sh
pnpm install
pnpm --filter @leren/api dev
pnpm --filter @leren/platform dev
pnpm --filter @leren/worker dev
```

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
