# UI and styling

## Components come from `@leren/ui`

- Import shared components from `@leren/ui`, not from a path inside the package. Decision [0004](../../../../docs/decision/0004-shadcn-in-ui-package.md) places all shadcn/ui components there.
- Do not add UI primitives to `apps/platform`. Generic, app-agnostic components belong in `packages/ui`.
- Before writing a new component, check `packages/ui/src/components/ui/` for one that already does the job.
- To add a shadcn/ui component, run `shadcn add` from `packages/ui`. Then rewrite any `@/` imports in the new files to relative paths and export the component from `src/index.tsx`, as decision 0004 requires.
- The generated files under `packages/ui/src/components/ui/`, `src/hooks/`, `src/lib/utils.ts` and `src/styles/` are excluded from the linter and formatter. Edit them only when the change is intended.

## Tailwind

- Style with Tailwind utility classes. Write custom CSS only when Tailwind cannot express the style.
- Use theme tokens such as `bg-background`, `text-muted-foreground` and `border-border`, not raw color values, so light and dark themes work.
- Compose conditional classes with the `cn` helper from `@leren/ui`. Do not build class names by string concatenation or template literals with dynamic fragments, because Tailwind cannot detect them.
- Use `class-variance-authority` for components with variants, following the existing generated components.
- Design for narrow screens first, and add `sm:`, `md:` and `lg:` modifiers for larger ones.

```tsx
<div className={cn("rounded-md border p-4", isActive && "bg-accent")} />
```

## Icons

- Use `lucide-react`. Import icons by name. Give a decorative icon `aria-hidden`, and give an icon-only button an accessible label.

## Dark mode and theming

- Do not hard-code colors. Theme tokens live in `packages/ui/src/styles/globals.css`.
