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
  NativeSelect,
  NativeSelectOption,
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
import type { InferRequestType } from "hono/client";

import { api } from "../../../modules/api/api-client";
import { AccountStatusBadge } from "../../../modules/channels/components/account-status-badge";
import { loadChannelAccounts } from "../../../modules/channels/load-channel-accounts";
import type { ChannelProvider } from "../../../modules/channels/types";

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Access was not granted, so no account was connected.",
  invalid_state: "The connection expired or did not match. Try connecting again.",
  conflict: "That account is already connected to another user.",
  limit: "You can connect at most 10 email accounts. Disconnect one before you connect another.",
  authentication_failed:
    "The mail server refused the user name or password. If your account uses two-step sign-in, use an app password.",
  server_unreachable: "The mail server could not be reached. Check the server names and ports.",
  encryption_failed:
    "The mail server could not set up an encrypted connection. Check the ports, or ask your host for the secure settings.",
  host_not_allowed: "That server address is not on the public internet.",
  invalid_settings: "Some settings are not valid. Check every field.",
  too_many_attempts: "Too many sign-in attempts. Wait a few minutes and try again.",
};

const IMAP_PORTS = [
  { port: 993, label: "993 (TLS)" },
  { port: 143, label: "143 (STARTTLS)" },
] as const;

const SMTP_PORTS = [
  { port: 465, label: "465 (TLS)" },
  { port: 587, label: "587 (STARTTLS)" },
] as const;

type SignInValues = InferRequestType<
  (typeof api.api)["channel-accounts"][":provider"]["sign-in"]["$post"]
>["json"];

type SignInField = keyof SignInValues;

const SIGN_IN_FIELDS: readonly SignInField[] = [
  "address",
  "username",
  "password",
  "imapHost",
  "imapPort",
  "smtpHost",
  "smtpPort",
];

/** The body of a refused request: an error code, or the messages of the invalid fields. */
type RefusalBody = { error?: string; fieldErrors?: Record<string, string[] | undefined> };

const GENERIC_ERROR = "Could not connect the account. Try again.";

interface ChannelsSearch {
  connected?: string;
  error?: string;
}

