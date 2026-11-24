import {
  Alert,
  AlertDescription,
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@leren/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { InferRequestType } from "hono/client";
import { useForm } from "react-hook-form";

import { api } from "../../modules/api/api-client";
import { StickyPageHeader } from "../../modules/layout/components/sticky-page-header";

type ProfileValues = InferRequestType<typeof api.api.me.$patch>["json"];

export const Route = createFileRoute("/_authed/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  const form = useForm<ProfileValues>({
    defaultValues: {
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      replyInstruction: user.replyInstruction ?? "",
    },
  });

  async function handleSubmit(values: ProfileValues) {
    const response = await api.api.me.$patch({ json: values });

    if (response.status === 400) {
      const { fieldErrors } = await response.json();

      form.setError("firstName", { message: fieldErrors.firstName?.[0] });
      form.setError("lastName", { message: fieldErrors.lastName?.[0] });
      form.setError("replyInstruction", { message: fieldErrors.replyInstruction?.[0] });

      return;
    }

    if (!response.ok) {
      form.setError("root", { message: "Could not save your profile" });

      return;
    }

    await navigate({ to: "/" });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <StickyPageHeader className="py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-title-lg font-semibold">
                {user.name || "Your profile"}
              </h1>
              <p className="truncate text-body-sm text-ink-muted">{user.email}</p>
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Save
            </Button>
          </div>
        </StickyPageHeader>
        {form.formState.errors.root && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        )}
        <div className="max-w-xl space-y-5 pb-12 pt-6">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First name</FormLabel>
                <FormControl>
                  <Input autoComplete="given-name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last name</FormLabel>
                <FormControl>
                  <Input autoComplete="family-name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="replyInstruction"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default instruction</FormLabel>
                <FormControl>
                  <Textarea
                    className="min-h-28"
                    placeholder="Write in a friendly and short tone. Sign as Erin."
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  How replies are written, such as the tone and what must not be said. A playbook
                  can replace it with its own instruction.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </form>
    </Form>
  );
}
