import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@leren/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm, useWatch } from "react-hook-form";

import { api } from "../../api/api-client";
import type { Rule } from "../../auto-reply-rules/types";
import { getNewKnowledgeValues, toFormValues, toRequestBody } from "../form-values";
import type { Contact, KnowledgeFormValues, KnowledgeItem } from "../types";

/**
 * The API reports a failure under the name of the request field. Each of those names is also the
 * name of a form field, except the contacts, which are shown under their checkboxes.
 */
const ERROR_FIELDS = [
  "ruleId",
  "topic",
  "response",
  "restrictions",
  "validFrom",
  "validUntil",
  "contactIds",
] as const;

interface KnowledgeFormProps {
  item?: KnowledgeItem;
  rules: Rule[];
  contacts: Contact[];
}

/**
 * Creates a knowledge item, or replaces `item` when it is given, and returns to the list after a
 * successful save. The validity bounds are read in the timezone of the selected rule. The API
 * validates the request again and its field errors are shown next to the fields. A user without a
 * rule is asked to create one first, because every item belongs to a rule.
 */
export function KnowledgeForm({ item, rules, contacts }: KnowledgeFormProps) {
  const navigate = useNavigate();
  const itemRule = rules.find((rule) => rule.id === item?.ruleId);

  const form = useForm<KnowledgeFormValues>({
    defaultValues:
      item && itemRule
        ? toFormValues(item, itemRule.timezone)
        : getNewKnowledgeValues(rules[0]?.id ?? ""),
  });

  const ruleId = useWatch({ control: form.control, name: "ruleId" });
  const timezone = rules.find((rule) => rule.id === ruleId)?.timezone ?? "UTC";

  async function handleSubmit(values: KnowledgeFormValues) {
    const json = toRequestBody(values, timezone);
    const items = api.api["knowledge-items"];

    const response = item
      ? await items[":id"].$put({ param: { id: item.id }, json })
      : await items.$post({ json });

    if (response.status === 400) {
      const { fieldErrors } = await response.json();

      for (const field of ERROR_FIELDS) {
        const message = fieldErrors[field]?.[0];

        if (message) {
          form.setError(field, { message });
        }
      }

      return;
    }

    if (!response.ok) {
      form.setError("root", { message: "Could not save the item" });

      return;
    }

    await navigate({ to: "/knowledge" });
  }

  if (rules.length === 0) {
    return (
      <p className="mx-auto max-w-2xl text-muted-foreground">
        Knowledge belongs to an auto-reply rule.{" "}
        <Link to="/auto-reply-rules/new" className="underline">
          Create a rule
        </Link>{" "}
        first.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="mx-auto max-w-2xl space-y-6">
        {form.formState.errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        )}
        {item?.approvalStatus === "approved" && (
          <Alert>
            <AlertDescription>
              This item is approved. Saving a change returns it to draft, and you must approve it
              again before the assistant can use it.
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Knowledge</CardTitle>
            <CardDescription>What the assistant may say about one topic.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="ruleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rule</FormLabel>
                  <FormControl>
                    <NativeSelect className="w-full" {...field}>
                      {rules.map((rule) => (
                        <NativeSelectOption key={rule.id} value={rule.id}>
                          {rule.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="topic"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Topic</FormLabel>
                  <FormControl>
                    <Input placeholder="Project status" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="examples"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Examples</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={"How is the project going?\nWhen is the launch?"}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    How people might write about this topic: questions, requests or statements. One
                    example per line.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="response"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Response</FormLabel>
                  <FormControl>
                    <Textarea className="min-h-32" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="restrictions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Restrictions</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormDescription>
                    What the assistant must not say about this topic.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Validity</CardTitle>
            <CardDescription>
              When the assistant may use this item, in the timezone of the rule ({timezone}). Leave
              a date empty to keep that side open.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="validFrom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valid from</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="validUntil"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valid until</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
            <CardDescription>
              People a reply may point to for this topic.{" "}
              <Link to="/contacts" className="underline">
                Manage contacts
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="contactIds"
              render={({ field }) => (
                <FormItem>
                  {contacts.length === 0 && (
                    <p className="text-sm text-muted-foreground">You have no contacts yet.</p>
                  )}
                  {contacts.map((contact) => (
                    <FormItem key={contact.id} className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value.includes(contact.id)}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked
                                ? [...field.value, contact.id]
                                : field.value.filter((id) => id !== contact.id),
                            )
                          }
                        />
                      </FormControl>
                      <FormLabel className="font-normal">
                        {contact.name} ({contact.email})
                      </FormLabel>
                    </FormItem>
                  ))}
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {item ? "Save changes" : "Create item"}
          </Button>
          <Button asChild variant="outline">
            <Link to="/knowledge">Cancel</Link>
          </Button>
        </div>
      </form>
    </Form>
  );
}
