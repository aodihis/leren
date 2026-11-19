# Forms

The platform uses react-hook-form with zod. Both are dependencies of `@leren/ui`, which exports the shadcn/ui form building blocks.

## Schema first

- Define a zod schema once. Derive the form type from it with `z.infer`, so types and runtime validation cannot drift.
- Use the same schema on the server when the API accepts the same input.
- Put reused schemas in the module that owns the feature, in `types.ts` or a schema file next to it.

```tsx
const profileSchema = z.object({
  name: z.string().min(1, "Enter a name"),
  email: z.email("Enter a valid email"),
});

type ProfileValues = z.infer<typeof profileSchema>;
```

## Wiring

- Use `useForm<ProfileValues>` with the zod resolver and explicit `defaultValues` for every field, so inputs are always controlled or always uncontrolled.
- Use the form components from `@leren/ui` so labels, descriptions and error messages are associated with their inputs.
- Show a field's error next to the field. Show submit-level errors, such as a server failure, in an `Alert`.
- Disable the submit button while `formState.isSubmitting` is true, and make the submit handler safe to run twice.

## Submitting

- Handle submission in the `handleSubmit` callback, not in an effect.
- Map server validation errors back to fields with `setError`.
- Reset the form with `reset` after a successful submit when the form stays on screen.
- Never trust client validation alone. The API validates again.

## Accessibility

- Every input has a visible label.
- Errors are announced. The shadcn/ui form components set `aria-invalid` and `aria-describedby` for you, so do not bypass them.
