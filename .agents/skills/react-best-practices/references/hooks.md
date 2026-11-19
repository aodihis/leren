# Hooks

## Rules

- Call hooks only at the top level of a component or another hook, never in conditions, loops or nested functions.
- Name custom hooks `useSomething`.
- Hooks are reused logic. Under `docs/rules/frontend.md`, a hook lives in `src/modules/:module-name/hooks/` only when it is reused. A hook used by one route stays in that route file.

## Writing a custom hook

- Give a hook one responsibility, a small argument list and a typed return value.
- Return a stable shape. Return an object for more than two values, and a tuple only for the `[value, setValue]` pattern.
- Do not wrap a single built-in hook in a custom hook that adds nothing.
- Moving a whole component body into `useFeature()` is not decomposition. Extract logic that has its own state and invariant.
- A hook that subscribes to an external system cleans up its subscription.
- Callbacks returned from a hook have stable identity when consumers put them in dependency arrays. Wrap them in `useCallback`.

```tsx
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
```

## Choosing a built-in hook

| Need                                   | Hook                                   |
| -------------------------------------- | -------------------------------------- |
| Local value                            | `useState`                             |
| Several related values or transitions  | `useReducer`                           |
| Value from an external store           | `useSyncExternalStore`                 |
| Synchronize with an external system    | `useEffect`                            |
| DOM node or mutable value, not render  | `useRef`                               |
| Expensive derived value                | `useMemo`, only after measuring        |
| Stable callback for a memoized child   | `useCallback`, only when it is needed  |
| Non-urgent update that may be deferred | `useTransition` and `useDeferredValue` |
| Unique id for accessibility attributes | `useId`                                |
| Read a promise or context in render    | `use`                                  |

## Refs

- Use a ref for a DOM node or a value that must not trigger a render.
- Do not read or write `ref.current` during render, except to initialize it once.
