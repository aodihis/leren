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

## Calling the API

- Call the API with the typed client in `src/modules/api/api-client.ts`. Do not write `fetch` calls or redefine request and response types the API already declares. Derive types with `InferRequestType` and `InferResponseType` from `hono/client`.
- Do not define zod schemas for data the API validates. Show the API's `fieldErrors` next to the fields with `setError`. See [0017](../decision/0017-hono-rpc-for-api-types.md).

## Styling

- Use Tailwind utility classes. Avoid custom CSS unless Tailwind cannot express it.

## Design system

Follow the design system in [`docs/design-system/`](../design-system/README.md) ([0029](../decision/0029-vacation-design-system.md)). Before building UI, read its `README.md`, `layout.md` and the `README.md` and `preview.html` of the component you are building.

- Use the design tokens through their Tailwind colours (`bg-brand`, `text-ink-muted`, `bg-success-soft`). Do not hard-code hex values or font stacks.
- The brand colour is for actions and the active state. Status colours only mean status: success is Sent, warning is Awaiting approval, danger is Escalated, info is Question or Delegated.
- Sidebar 264px, content at most 1120px, chat column 760px. Follow the breakpoints in `layout.md`.
- Copy is in sentence case. Buttons are verbs, such as "Approve and send".
- If something is not covered, use the closest existing pattern and say which one you followed.

## Testing

- Test a route by rendering it with `renderApp` from `src/testing.tsx` and replacing `auth-client` and `api-client` with test doubles. Query by role, label and text, and use `user-event`. See [0018](../decision/0018-testing-library-for-platform-components.md).
