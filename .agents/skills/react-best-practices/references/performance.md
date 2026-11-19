# Performance

Measure before optimizing. Use the React DevTools Profiler or the browser performance panel to find the component that is actually slow.

## Reduce the work first

- Move state down so fewer components re-render when it changes.
- Pass `children` through a stateful wrapper. Children created by the parent do not re-render when the wrapper's state changes.
- Derive values during render instead of syncing them through effects, which cause an extra render.

## Memoization

- Use `useMemo` only for a computation that is measurably expensive, and `useCallback` and `memo` only to protect a memoized child or a dependency array.
- Do not memoize by default. Memoization adds code and has a cost of its own.
- A memoized child needs stable props. Passing an inline object, array or function defeats `memo`.

## Large lists

- Render only what is visible. Use pagination, or a virtualization library when a list can exceed a few hundred rows.
- Keep list items cheap. Move per-item state into the item component.

## Urgent versus non-urgent updates

- Wrap a non-urgent state update, such as filtering a large list while typing, in `startTransition`, or defer the value with `useDeferredValue`, so input stays responsive.

## Loading code and assets

- Split code by route. TanStack Router can lazy-load a route component.
- Lazy-load heavy components, such as charts and editors, with `lazy` and `Suspense`.
- Import icons and utilities by name so the bundler can drop unused code.
- Give images explicit dimensions to avoid layout shift.
