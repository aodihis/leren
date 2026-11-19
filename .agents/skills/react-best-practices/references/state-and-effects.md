# State and effects

## Choose where state lives

- Prefer derived values over stored state. If a value can be computed from props or other state, compute it during render.
- Use `useState` for independent values and `useReducer` when several values change together or the next state depends on the transition.
- Keep state in the lowest component that needs it. Lift it only to the nearest common parent of the components that share it.
- Keep server data out of component state. Fetch it through the route loader or a data hook, and treat it as a read-only snapshot.
- Reflect shareable UI state, such as filters, tabs and pagination, in the URL search params so it survives reloads and links.

```tsx
function Roster({ students }: { students: Student[] }) {
  const [query, setQuery] = useState("");
  const visible = students.filter((student) => student.name.includes(query));

  return <List items={visible} onSearch={setQuery} />;
}
```

`visible` is derived on every render. It is not stored in a second `useState`.

## Update state correctly

- Use the functional form when the next value depends on the previous one: `setCount((count) => count + 1)`.
- Never mutate state. Create a new object or array.
- Reset a component's state by changing its `key`, not by an effect that copies props into state.
- Store the minimum. Store an `id` and look the object up instead of storing a copy of the object.

## Effects

An effect synchronizes a component with a system outside React: a subscription, a timer, a browser API, a non-React widget, or a network request that no router loader covers.

Do not use an effect to:

- derive state from props or state,
- respond to a user event,
- reset state when a prop changes,
- notify a parent after a state change.

Handle each of those during render, in the event handler, with a `key`, or by calling the parent callback in the same handler.

When an effect is needed:

- List every reactive value it reads in the dependency array. Do not suppress the lint rule.
- Return a cleanup function that undoes the setup. Effects run twice in development, so setup and cleanup must be symmetrical and idempotent.
- Guard asynchronous work so that a stale response cannot overwrite a newer one, for example with an `AbortController`.
- Keep one concern per effect.

```tsx
useEffect(() => {
  const controller = new AbortController();
  void load(id, controller.signal).then(setData);
  return () => controller.abort();
}, [id]);
```

## Context

- Use context for values that many distant components read and that change rarely, such as the current user or theme.
- Split a context by update frequency. Do not put fast-changing state in the same context as stable configuration.
- Memoize the value passed to a provider when it is an object or array.
