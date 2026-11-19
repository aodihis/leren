---
name: review-fix
description: Review changed code from several perspectives (security, correctness, performance, maintainability, reliability and resilience), then fix the confirmed findings and verify the result. Use when the user asks to review, audit, or check recent changes, a branch, a PR, or "what I just wrote", or asks to review and fix.
---

# Review and fix

Review the changed code through independent lenses, simplify what can be simplified, fix confirmed findings with the narrowest possible diff, and verify. Findings come before fixes. Never fix what was not confirmed.

## Protocol

1. **Scope the diff.** Default to uncommitted changes (`git diff HEAD`). If the tree is clean, use the branch against `main` (`git diff main...HEAD`). If the user names a PR, path or commit range, use that. Review only changed lines and the code they directly touch. Do not review the whole repository.
2. **Load the rules.** Read `AGENTS.md` and the `docs/rules/` file for each area the diff touches. Check `docs/decision/` before flagging a structural choice. A violation of an accepted rule or decision is a finding. If the docs and the code disagree, report it and do not pick a side.
3. **Read enough context.** For each changed function, read its callers, callees and tests when the change could affect them. Do not report a problem without having read the code that proves it.
4. **Review by lens.** Apply each lens in [references/lenses.md](references/lenses.md) as a separate pass: security, correctness, performance, maintainability, reliability and resilience. A lens with nothing to report is stated as clean, not padded.
5. **Simplify.** Run the simplification pass in [references/lenses.md](references/lenses.md): reuse, dead code, needless abstraction, redundant state, and efficiency. Simplifications are behavior-preserving. Report them separately from defects.
6. **Verify each finding.** Before reporting, re-read the cited lines and confirm that a concrete input or state produces the wrong outcome. Drop findings you cannot demonstrate. Mark a finding `Plausible` when it depends on something you could not check.
7. **Report.** Use the format below. Stop after the report when the user asked only for a review.
8. **Fix.** Fix every `Confirmed` finding unless the user limited the scope. Do not fix `Plausible` findings without asking. Keep each fix minimal, in the style of the surrounding code, and independent of the others.
9. **Verify the fixes.** Run the checks from [Verification](#verification). If a fix breaks a check, repair it or revert it. Do not leave a failing tree.
10. **Final report.** State what was fixed, what was skipped and why, and what could not be verified.

## Scope discipline

- Fix only what a finding names. Do not refactor neighbouring code.
- Do not add a dependency, edit generated files, or change lint rules and docs rules to make a fix pass.
- A fix that changes behavior beyond the finding, a public interface, or a database schema needs the user's approval first.
- Do not commit or push unless asked.

## Report format

Findings first, most severe first. Omit empty sections.

```
## Findings

### [Severity] Lens: short title
`path/to/file.ts:42` — Confirmed | Plausible
What is wrong, in one or two sentences.
Failure: the concrete input or state that produces the wrong outcome.
Fix: the change to make.

## Simplifications
- `path:line` — what to simplify and why it is safe.

## Clean lenses
Security, performance, ...

## Not verified
Anything that could not be checked, such as code paths not covered by tests.
```

Severity is one of:

- **Critical:** exploitable vulnerability, data loss or corruption, or a crash on a main path.
- **High:** wrong results on a realistic input, or a violated accepted rule or decision.
- **Medium:** a defect on an uncommon path, or a measurable performance or resilience problem.
- **Low:** minor maintainability or style issues that the lint rules do not already catch.

Do not report anything that `pnpm lint` or `pnpm format:check` already catches.

## Verification

Run the checks that match the files changed, and report the result of each:

- `pnpm lint` and `pnpm format:check`. Both must pass.
- `pnpm test:lint-rules` when `tooling/oxlint/` changed.
- The typecheck and tests of each app or package changed.

State plainly any check that was skipped or could not run.
