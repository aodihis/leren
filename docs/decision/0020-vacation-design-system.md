# 0020. The platform follows the "I'm on Vacation" design system

- Status: Accepted
- Date: 2026-11-20
- Affects: apps/platform, packages/ui, docs/design-system, docs/rules/frontend.md

## Context

The platform needs one visual language before more screens are built. A design system was generated for the product and is stored in `docs/design-system/`. It defines tokens, a shell layout, and reference markup for each component. The platform uses shadcn/ui components from `@leren/ui` styled with Tailwind (decisions 0004 and rules in `docs/rules/frontend.md`), not the reference CSS classes in `components.css`.

## Decision

- `docs/design-system/` is the reference. Its `tokens.css` values are copied into `packages/ui/src/styles/globals.css` and mapped onto the shadcn variables (`--primary` is `--brand`, `--background` is `--bg-canvas`, and so on). The remaining tokens, such as `brand-soft`, `success-soft` and `sand`, are exposed as Tailwind colours.
- Components are built with Tailwind utilities on top of `@leren/ui`. The reference `components.css` is not imported into the app.
- Dark mode uses `data-theme="dark"` on `<html>`, as the design system specifies. The `dark:` variant follows that attribute.
- Inter and JetBrains Mono are loaded from Google Fonts in `apps/platform/index.html`.
- Only screens that exist are built. Navigation items, KPIs and components for features that do not exist yet (approvals, chat, knowledge, contacts) are added when those features are.

## Consequences

- If `tokens.css` changes, `globals.css` must be updated to match.
- The product name in the UI stays "Leren". The reference files use "I'm on Vacation", and the logo is still the design system's placeholder mark.
- `docs/design-system/` is excluded from oxfmt because it is imported reference material.
