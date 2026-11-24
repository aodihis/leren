import {
  Alert,
  AlertDescription,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@leren/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../../../modules/api/api-client";
import { AccountStatusBadge } from "../../../modules/channels/components/account-status-badge";
import { loadChannelAccounts } from "../../../modules/channels/load-channel-accounts";
import type { ChannelProvider } from "../../../modules/channels/types";

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Access was not granted, so no account was connected.",
  invalid_state: "The connection expired or did not match. Try connecting again.",
  conflict: "That account is already connected to another user.",
  limit: "You already have an email account. Disconnect it before you connect another.",
};

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

/** Connects and disconnects channel accounts. */
function ChannelsPage() {
  const { providers, accounts } = Route.useLoaderData();
  const { connected, error } = Route.useSearch();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  async function handleConnect(provider: ChannelProvider) {
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
                  <TableCell className="text-muted-foreground">{account.provider}</TableCell>
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
      </section>
    </div>
  );
}
