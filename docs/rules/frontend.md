# Frontend rules

Applies to `apps/platform`. Background: [0002](../decision/0002-frontend-module-driven-structure.md).

## Structure

```
src/
  routes/               pages and routes (TanStack Router, file-based)
  modules/:module-name/
    components/         reusable components only
    hooks/              reusable hooks only
    types.ts
```

- Write pages and routes in `src/routes/`.
- Put code in a module only when it is reused. Single-use code stays in the route file.
- Generic, app-agnostic UI goes in `packages/ui`.
- Do not edit `src/routeTree.gen.ts`. It is generated and git-ignored.

## Styling

- Use Tailwind utility classes. Avoid custom CSS unless Tailwind cannot express it.
