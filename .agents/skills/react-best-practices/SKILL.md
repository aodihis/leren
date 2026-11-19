---
name: react-best-practices
description: MUST be used for React tasks in this repository. Covers function components with hooks, TypeScript, state and effects, TanStack Router routes, forms with react-hook-form and zod, shadcn/ui from @leren/ui, and Tailwind styling. Load for any .tsx file, route, component, hook, or form work in apps/platform or packages/ui.
---

# React Best Practices Workflow

Use this skill as an instruction set. Follow the workflow in order unless the user explicitly asks for a different order. The repository rules in `AGENTS.md` and `docs/rules/frontend.md` take precedence over anything here.

## Core Principles

- **Keep state minimal:** store the least state that describes the UI, and derive everything else during render.
- **Make data flow explicit:** props flow down, callbacks flow up. Lift state only as far as the nearest common owner.
- **Decompose by responsibility:** a component or hook has one reason to change and a small, typed contract.
- **Effects synchronize with external systems:** they are not for deriving state or responding to events.
- **Readability counts:** write clear, self-documenting code and prefer the simplest construct that works.

## 1) Confirm the context before coding (required)

- Stack: React 19, function components, TypeScript, TanStack Router with file-based routes, Tailwind CSS 4, shadcn/ui through `@leren/ui`, react-hook-form with zod.
- Read `docs/rules/frontend.md`. Check `docs/decision/0002-frontend-module-driven-structure.md` before changing structure and `0004-shadcn-in-ui-package.md` before touching `packages/ui`.
- Do not use class components, and do not use legacy APIs that React 19 has replaced.

### 1.1 Must-read core references (required)

Before implementing any React task, read and apply these references. Keep them in working context for the whole task, not only when a specific issue appears.

- [references/state-and-effects.md](references/state-and-effects.md)
- [references/components.md](references/components.md)
- [references/hooks.md](references/hooks.md)

### 1.2 Read task-specific references (when relevant)

- Routes, loaders, navigation, search params: [references/routing.md](references/routing.md)
- Forms and validation: [references/forms.md](references/forms.md)
- Styling and `@leren/ui` components: [references/ui-and-styling.md](references/ui-and-styling.md)
- Slow renders or large lists: [references/performance.md](references/performance.md)

### 1.3 Plan component boundaries before coding (required)

For a non-trivial feature or structural refactor, sketch the responsibilities, the state owners, and the contracts between them. For a local fix, keep the existing boundaries unless they obstruct the change.

- Identify the distinct UI responsibilities, stateful workflows and data sources in the feature. Decide which component owns each piece of state.
- Judge cohesion by behavior that changes together or maintains a shared invariant. Sharing a page, reading the same data, or having a single consumer does not by itself justify one component.
- Route files compose features and coordinate page behavior. Apply the same review inside feature components: moving a whole feature into a child component or a `useFeature()` hook is not decomposition.
- Single-use code stays in the route file. Extract to `src/modules/:module-name/` only when it is reused, and to `packages/ui` only when it is generic and app-agnostic.

## 2) Apply the essentials (required)

- Derive values during render. Do not mirror props or other state into `useState`.
- Do not call `useEffect` to compute state, transform data, or handle a user event. Put event logic in the event handler.
- Give list items a stable `key` from the data, never the array index when the list can reorder or change.
- Type props explicitly. Do not use `any`, and do not chain type assertions (a lint rule rejects it).
- Keep components pure: no mutation of props, state or module-level variables during render. The repository also forbids module-level `let` and `var`.

## 3) Verify (required)

- Run `pnpm lint` and `pnpm format:check`. Both must pass.
- Typecheck `apps/platform` or `packages/ui`, whichever changed.
- Do not edit `apps/platform/src/routeTree.gen.ts`.
- When the change is visible in the UI, start the app and check it in a browser. If you cannot, say so.

## 4) Final checklist

- State is minimal and derived values are computed during render.
- Every effect synchronizes with an external system and cleans up after itself.
- Components and hooks have a single responsibility and a typed contract.
- Forms validate with a zod schema shared by types and runtime.
- Styling uses Tailwind utilities and `@leren/ui` components.
- Comments follow the JSDoc-only rule from `AGENTS.md`.
