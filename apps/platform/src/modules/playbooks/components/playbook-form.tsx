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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@leren/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import { api } from "../../api/api-client";
import { getNewPlaybookValues, toFormValues, toRequestBody } from "../form-values";
import type { Playbook, PlaybookFormValues } from "../types";

type SwitchName =
  | "email.replyWhenTo"
  | "email.replyWhenCc"
  | "email.replyWhenBcc"
  | "email.requireSoleRecipient"
  | "email.mentionOverrides"
  | "email.skipBulkMail";

type TabName = "knowledge" | "rules";

interface SwitchFieldProps {
  control: Control<PlaybookFormValues>;
  name: SwitchName;
  label: string;
  description: string;
}

/**
 * Maps the name of each request field that the API can reject to the form field that shows the
 * message and to the tab that holds that field. The API reports a nested validation failure under
 * its top-level key, so a failure under `conditions` is shown at the only nested field that the
 * user can get wrong, the sender allowlist.
 */
const ERROR_FIELDS = {
  topic: { field: "topic", tab: "knowledge" },
  examples: { field: "examples", tab: "knowledge" },
  response: { field: "response", tab: "knowledge" },
  restrictions: { field: "restrictions", tab: "knowledge" },
  contacts: { field: "contacts", tab: "knowledge" },
  timezone: { field: "timezone", tab: "rules" },
  startsAt: { field: "startsAt", tab: "rules" },
  endsAt: { field: "endsAt", tab: "rules" },
  conditions: { field: "email.senderAllowlist", tab: "rules" },
} as const;

/**
 * Returns the IANA timezone that the browser is set to.
 */
function getBrowserTimezone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Lists the IANA timezones the browser supports. The browser's own zone and the playbook's zone are
 * always included, because the list does not contain every alias.
 */
function listTimezones(playbookTimezone: string): string[] {
  const own = getBrowserTimezone();

  return [...new Set([own, playbookTimezone, "UTC", ...Intl.supportedValuesOf("timeZone")])]
    .filter(Boolean)
    .toSorted();
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

interface PlaybookFormProps {
  playbook?: Playbook;
}

/**
 * Creates a playbook, or replaces `playbook` when it is given, and returns to the playbook list
 * after a successful save. The Knowledge tab holds what the assistant may say and the Rules tab
 * holds when it replies, and both tabs belong to one form that is saved as a whole. The API
 * validates the request again, its field errors are shown next to the fields, and the form opens
 * the tab of the first field that was rejected.
 */
export function PlaybookForm({ playbook }: PlaybookFormProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabName>("knowledge");

  const form = useForm<PlaybookFormValues>({
    defaultValues: playbook ? toFormValues(playbook) : getNewPlaybookValues(getBrowserTimezone()),
  });

  const playbookTimezone = playbook?.timezone ?? "";
  const timezones = useMemo(() => listTimezones(playbookTimezone), [playbookTimezone]);
  const senderMode = useWatch({ control: form.control, name: "email.senderMode" });
  const mentionOverrides = useWatch({ control: form.control, name: "email.mentionOverrides" });

  async function handleSubmit(values: PlaybookFormValues) {
    const json = toRequestBody(values);
    const playbooks = api.api.playbooks;

    const response = playbook
      ? await playbooks[":id"].$put({ param: { id: playbook.id }, json })
      : await playbooks.$post({ json });

    if (response.status === 400) {
      const { fieldErrors } = await response.json();
      const rejected = Object.entries(ERROR_FIELDS).filter(([key]) => fieldErrors[key]?.[0]);

      for (const [key, { field }] of rejected) {
        form.setError(field, { message: fieldErrors[key]?.[0] });
      }

      if (rejected.length > 0) {
        setTab(rejected[0][1].tab);
      }

      return;
    }

    if (!response.ok) {
      form.setError("root", { message: "Could not save the playbook" });

      return;
    }

    await navigate({ to: "/playbooks" });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="mx-auto max-w-2xl space-y-6">
        {form.formState.errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        )}
        {playbook?.approvalStatus === "approved" && (
          <Alert>
            <AlertDescription>
              This playbook is approved. Saving a change returns it to draft, and you must approve
              it again before the assistant can use it.
            </AlertDescription>
          </Alert>
        )}
        <Tabs value={tab} onValueChange={(value) => setTab(value as TabName)}>
          <TabsList>
            <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>
          <TabsContent value="knowledge" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Knowledge</CardTitle>
                <CardDescription>What the assistant may say about one topic.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                        How people might write about this topic: questions, requests or statements.
                        One example per line.
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
                <FormField
                  control={form.control}
                  name="contacts"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contacts</FormLabel>
                      <FormControl>
                        <Input placeholder="dewi@example.com, @Don" {...field} />
                      </FormControl>
                      <FormDescription>
                        Who a reply may point to for this topic. Separate email addresses or handles
                        with commas.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="rules" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Period</CardTitle>
                <CardDescription>
                  When the playbook is in effect. Leave a date empty to keep that side open.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                <CardDescription>
                  Which emails the playbook answers while it is in effect.
                </CardDescription>
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
                        <Input
                          placeholder="Bal, Mr. Iqbal"
                          disabled={!mentionOverrides}
                          {...field}
                        />
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
                          <NativeSelectOption value="both">
                            New and existing threads
                          </NativeSelectOption>
                          <NativeSelectOption value="new">New threads only</NativeSelectOption>
                          <NativeSelectOption value="reply">
                            Existing threads only
                          </NativeSelectOption>
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
          </TabsContent>
        </Tabs>
        <div className="flex gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {playbook ? "Save changes" : "Create playbook"}
          </Button>
          <Button asChild variant="outline">
            <Link to="/playbooks">Cancel</Link>
          </Button>
        </div>
      </form>
    </Form>
  );
}
