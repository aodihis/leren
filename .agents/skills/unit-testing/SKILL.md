---
name: unit-testing
description: Use when writing or changing unit tests in apps/api, apps/worker, apps/platform or packages. Covers testing a flow by mocking collaborators and asserting which functions were called and with what, test doubles (stubs, spies, mocks, fakes), and the 80% coverage target. packages/agents is excluded because agents are evaluated with evals. Use together with the test-audit skill.
---

# Unit Testing

A unit test runs one unit of behavior with its collaborators replaced by test doubles. It proves two things: the unit returns or produces the right result, and it drives its collaborators correctly. Follow [test-audit](../test-audit/SKILL.md) before adding any test.

## Check the tooling first

The repository uses Vitest with the V8 coverage provider, configured in `vitest.config.ts` at the root. See decision [0009](../../../docs/decision/0009-vitest-for-unit-tests.md).

- `pnpm test` runs all tests, `pnpm test:watch` reruns them on save, and `pnpm test:coverage` enforces the thresholds.
- Run a single file with `pnpm vitest run path/to/name.test.ts`.
- Tests run in the `node` environment. Component tests need a DOM environment and a testing library, which are not installed. Ask the user before adding them.

## Testing a flow with mocks

This style is called **interaction testing**, or **behavior verification**. The test asserts that the unit called its collaborators correctly, using test doubles:

- **Stub:** returns canned data so the unit can run. It is not asserted on.
- **Spy:** wraps a real or fake function and records calls. Assert on the calls afterward.
- **Mock:** a spy with preprogrammed expectations about how it is called.
- **Fake:** a working lightweight implementation, such as an in-memory repository.

With Vitest these are `vi.fn()`, `vi.spyOn()` and `vi.mock()`.

### When to use it

Use interaction tests where the unit's job is to coordinate: a service calling a repository and a queue, a router handler calling a service, a job calling the database and a vector store. The collaborator call is the observable outcome.

For pure functions, assert the returned value. Do not mock anything.

### How to write one

1. **Arrange.** Inject collaborators as arguments. Services take plain arguments, per `docs/rules/backend.md`, so pass doubles instead of patching module internals. Reach for `vi.mock` of a module only when the dependency cannot be injected.
2. **Act.** Call the unit once through its public interface.
3. **Assert the result.** Check the return value or the thrown error first.
4. **Assert the interactions that matter.** Check that each collaborator was called, the arguments it received, how many times, and the order when order is part of the contract.
5. **Assert what must not happen.** On a failure path, check that the follow-up calls were not made, for example that no job was enqueued after the write failed.

```ts
it("enqueues one run-agent job after saving the email", async () => {
  const saveEmail = vi.fn().mockResolvedValue({ id: "email-1" });
  const enqueue = vi.fn().mockResolvedValue(undefined);

  const result = await receiveEmail({ saveEmail, enqueue }, { subject: "Hello" });

  expect(result).toEqual({ id: "email-1" });
  expect(saveEmail).toHaveBeenCalledExactlyOnceWith({ subject: "Hello" });
  expect(enqueue).toHaveBeenCalledExactlyOnceWith("run-agent", { emailId: "email-1" });
});

it("does not enqueue when saving fails", async () => {
  const saveEmail = vi.fn().mockRejectedValue(new Error("db down"));
  const enqueue = vi.fn();

  await expect(receiveEmail({ saveEmail, enqueue }, { subject: "Hello" })).rejects.toThrow(
    "db down",
  );
  expect(enqueue).not.toHaveBeenCalled();
});
```

### Keep interaction tests honest

- Assert calls that are part of the contract, such as a write, a publish or an external request. Do not assert incidental calls such as logging or internal helpers.
- Do not mock the unit under test, and do not mock what you are asserting on.
- A mock must not reimplement the behavior being tested. If setting up the double takes more logic than the unit has, use a fake or move the test up a boundary.
- Mock at the boundary you own: the repository, the queue client, the HTTP client. Do not mock the language, the standard library or a pure helper.
- Reset doubles between tests. Do not let call counts leak across tests.
- Prefer one behavior per test and a name that states it.
- Use `toHaveBeenCalledExactlyOnceWith` or an explicit call count when "exactly once" matters. `toHaveBeenCalled` alone is too weak.

## Where tests live

- Place a test next to the code as `name.test.ts` or `name.test.tsx`, unless the package already follows another layout.
- In `apps/api`, test `service.ts` with injected doubles. Test `router.ts` through Hono's `app.request()` with the service replaced, to check validation and status codes.
- In `apps/worker`, test each job's handler with fake context, including its `signal`, and check that it is safe to retry.
- In `apps/platform`, test components through their rendered output and user events. Do not assert component internals.

## Coverage target

- The target is **80%** for lines, branches, functions and statements, per package.
- **`packages/agents` is excluded.** Agent behavior is checked by evals, not unit tests. Unit-test the deterministic code around an agent only when it lives outside `packages/agents`.
- Also exclude generated and vendored code: `apps/platform/src/routeTree.gen.ts`, `packages/ui/src/components/ui/`, `packages/ui/src/hooks/`, `packages/ui/src/lib/utils.ts`, `packages/ui/src/styles/`, `tooling/oxlint/vendor/`, and `**/dist/**`.
- Enforce the target with the runner's coverage thresholds so a drop fails the run. Do not lower a threshold to make a change pass. Raise the issue with the user.
- Raise coverage with tests that pass the [authoring gate](../test-audit/SKILL.md#authoring-gate). Do not write assertion-free tests to reach the number.

### Running coverage

Run `pnpm test:coverage`. Read the report for uncovered lines and branches, and write tests for behavior that is uncovered. Report the final percentages.

## Before finishing

- Run the package's tests and the coverage check, and report the numbers.
- Run `pnpm lint` and `pnpm format:check`. Both must pass.
- Typecheck the package you changed.
- Report anything you skipped or could not run.
