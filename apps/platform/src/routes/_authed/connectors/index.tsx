import { Alert, AlertDescription, Badge, Button, cn } from "@leren/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../../../modules/api/api-client";
import { loadConnectors } from "../../../modules/connectors/load-connectors";
import type { AvailableConnector } from "../../../modules/connectors/types";

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Access was not granted, so nothing was connected.",
  invalid_state: "The connection expired or did not match. Try connecting again.",
};

const GENERIC_ERROR = "Could not connect. Try again.";

interface ConnectorsSearch {
  connected?: string;
  error?: string;
}

export const Route = createFileRoute("/_authed/connectors/")({
  validateSearch: (search: Record<string, unknown>): ConnectorsSearch => ({
    connected: typeof search.connected === "string" ? search.connected : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  loader: loadConnectors,
  component: ConnectorsPage,
});

/**
 * Connects and disconnects the tools that the assistant may read, such as Notion. Connecting sends
 * the browser to the tool, which returns to the API and then to this page with `connected` or
 * `error` in the address. The assistant gets the tools of a connector only while it is connected.
 */
function ConnectorsPage() {
  const { available, connections } = Route.useLoaderData();
  const { connected, error } = Route.useSearch();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  async function handleConnect(connector: AvailableConnector) {
    const response = await api.api.connectors[":connector"].connect.$post({
      param: { connector: connector.id },
    });

    if (!response.ok) {
      setFailure(GENERIC_ERROR);

      return;
    }

    const result = await response.json();

    window.location.assign(result.url);
  }

  async function handleDisconnect(connector: AvailableConnector["id"]) {
    const response = await api.api.connectors[":connector"].$delete({
      param: { connector },
    });

    setFailure(response.ok ? null : "Could not disconnect.");

    if (response.ok) {
      await router.invalidate();
    }
  }

  const message = failure ?? (error ? (ERROR_MESSAGES[error] ?? GENERIC_ERROR) : null);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connectors</h1>
        <p className="text-body-sm text-ink-muted">
          Connect the tools that hold your data. The assistant can read them to build playbooks. It
          cannot change anything in them, and it only sees a tool while it is connected.
        </p>
      </div>
      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {connected && !message && (
        <Alert>
          <AlertDescription>The connector is connected.</AlertDescription>
        </Alert>
      )}
      {available.length === 0 ? (
        <p className="text-muted-foreground">No connectors are enabled on this server.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {available.map((connector) => {
            const connection = connections.find((entry) => entry.connector === connector.id);
            const active = connection?.status === "active";

            return (
              <li key={connector.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-title-sm font-semibold">{connector.displayName}</h2>
                  {connection && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "h-5.5 gap-1.5 px-2",
                        active ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
                      )}
                    >
                      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                      {active ? "Connected" : "Reconnect needed"}
                    </Badge>
                  )}
                </div>
                {connection && <p className="text-muted-foreground">{connection.label}</p>}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`${connection ? "Reconnect" : "Connect"} ${connector.displayName}`}
                    onClick={() => handleConnect(connector)}
                  >
                    {connection ? "Reconnect" : "Connect"}
                  </Button>
                  {connection && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Disconnect ${connector.displayName}`}
                      onClick={() => handleDisconnect(connector.id)}
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
