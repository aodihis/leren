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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  NativeSelect,
  NativeSelectOption,
  Switch,
  Textarea,
} from "@leren/ui";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import { api } from "../../api/api-client";
import { getNewRuleValues, toFormValues, toRequestBody } from "../form-values";
import type { Rule, RuleFormValues } from "../types";

type SwitchName =
  | "enabled"
  | "email.replyWhenTo"
  | "email.replyWhenCc"
  | "email.replyWhenBcc"
  | "email.requireSoleRecipient"
  | "email.mentionOverrides"
  | "email.skipBulkMail";

interface SwitchFieldProps {
  control: Control<RuleFormValues>;
  name: SwitchName;
  label: string;
  description: string;
}

/**
 * The API reports a nested validation failure under its top-level key, so a failure under `conditions`
 * is shown at the only nested field that the user can get wrong, the sender allowlist.
 */
const ERROR_FIELDS = {
  name: "name",
  startsAt: "startsAt",
  endsAt: "endsAt",
  timezone: "timezone",
  conditions: "email.senderAllowlist",
} as const;

/**
 * Returns the IANA timezone that the browser is set to.
 */
function getBrowserTimezone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Lists the IANA timezones the browser supports. The browser's own zone and the rule's zone are
 * always included, because the list does not contain every alias.
 */
function listTimezones(ruleTimezone: string): string[] {
  const own = getBrowserTimezone();

  return [...new Set([own, ruleTimezone, "UTC", ...Intl.supportedValuesOf("timeZone")])]
    .filter(Boolean)
    .sort();
}

function SwitchField({ control, name, label, description }: SwitchFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <FormLabel>{label}</FormLabel>
            <FormDescription>{description}</FormDescription>
          </div>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

interface RuleFormProps {
  rule?: Rule;
}

/**
 * Creates a rule, or replaces `rule` when it is given, and returns to the rule list after a
 * successful save. The API validates the request again and its field errors are shown next to the
 * fields.
 */
export function RuleForm({ rule }: RuleFormProps) {
  const navigate = useNavigate();

  const form = useForm<RuleFormValues>({
    defaultValues: rule ? toFormValues(rule) : getNewRuleValues(getBrowserTimezone()),
  });

  const ruleTimezone = rule?.timezone ?? "";
  const timezones = useMemo(() => listTimezones(ruleTimezone), [ruleTimezone]);
  const senderMode = useWatch({ control: form.control, name: "email.senderMode" });
  const mentionOverrides = useWatch({ control: form.control, name: "email.mentionOverrides" });

  async function handleSubmit(values: RuleFormValues) {
    const json = toRequestBody(values);
    const rules = api.api["auto-reply-rules"];

    const response = rule
      ? await rules[":id"].$put({ param: { id: rule.id }, json })
      : await rules.$post({ json });

    if (response.status === 400) {
      const { fieldErrors } = await response.json();

      for (const [key, field] of Object.entries(ERROR_FIELDS)) {
        const message = fieldErrors[key]?.[0];

        if (message) {
          form.setError(field, { message });
        }
      }

      return;
    }

    if (!response.ok) {
      form.setError("root", { message: "Could not save the rule" });

      return;
    }

    await navigate({ to: "/auto-reply-rules" });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="mx-auto max-w-2xl space-y-6">
        {form.formState.errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>
              When the rule is in effect. Leave a date empty to keep that side open.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Holiday, December" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SwitchField
              control={form.control}
              name="enabled"
              label="Enabled"
              description="A disabled rule never replies."
            />
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <FormControl>
                    <NativeSelect className="w-full" {...field}>
                      {timezones.map((timezone) => (
                        <NativeSelectOption key={timezone} value={timezone}>
                          {timezone}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starts</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ends</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Email conditions</CardTitle>
            <CardDescription>Which emails the rule answers while it is in effect.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="email.senderMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senders</FormLabel>
                  <FormControl>
                    <NativeSelect className="w-full" {...field}>
                      <NativeSelectOption value="any">Anyone</NativeSelectOption>
                      <NativeSelectOption value="allowlist">
                        Only the senders below
                      </NativeSelectOption>
                    </NativeSelect>
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email.senderAllowlist"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Allowed senders</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={"boss@acme.com\n@partner.org"}
                      disabled={senderMode !== "allowlist"}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>One address or @domain per line.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SwitchField
              control={form.control}
              name="email.replyWhenTo"
              label="Reply when I am in To"
              description="The message is addressed to me."
            />
            <SwitchField
              control={form.control}
              name="email.replyWhenCc"
              label="Reply when I am in Cc"
              description="I was copied on the message."
            />
            <SwitchField
              control={form.control}
              name="email.replyWhenBcc"
              label="Reply when I am in Bcc"
              description="My address is in neither To nor Cc."
            />
            <SwitchField
              control={form.control}
              name="email.requireSoleRecipient"
              label="Only when I am the sole recipient"
              description="Skip messages in To that are also sent to other people."
            />
            <SwitchField
              control={form.control}
              name="email.mentionOverrides"
              label="Reply when I am mentioned by name"
              description="A message that names me is answered even when my role or the number of recipients would exclude it."
            />
            <FormField
              control={form.control}
              name="email.mentionAliases"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Other names</FormLabel>
                  <FormControl>
                    <Input placeholder="Bal, Mr. Iqbal" disabled={!mentionOverrides} {...field} />
                  </FormControl>
                  <FormDescription>
                    Names to look for besides my own, separated by commas.
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email.mentionDetection"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mention detection</FormLabel>
                  <FormControl>
                    <NativeSelect className="w-full" disabled={!mentionOverrides} {...field}>
                      <NativeSelectOption value="alias">Match my names</NativeSelectOption>
                      <NativeSelectOption value="alias_then_llm">
                        Match my names, then ask an AI model
                      </NativeSelectOption>
                    </NativeSelect>
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email.threadMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Threads</FormLabel>
                  <FormControl>
                    <NativeSelect className="w-full" {...field}>
                      <NativeSelectOption value="both">New and existing threads</NativeSelectOption>
                      <NativeSelectOption value="new">New threads only</NativeSelectOption>
                      <NativeSelectOption value="reply">Existing threads only</NativeSelectOption>
                    </NativeSelect>
                  </FormControl>
                </FormItem>
              )}
            />
            <SwitchField
              control={form.control}
              name="email.skipBulkMail"
              label="Skip mailing lists and automatic messages"
              description="Never reply to newsletters, list mail or messages sent by a machine."
            />
          </CardContent>
        </Card>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {rule ? "Save changes" : "Create rule"}
        </Button>
      </form>
    </Form>
  );
}
