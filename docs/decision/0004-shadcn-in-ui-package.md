# 0004. shadcn/ui components live in `@leren/ui`

- Status: Accepted
- Date: 2026-11-19
- Affects: packages/ui, apps/platform, .oxlintrc.json, .oxfmtrc.json, docs/rules/packages.md

## Context

The platform needs a component library. shadcn/ui copies component source into the repository instead of shipping a package, so the generated files must live somewhere and must not be reformatted or linted, or every update would produce noisy diffs.

## Decision

All shadcn/ui components and hooks are added to `packages/ui` through `packages/ui/components.json`. Components are exported from `src/index.ts`, and apps import them from `@leren/ui`. The theme tokens live in `src/styles/globals.css`, which `apps/platform/src/index.css` imports as `@leren/ui/styles.css`.

The generated files under `packages/ui/src/components/ui/`, `src/hooks/`, `src/lib/utils.ts` and `src/styles/` are excluded from oxlint and oxfmt.

Generated components use relative imports instead of the `@/` alias, because the platform compiles the package source and cannot resolve an alias defined in another package's `tsconfig.json`.

## Consequences

- After `shadcn add`, rewrite any `@/` imports in new files to relative paths and add the new component to `src/index.tsx`.
- Components are changed by editing the generated files directly. Those edits are not checked by the linter or formatter.
