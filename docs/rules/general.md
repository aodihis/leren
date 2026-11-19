# General rules

## Tooling

| Command                | Purpose                    |
| ---------------------- | -------------------------- |
| `pnpm lint`            | Run oxlint                 |
| `pnpm lint:fix`        | Run oxlint with autofix    |
| `pnpm format`          | Format with oxfmt          |
| `pnpm format:check`    | Check formatting           |
| `pnpm test:lint-rules` | Test the custom lint rules |

Lint and formatting must pass before committing.

## Lint rules

Custom rules live in `tooling/oxlint/` and are enabled in `tooling/oxlint/base.json`.

- **Comments:** only JSDoc blocks and tool directives are allowed. Use JSDoc for a function, class or file, and keep it concise. State invariants the code upholds or relies on. Do not comment what the code already makes obvious. Write complete sentences as statements of current truth, never narrating what changed.
- **Ternaries:** do not nest them.
- **State:** no module-level `let` or `var`. Hold state explicitly.
- **Spacing:** keep blank lines between logical groups. `pnpm lint:fix` fixes this.
- **Types:** no chained type assertions.
- **Arrays:** avoid adjacent `filter` and `map` passes.
- **Objects:** no conditional empty-object spreads such as `...(cond ? { a } : {})`.

## Commits

Use the format: a subject line, then `*` bullets for each change. Prefix the subject with `(FIX)` for bug fixes.
