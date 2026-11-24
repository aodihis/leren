# AGENTS.md

Constraints for working in this repository. Details live in `docs/`. This file does not duplicate them.

## Docs are the source of truth

- Read the relevant file in `docs/rules/` before changing code in that area:
  - `docs/rules/architecture.md` for anything that crosses apps, packages or tooling
  - `docs/rules/backend.md` for `apps/api` and `apps/worker`
  - `docs/rules/frontend.md` for `apps/platform`
  - `docs/rules/packages.md` for `packages/*`
  - `docs/rules/general.md` for tooling, lint rules and commits
- Check `docs/decision/` before proposing a structural change. Do not contradict an `Accepted` decision.
- Check `docs/product/` before changing product behaviour.
- `docs/overview/` holds user-facing documentation, including the high-level design in `overview/README.md`.
- If the docs and the code disagree, say so. Do not silently pick one.

## Changing the docs

- Do not edit rules to make your change pass. Change a rule only when the user asks for it.
- A new engineering decision is a new file in `docs/decision/`, named `NNNN-meaningful-name.md`, using the template in `docs/README.md`. Use the next unused number.
- A new product decision goes in `docs/product/` in the same format.
- Never rewrite or delete an accepted decision. To change one, add a new decision and mark the old one `Superseded` with a `Superseded by` link.
- Every decision lists what it affects in the `Affects` field.
- Update the relevant `docs/rules/` file when a decision changes how the codebase must be written.

## Code

- Follow the lint rules in `tooling/oxlint/`. Do not disable a rule to get around it.
- Follow the comment and documentation rules below.
- Do not edit generated files, such as `apps/platform/src/routeTree.gen.ts`.
- Do not add a dependency without a reason the user can see. Prefer what the workspace already uses.
- Do not import across apps. Share code through `packages/*`. The only exception is the type-only `@leren/api/client` entry point (decision 0017).

## Comments and documentation

- Functions, classes and files get a concise JSDoc block when they need one. The `no-inline-comments` lint rule rejects other comments, so put invariants in the JSDoc of the code they concern.
- A comment is at most 50 characters (`rules/max-comment-length`). It gives general information about what the code is. It never explains a bug, a scenario or a fix inside the code.
- Do not write duplicate comments or comments about things that are obvious from reading the code.
- Write the comment as one complete sentence or noun phrase. Do not drop words to fit the limit. Omit detail instead.
- Use established, standard terminology. Do not coin new terms or shorthand.
- Write comments and docs as statements of current truth. Never narrate corrections, prior framings or what changed.
- Keep comments general. Explain what the code is, the idea behind it and how it is used. Do not describe a specific bug, scenario, input or request that motivated it. That detail belongs in the commit message or in a test.

### User-facing documentation

- Keep it concise and limited to what a reader needs to use the product. Explain key concepts. Do not enumerate implementation details or edge cases.
- When adding or changing a configuration option, command line flag or error kind, make the minimal update that keeps the docs complete and current.
- Every error kind has a small, self-contained code example.
- When fixing a bug, do not make the documentation longer. Only correct inaccuracies in the existing text.
- User-facing docs live in `docs/overview/`.

## Before finishing

- Run `pnpm lint` and `pnpm format:check`. Both must pass.
- Run `pnpm test:lint-rules` when touching `tooling/oxlint/`.
- Typecheck the app or package you changed.
- Report anything you skipped or could not verify.

## Git

- Commit only when asked. Never push without being asked.
- Use the commit format in `docs/rules/general.md`.
