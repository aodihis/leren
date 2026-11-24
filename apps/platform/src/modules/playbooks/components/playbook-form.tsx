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
import { StickyPageHeader } from "../../layout/components/sticky-page-header";
import { getNewPlaybookValues, toFormValues, toRequestBody } from "../form-values";
import type { ChannelAccount } from "../../channels/types";
import type { Playbook, PlaybookFormValues } from "../types";

type SwitchName =
  | "enabled"
  | "email.replyWhenTo"
  | "email.replyWhenCc"
  | "email.replyWhenBcc"
  | "email.requireSoleRecipient"
  | "email.mentionOverrides"
  | "email.skipBulkMail";

type TabName = "knowledge" | "rules";

const TABS: { value: TabName; label: string }[] = [
  { value: "knowledge", label: "Knowledge" },
  { value: "rules", label: "Rules" },
];

interface SwitchFieldProps {
  control: Control<PlaybookFormValues>;
  name: SwitchName;
  label: string;
  description: string;
}

/**
 * Maps the name of each request field that the API can reject to the form field that shows the
 * message and to the tab that holds that field, or `null` for a field in the sidebar, which is
 * visible on every tab. The API reports a nested validation failure under
 * its top-level key, so a failure under `conditions` is shown at the only nested field that the
 * user can get wrong, the sender allowlist.
 */
const ERROR_FIELDS = {
  topic: { field: "topic", tab: "knowledge" },
  examples: { field: "examples", tab: "knowledge" },
  response: { field: "response", tab: "knowledge" },
  restrictions: { field: "restrictions", tab: "knowledge" },
  timezone: { field: "timezone", tab: null },
  startsAt: { field: "startsAt", tab: null },
  endsAt: { field: "endsAt", tab: null },
  conditions: { field: "email.senderAllowlist", tab: "rules" },
  channelAccountId: { field: "email.channelAccountId", tab: "rules" },
} as const;

const ACCOUNT_REQUIRED =
  "Choose the account that this playbook answers on, or turn the playbook off";

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
  accounts?: readonly ChannelAccount[];
}

/**
 * Creates a playbook, or replaces `playbook` when it is given, and returns to the playbook list
 * after a successful save. The Knowledge tab holds what the assistant may say and the Rules tab
 * holds the email conditions, while the sidebar holds whether the playbook is enabled and its
 * period. Everything belongs to one form that is saved as a whole from the header. The API
 * validates the request again, its field errors are shown next to the fields, and the form opens
 * the tab of the first field that was rejected.
 */
export function PlaybookForm({ playbook, accounts = [] }: PlaybookFormProps) {
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
    if (values.enabled && !values.email.channelAccountId) {
      form.setError("email.channelAccountId", { message: ACCOUNT_REQUIRED });
      setTab("rules");

      return;
    }

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

      const rejectedTab = rejected.map(([, { tab: name }]) => name).find((name) => name !== null);

      if (rejectedTab) {
        setTab(rejectedTab);
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
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <Tabs value={tab} onValueChange={(value) => setTab(value as TabName)} className="gap-0">
          <StickyPageHeader className="space-y-3 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Link
                  to="/playbooks"
                  className="text-label text-ink-muted underline-offset-4 hover:underline"
                >
                  Playbooks
                </Link>
                <h1 className="truncate text-title-lg font-semibold">
                  {playbook ? playbook.topic : "New playbook"}
                </h1>
              </div>
              <div className="flex flex-none gap-2">
                <Button asChild variant="outline">
                  <Link to="/playbooks">Cancel</Link>
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {playbook ? "Save changes" : "Create playbook"}
                </Button>
              </div>
            </div>
            <TabsList
              variant="line"
              className="group-data-[orientation=horizontal]/tabs:h-auto w-full justify-start gap-6 p-0"
            >
              {TABS.map(({ value, label }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="group-data-[orientation=horizontal]/tabs:after:bottom-0 h-auto flex-none rounded-none px-1 py-3 text-base after:bg-brand"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </StickyPageHeader>
          {form.formState.errors.root && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
            </Alert>
          )}
          <div className="grid items-start gap-8 pb-12 pt-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
              <TabsContent value="knowledge" className="space-y-6">
                <div className="space-y-5">
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
                          How people might write about this topic: questions, requests or
                          statements. One example per line.
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
                        <FormDescription>
                          What the assistant may say about this topic. Include whom a sender can
                          contact, if anyone.
                        </FormDescription>
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
                </div>
              </TabsContent>
              <TabsContent value="rules" className="space-y-6">
                <div className="space-y-5">
                  <div>
                    <h2 className="text-title-sm font-semibold">Email conditions</h2>
                    <p className="text-body-sm text-ink-muted">
                      Which emails the playbook answers while it is in effect.
                    </p>
                  </div>
                  <FormField
                    control={form.control}
                    name="email.channelAccountId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email account</FormLabel>
                        <FormControl>
                          <NativeSelect
                            className="w-full"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(event) => field.onChange(event.target.value || null)}
                          >
                            <NativeSelectOption value="">Choose an account</NativeSelectOption>
                            {accounts
                              .filter((account) => account.channel === "email")
                              .map((account) => (
                                <NativeSelectOption key={account.id} value={account.id}>
                                  {account.label}
                                </NativeSelectOption>
                              ))}
                          </NativeSelect>
                        </FormControl>
                        <FormDescription>
                          The connected account that this playbook answers on. It is required while
                          the playbook is enabled. Connect accounts on the Channels page.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email.replyMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Replies</FormLabel>
                        <FormControl>
                          <NativeSelect className="w-full" {...field}>
                            <NativeSelectOption value="draft">
                              Save as a draft for me to approve
                            </NativeSelectOption>
                            <NativeSelectOption value="send">
                              Send without approval
                            </NativeSelectOption>
                          </NativeSelect>
                        </FormControl>
                        <FormDescription>
                          Choose what happens to a reply that this playbook writes.
                        </FormDescription>
                      </FormItem>
                    )}
                  />
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
                </div>
              </TabsContent>
            </div>
            <aside className="space-y-4 lg:sticky lg:top-36">
              <section className="space-y-4 rounded-lg border bg-surface p-4">
                <div>
                  <h2 className="text-title-sm font-semibold">Status and period</h2>
                  <p className="text-body-sm text-ink-muted">
                    When the playbook is in effect. Leave a date empty to keep that side open.
                  </p>
                </div>
                <SwitchField
                  control={form.control}
                  name="enabled"
                  label="Enabled"
                  description="A disabled playbook is never used."
                />
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
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
                <div className="grid gap-4">
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
              </section>
            </aside>
          </div>
        </Tabs>
      </form>
    </Form>
  );
}
