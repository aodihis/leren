# Routing

The platform uses TanStack Router with file-based routes in `apps/platform/src/routes/`. The route tree is generated into `src/routeTree.gen.ts`, which must not be edited.

## Defining a route

- One file per route. The file path defines the URL.
- A route is created with `createFileRoute("/path")({ ... })`. The string must match the file path, and the generator keeps it in sync.
- Single-use components stay in the route file. Reused components go in `src/modules/:module-name/components/`.

```tsx
export const Route = createFileRoute("/courses/$courseId")({
  component: CoursePage,
});

function CoursePage() {
  const { courseId } = Route.useParams();
  return <h1>{courseId}</h1>;
}
```

## Data

- Load data in the route's `loader` when the page cannot render without it. Read it in the component with `Route.useLoaderData()`.
- Do not fetch the same data again in an effect.
- Validate untrusted input at the route boundary. Use `validateSearch` with a zod schema for search params.
- Set `pendingComponent` and `errorComponent` on routes whose loaders can be slow or fail, so users see a loading or error state instead of a blank page.

## Navigation

- Use `Link` for navigation and `useNavigate` for navigation after an action. Do not use `window.location` or a plain `a` for in-app routes.
- Pass `to`, `params` and `search` as typed objects. Do not build URL strings by hand.
- Keep shareable UI state, such as filters and pagination, in search params rather than component state.

## Code organization

- A layout is a route with an `<Outlet />`. Put shared chrome there, not in each page.
- Do not import a route file from another route file. Share through a module or `packages/ui`.
