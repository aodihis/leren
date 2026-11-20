# 0016. Playwright for end-to-end tests

- Status: Accepted
- Date: 2026-11-20
- Affects: tests/e2e, package.json, pnpm-workspace.yaml, docs/rules/general.md, docs/rules/architecture.md

## Context

[0009](0009-vitest-for-unit-tests.md) covers unit and integration tests that run in Node next to the code. Nothing checks that the platform, API, database and email work together in a browser, such as the sign-in flow from [0013](0013-better-auth-email-code.md).

## Decision

Use Playwright, in a workspace package `@leren/e2e` at `tests/e2e`. Specs live in `tests/e2e/specs/`. Integration tests stay in Vitest next to the code, because they share its runner, speed and mocking tools, and `tests/` holds only browser tests.

Playwright starts its own API and platform on ports 13100 and 15174, against a `leren_e2e` database that is recreated and migrated at the start of each run. This keeps the tests independent of the development servers and data. PostgreSQL and Mailpit from `docker-compose.dev.yml` must be running, and the tests read sign-in codes from Mailpit's HTTP API. Tests use unique email addresses, so they can run in parallel.

## Consequences

- `pnpm test:e2e` is separate from `pnpm test` and is not part of `pnpm check`, because it needs running services and a browser download.
- End-to-end tests do not count toward the coverage threshold.
- Every new user-facing flow should get a spec for its main path.
