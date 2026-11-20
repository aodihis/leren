# 0018. Testing Library and jsdom for platform component tests

- Status: Accepted
- Date: 2026-11-20
- Affects: apps/platform, vitest.config.ts, docs/rules/general.md, docs/rules/frontend.md

## Context

Decision [0009](0009-vitest-for-unit-tests.md) runs every unit test in the `node` environment and leaves component tests to a separate decision. The routes of `apps/platform` hold most of the platform's logic: route guards, redirects, form validation and the handling of API errors. Without a DOM they have no unit tests, and they are the largest source of uncovered branches against the 80% threshold.

## Decision

Test platform routes by rendering them with `@testing-library/react` in a `jsdom` environment, driven by `@testing-library/user-event`.

- `vitest.config.ts` defines two projects. The `platform` project runs `apps/platform/src/**/*.test.{ts,tsx}` in `jsdom` and loads `apps/platform/vitest.setup.ts`. The `node` project runs every other test. Coverage thresholds still apply to the combined source.
- A route test renders the real route tree at a path with `renderApp` from `apps/platform/src/testing.tsx`, which uses an in-memory history. It replaces the Better Auth client and the API client with test doubles, because they are the platform's only network boundaries.
- Tests query by role, label and text, and drive the page with user events. They do not assert on component internals.
- `src/routeTree.gen.ts` is generated and git-ignored. Run `pnpm --filter @leren/platform build` or `pnpm --filter @leren/platform dev` once before the tests on a fresh checkout.

## Consequences

- Route guards, redirects and form flows are covered at the boundary a visitor uses, and a behavior-preserving refactor of a component does not break its tests.
- `jsdom` does not implement every browser API. Gaps that the platform's dependencies reach, such as `elementFromPoint` and `scrollTo`, are stubbed once in `apps/platform/vitest.setup.ts`.
- Visual layout and real browser behavior are not covered. They stay with the end-to-end tests from decision [0016](0016-playwright-for-e2e-tests.md).
- `apps/platform` gains four development dependencies: `jsdom`, `@testing-library/react`, `@testing-library/dom` and `@testing-library/user-event`.
