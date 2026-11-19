---
name: test-audit
description: Invoke whenever writing, changing, reviewing, or sweeping tests. Authoring gate for new tests, plus an audit workflow for low-value, implementation-coupled or duplicate tests and the test-only production seams they demand. Use together with the unit-testing skill.
---

# Test Audit

Two modes share one value bar. Authoring mode gates every new or changed test at write time. Audit mode sweeps existing tests that re-assert the source, duplicate stronger proof, couple to implementation, or keep test-only production seams alive. Optimize for confidence, not for the number of tests deleted.

Coverage is a floor, not evidence of quality. A test that matches a junk pattern does not count toward the coverage target.

## Authoring gate

Before adding a test, answer four questions. A missing answer means the test is not ready.

1. What observable behavior, invariant or contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch that failure? Each contract has one primary test at the strongest boundary. Another layer needs its own distinct risk. Prefer extending a table-driven case or a shared fixture over a near-duplicate test.
4. Does it need a production seam, such as an export, flag, wrapper or injection hook, that no production caller needs? If yes, move the test to the real boundary instead.

Then check the test against every [junk pattern](#junk-patterns). A match fails the gate unless the [retention bar](#retention-bar) names the contract it independently guards.

A test that breaks under a behavior-preserving refactor asserts implementation, not behavior. Rewrite it at the owning boundary.

A bug regression test must fail on the pre-fix code for the intended reason and pass after the fix. A regression test that never failed proves the mock, not the fix. One regression test at the owning boundary covers the bug. Do not replay the scenario at every layer.

## Junk patterns

The authoring gate rejects a new test that matches one of these. Audits hunt for existing tests that match.

- Assertion-free tests that only execute code to raise coverage.
- Self-comparisons, and tests that copy the value they assert.
- Copied fixtures, inventories, manifests or export lists.
- Greps of the source, imports or strings.
- Tests of private helpers or call shapes that a real boundary test already covers.
- Duplicate invocations of the same contract.
- Local replays of a shared helper's tests.
- Tests whose only purpose is to preserve a test-only export, global or wrapper.
- Production code whose only callers are tests.
- Expected values produced by the code under test.
- Mocks that implement the behavior being asserted, and one identical mock standing in for different APIs.
- Fixtures that supply the ordering or result the code under test should produce.
- Persistence asserted against a store that the path never writes.
- Tests that restate declared flags or configuration instead of exercising them.
- Snapshot tests of large output that no reviewer reads.

## Retention bar

Keep a test that matches a junk pattern only when you can name, in one sentence, the contract it guards that no other test reaches. Examples: a public protocol, a security boundary, a data-loss path, a documented error kind. Put that sentence in the test's JSDoc.

## Audit mode

1. **Scope.** Pick one coherent area, such as one module or package. Do not sweep the whole repository in one pass.
2. **Discover, read-only.** List the area's tests. Group them by the contract each one protects. Mark each test `keep`, `rewrite`, `merge` or `delete`, with the junk pattern or the overlapping test as evidence.
3. **Report before editing.** Show the table and the reasons. Wait for approval when the change deletes more than a few tests or removes a production seam.
4. **Edit.** Apply the approved changes. When a test is deleted for needing a seam, remove the seam too and confirm that nothing else uses it.
5. **Verify.** Run the tests and the coverage check from the `unit-testing` skill. Coverage may fall because junk tests were removed. Report the change and do not restore a deleted test to hold the number. Add a real test at the owning boundary instead.
6. **Report.** List what was kept, rewritten, merged and deleted, the coverage before and after, and anything not verified.

## Report format

```
## Test audit: <area>

| Test | Verdict | Reason |
| ---- | ------- | ------ |

Coverage: before -> after
Seams removed: ...
Not verified: ...
```
