---
name: tailwindcss-development
description: "Invoke when the user's message includes 'tailwind' in any form. Also invoke for writing or fixing Tailwind utility classes in React (TSX) components in apps/platform or packages/ui: responsive grid and flex layouts, dashboards with sidebars, cards, tables, forms, badges, dark mode variants, and spacing and typography fixes. Skip for backend code in apps/api or apps/worker, JavaScript with no markup, and build tool configuration."
license: MIT
metadata:
  author: laravel
  adapted-for: React, Tailwind CSS 4, shadcn/ui through @leren/ui
---

# Tailwind CSS Development

The repository rules in `AGENTS.md` and `docs/rules/frontend.md` take precedence over anything here. Load `react-best-practices` as well when the change touches a `.tsx` file.

## Project Setup

- Tailwind CSS 4 is used through `@tailwindcss/vite`. There is no `tailwind.config.js`.
- `apps/platform/src/index.css` imports Tailwind and `@leren/ui/styles.css`.
- Design tokens, the `dark` custom variant and the theme live in `packages/ui/src/styles/globals.css`. Add or change tokens there with `@theme`, not in the app.
- Use `cn()` from `@leren/ui` (`clsx` plus `tailwind-merge`) to combine and conditionally apply classes. Never build class names by string concatenation.
- Prefer components from `@leren/ui` over hand-styled elements. Style them with `className`, which `cn()` merges.
- Use semantic tokens such as `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border` and `bg-primary` instead of raw palette colors. Semantic tokens already adapt to dark mode.
- Avoid custom CSS unless Tailwind cannot express it.

## Basic Usage

- Check and follow the existing Tailwind conventions in the neighboring components before introducing new patterns.
- Extract repeated class groups into a component, or into a `cva` variant when the component already uses one. Do not extract into `@apply`.
- Consider class order, priority and defaults. Remove redundant classes, and place shared classes on a parent when that reduces repetition.
- Tailwind scans source files statically. Write complete class names in the source, such as `{ sm: "p-2", lg: "p-4" }[size]`, and never assemble them like `` `p-${size}` ``.

## Tailwind CSS v4 Specifics

- Always use Tailwind CSS v4 and avoid deprecated utilities.
- `corePlugins` is not supported in Tailwind v4.
- Configuration is CSS-first with the `@theme` directive:

```css
@theme {
  --color-brand: oklch(0.72 0.11 178);
}
```

- Import Tailwind with a regular CSS `@import` instead of the v3 `@tailwind` directives:

```diff
- @tailwind base;
- @tailwind components;
- @tailwind utilities;
+ @import "tailwindcss";
```

### Replaced Utilities

For opacity, drop the `*-opacity-*` class and append the value as a modifier on the color: `bg-blue-500 bg-opacity-50` becomes `bg-blue-500/50`.

| Deprecated            | Replacement           |
| --------------------- | --------------------- |
| bg-opacity-*          | bg-{color}/*          |
| text-opacity-*        | text-{color}/*        |
| border-opacity-*      | border-{color}/*      |
| divide-opacity-*      | divide-{color}/*      |
| ring-opacity-*        | ring-{color}/*        |
| placeholder-opacity-* | placeholder-{color}/* |
| flex-shrink-*         | shrink-*              |
| flex-grow-*           | grow-*                |
| overflow-ellipsis     | text-ellipsis         |
| decoration-slice      | box-decoration-slice  |
| decoration-clone      | box-decoration-clone  |

## Spacing

Use `gap` utilities instead of margins for spacing between siblings:

```tsx
<div className="flex gap-8">
  <Item />
  <Item />
</div>
```

## Responsive Layout

Styles are mobile-first. Write the base classes for the smallest screen and add `sm:`, `md:` and `lg:` overrides for larger ones:

```tsx
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{cards}</div>
```

## Dark Mode

The `dark:` variant applies inside any element with the `dark` class, as declared by `@custom-variant dark (&:is(.dark *))` in `packages/ui/src/styles/globals.css`. Semantic tokens need no `dark:` variant. Add `dark:` variants only when using raw palette colors:

```tsx
<div className="bg-white text-gray-900 dark:bg-gray-900 dark:text-white">
  Content adapts to color scheme
</div>
```

## Common Pitfalls

- Using deprecated v3 utilities such as `bg-opacity-*` or `flex-shrink-*`.
- Using `@tailwind` directives instead of `@import "tailwindcss"`.
- Creating a `tailwind.config.js` instead of using `@theme`.
- Using margins for spacing between siblings instead of `gap`.
- Concatenating class names dynamically, which hides them from the Tailwind scanner.
- Joining classes with template strings instead of `cn()`, which leaves conflicting utilities unresolved.
- Hard-coding palette colors where a semantic token exists.
- Forgetting `dark:` variants on raw palette colors.
