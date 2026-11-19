# Components

## Shape

- Write function components. Export one primary component per file and name the file after it.
- Type props with an `interface` or `type` declared next to the component. Do not use `React.FC`.
- Pass `children` and slots as props instead of adding boolean flags that switch layout.
- Spread remaining props onto the root element only when the component is a thin wrapper, and type them with `React.ComponentProps<"element">`.
- Under React 19, `ref` is an ordinary prop. Do not use `forwardRef` in new code.

```tsx
interface StatusBadgeProps {
  status: "open" | "closed";
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <Badge variant={status === "open" ? "default" : "secondary"}>{status}</Badge>;
}
```

## Data flow

- Props flow down and callbacks flow up. Name callbacks `onEvent` and handlers `handleEvent`.
- Pass the smallest data a child needs. Pass an `id` or a primitive rather than a whole object when that is enough.
- Do not read a parent's state through context only to avoid passing two props.
- Avoid prop drilling through more than two levels. Compose with `children`, or use context for genuinely app-wide values.

## Decomposition

- A component has one responsibility. Split when parts change for different reasons, own different state, or can be tested independently.
- Do not split to reduce line count alone. A long component with one responsibility is acceptable.
- Define components at module level. Never define a component inside another component, because it remounts on every render and loses its state.
- Keep the render body free of side effects.

## Conditional rendering

- Return early for loading, error and empty states.
- Do not nest ternaries. The repository lint rules reject them. Use early returns or small components.
- Render a number safely: `count > 0 && <X />`, never `count && <X />`, which prints `0`.

## Lists

- Give each item a stable, unique `key` taken from the data.
- Extract the item into a component when it holds state or has more than a few lines of markup.
- Do not filter then map in adjacent passes. The repository lint rules reject it. Use a single pass, such as `flatMap` or a loop.

## Accessibility

- Use semantic elements first: `button` for actions, `a` for navigation, `label` for inputs.
- Every interactive element is reachable by keyboard and has an accessible name.
- Prefer the shadcn/ui and Radix primitives from `@leren/ui`, which handle focus management and ARIA.