export const Route = createFileRoute("/_authed/channels/")({
  validateSearch: (search: Record<string, unknown>): ChannelsSearch => ({
    connected: typeof search.connected === "string" ? search.connected : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  loader: loadChannelAccounts,
  component: ChannelsPage,
});

/**
 * The form that connects an account by signing in to its mail server (decision 0063). Finding the
 * settings fills in the servers that the provider suggests for the address, and the user can change
 * them. The API validates the settings and signs in before it saves the account.
 */
function SignInForm({
  provider,
  onConnected,
  onCancel,
}: {
  provider: ChannelProvider;
  onConnected: () => Promise<void>;
  onCancel: () => void;
}) {
  const form = useForm<SignInValues>({
    defaultValues: {
      address: "",
      username: "",
      password: "",
      imapHost: "",
      imapPort: 993,
      smtpHost: "",
      smtpPort: 465,
    },
  });

  const [lookup, setLookup] = useState<"idle" | "searching" | "not_found">("idle");

  async function handleFindSettings() {
    setLookup("searching");

    const settings = await api.api["channel-accounts"][":provider"].settings
      .$get({ param: { provider: provider.name }, query: { address: form.getValues("address") } })
      .then(async (response) => (response.ok ? (await response.json()).settings : null))
      .catch(() => null);

    if (settings) {
      form.reset({ ...form.getValues(), ...settings });
    }

    setLookup(settings ? "idle" : "not_found");
  }

  async function handleSignIn(values: SignInValues) {
    const response = await api.api["channel-accounts"][":provider"]["sign-in"]
      .$post({ param: { provider: provider.name }, json: values })
      .catch(() => null);

    if (response?.ok) {
      await onConnected();

      return;
    }

    const body: RefusalBody = (await response?.json().catch(() => ({}))) ?? {};

    for (const field of SIGN_IN_FIELDS) {
      const message = body.fieldErrors?.[field]?.[0];

      if (message) {
        form.setError(field, { message });
      }
    }

    if (!body.fieldErrors) {
      form.setError("root", {
        message: (body.error && ERROR_MESSAGES[body.error]) ?? GENERIC_ERROR,
      });
    }
  }

  const textField = (
    name: Exclude<SignInField, "imapPort" | "smtpPort">,
    label: string,
    input: { type?: string; autoComplete?: string; placeholder?: string },
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...input} {...field} value={field.value ?? ""} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const portField = (
    name: "imapPort" | "smtpPort",
    label: string,
    options: readonly { port: number; label: string }[],
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <NativeSelect
              className="w-full"
              name={field.name}
              value={field.value}
              onBlur={field.onBlur}
              onChange={(event) => field.onChange(Number(event.target.value))}
            >
              {options.map((option) => (
                <NativeSelectOption key={option.port} value={option.port}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSignIn)} className="space-y-4 rounded-md border p-4">
        <div>
          <h3 className="font-semibold">Connect {provider.displayName}</h3>
          <p className="text-body-sm text-ink-muted">
            Use the settings your email host gives for mail programs. Where your host offers app
            passwords, create one for Leren instead of using your main password.
          </p>
        </div>
        {form.formState.errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            {textField("address", "Email address", { type: "email", autoComplete: "email" })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={lookup === "searching"}
              onClick={handleFindSettings}
            >
              Find settings
            </Button>
            {lookup === "not_found" && (
              <p className="text-sm text-ink-muted">
                No settings were found for this address. Enter them from your email host.
              </p>
            )}
          </div>
          {textField("username", "User name (if not the address)", { autoComplete: "username" })}
          {textField("password", "Password", {
            type: "password",
            autoComplete: "current-password",
          })}
          <div />
          {textField("imapHost", "Incoming server (IMAP)", { placeholder: "imap.example.com" })}
          {portField("imapPort", "IMAP port", IMAP_PORTS)}
          {textField("smtpHost", "Outgoing server (SMTP)", { placeholder: "smtp.example.com" })}
          {portField("smtpPort", "SMTP port", SMTP_PORTS)}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Signing in…" : "Connect"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}

/**
 * Connects and disconnects the user's channel accounts. Connecting an OAuth provider sends the
 * browser to the provider, which returns to the API and then to this page with `connected` or
 * `error` in the address. A provider without OAuth connects at once, and a provider that signs in
 * to a mail server opens a form.
 */
function ChannelsPage() {
  const { providers, accounts } = Route.useLoaderData();
  const { connected, error } = Route.useSearch();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<ChannelProvider | null>(null);

  async function handleSignedIn() {
    setSigningIn(null);
    setFailure(null);
    await router.invalidate();
  }

  async function handleConnect(provider: ChannelProvider) {
    if (provider.connection === "sign-in") {
      setSigningIn(provider);

      return;
    }

    const response = await api.api["channel-accounts"][":provider"].connect.$post({
      param: { provider: provider.name },
    });

    if (response.status === 409) {
      setFailure(ERROR_MESSAGES[(await response.json()).error] ?? GENERIC_ERROR);

      return;
    }

    if (!response.ok) {
      setFailure(GENERIC_ERROR);

      return;
    }

    const result = await response.json();

    if (result.status === "redirect") {
      window.location.assign(result.url);

      return;
    }

    setFailure(null);
    await router.invalidate();
  }

  async function handleDisconnect(id: string) {
    const response = await api.api["channel-accounts"][":id"].$delete({ param: { id } });

    setFailure(response.ok ? null : "Could not disconnect the account");

    if (response.ok) {
      await router.invalidate();
    }
  }

  const message = failure ?? (error ? (ERROR_MESSAGES[error] ?? GENERIC_ERROR) : null);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Channels</h1>
        <p className="text-body-sm text-ink-muted">
          Connect the accounts that the assistant watches. A playbook chooses which account it
          answers on.
        </p>
      </div>
      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {connected && !message && (
        <Alert>
          <AlertDescription>The account is connected.</AlertDescription>
        </Alert>
      )}
      <section className="space-y-3">
        <h2 className="text-title-sm font-semibold">Connected accounts</h2>
        {accounts.length === 0 ? (
          <p className="text-muted-foreground">You have not connected an account yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">{account.label}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {providers.find((provider) => provider.name === account.provider)
                      ?.displayName ?? account.provider}
                  </TableCell>
                  <TableCell>
                    <AccountStatusBadge account={account} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Disconnect ${account.label}`}
                      onClick={() => handleDisconnect(account.id)}
                    >
                      Disconnect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-title-sm font-semibold">Connect an account</h2>
        {providers.length === 0 ? (
          <p className="text-muted-foreground">No channel providers are enabled on this server.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {providers.map((provider) => (
              <Button key={provider.name} variant="outline" onClick={() => handleConnect(provider)}>
                Connect {provider.displayName}
              </Button>
            ))}
          </div>
        )}
        {signingIn && (
          <SignInForm
            key={signingIn.name}
            provider={signingIn}
            onConnected={handleSignedIn}
            onCancel={() => setSigningIn(null)}
          />
        )}
      </section>
    </div>
  );
}
