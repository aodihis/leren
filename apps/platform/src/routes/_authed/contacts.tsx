import {
  Alert,
  AlertDescription,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@leren/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { api } from "../../modules/api/api-client";
import type { Contact } from "../../modules/knowledge-items/types";

interface ContactFormValues {
  name: string;
  email: string;
  role: string;
}

const EMPTY_VALUES: ContactFormValues = { name: "", email: "", role: "" };

export const Route = createFileRoute("/_authed/contacts")({
  loader: async () => {
    const response = await api.api.contacts.$get();

    if (!response.ok) {
      throw new Error("Could not load your contacts.");
    }

    const { contacts } = await response.json();

    return contacts;
  },
  component: ContactsPage,
});

function ContactsPage() {
  const contacts = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<ContactFormValues>({ defaultValues: EMPTY_VALUES });

  function startEditing(contact: Contact | null) {
    setEditing(contact);
    form.reset(
      contact ? { name: contact.name, email: contact.email, role: contact.role } : EMPTY_VALUES,
    );
  }

  async function handleSubmit(json: ContactFormValues) {
    const response = editing
      ? await api.api.contacts[":id"].$put({ param: { id: editing.id }, json })
      : await api.api.contacts.$post({ json });

    if (response.status === 400) {
      const { fieldErrors } = await response.json();

      for (const field of ["name", "email", "role"] as const) {
        const message = fieldErrors[field]?.[0];

        if (message) {
          form.setError(field, { message });
        }
      }

      return;
    }

    if (!response.ok) {
      form.setError("root", { message: "Could not save the contact" });

      return;
    }

    startEditing(null);
    await router.invalidate();
  }

  async function handleDelete(contact: Contact) {
    const response = await api.api.contacts[":id"].$delete({ param: { id: contact.id } });

    setFailure(response.ok ? null : "Could not delete the contact");

    if (response.ok) {
      if (editing?.id === contact.id) {
        startEditing(null);
      }

      await router.invalidate();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Contacts</h1>
      <p className="text-muted-foreground">
        People a reply may point to. Attach them to a knowledge item.
      </p>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          {form.formState.errors.root && (
            <Alert variant="destructive">
              <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="name"
              rules={{ required: "Enter a name" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              rules={{ required: "Enter an email address" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <FormControl>
                    <Input placeholder="Project lead" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {editing ? "Save contact" : "Add contact"}
            </Button>
            {editing && (
              <Button type="button" variant="outline" onClick={() => startEditing(null)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Form>
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {contacts.length === 0 ? (
        <p className="text-muted-foreground">You have no contacts yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell className="font-medium">{contact.name}</TableCell>
                <TableCell>{contact.email}</TableCell>
                <TableCell className="text-muted-foreground">{contact.role}</TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${contact.name}`}
                    onClick={() => startEditing(contact)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${contact.name}`}
                    onClick={() => handleDelete(contact)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
