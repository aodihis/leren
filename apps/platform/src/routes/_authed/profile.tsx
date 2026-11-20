import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@leren/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { InferRequestType } from "hono/client";
import { useForm } from "react-hook-form";

import { api } from "../../modules/api/api-client";

type ProfileValues = InferRequestType<typeof api.api.me.$patch>["json"];

export const Route = createFileRoute("/_authed/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  const form = useForm<ProfileValues>({
    defaultValues: { firstName: user.firstName ?? "", lastName: user.lastName ?? "" },
  });

  async function handleSubmit(values: ProfileValues) {
    const response = await api.api.me.$patch({ json: values });

    if (response.status === 400) {
      const { fieldErrors } = await response.json();

      form.setError("firstName", { message: fieldErrors.firstName?.[0] });
      form.setError("lastName", { message: fieldErrors.lastName?.[0] });

      return;
    }

    if (!response.ok) {
      form.setError("root", { message: "Could not save your profile" });

      return;
    }

    await navigate({ to: "/" });
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
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
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              Save
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
