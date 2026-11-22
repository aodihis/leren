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
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../../../modules/api/api-client";
import { PlaybookStatusBadge } from "../../../modules/playbooks/components/playbook-status-badge";
import { getPlaybookStatus } from "../../../modules/playbooks/status";
import type { Playbook } from "../../../modules/playbooks/types";

export const Route = createFileRoute("/_authed/playbooks/")({
  loader: async () => {
    const response = await api.api.playbooks.$get({ query: {} });

    if (!response.ok) {
      throw new Error("Could not load your playbooks.");
    }

    const { playbooks } = await response.json();

    return playbooks;
  },
  component: PlaybooksPage,
});

/**
 * Describes the period of a playbook in its own timezone, or says that it has no bounds.
 */
function describePeriod(playbook: Playbook): string {
  if (!playbook.startsAt && !playbook.endsAt) {
    return "Always";
  }

  const format = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(undefined, {
          timeZone: playbook.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "open";

  return `${format(playbook.startsAt)} to ${format(playbook.endsAt)} (${playbook.timezone})`;
}

function PlaybooksPage() {
  const playbooks = Route.useLoaderData();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  async function handleToggle(playbook: Playbook) {
    const enabled = !playbook.enabled;

    const response = await api.api.playbooks[":id"].$patch({
      param: { id: playbook.id },
      json: { enabled },
    });

    setFailure(response.ok ? null : `Could not ${enabled ? "enable" : "disable"} the playbook`);

    if (response.ok) {
      await router.invalidate();
    }
  }

  async function handleDelete(id: string) {
    const response = await api.api.playbooks[":id"].$delete({ param: { id } });

    setFailure(response.ok ? null : "Could not delete the playbook");

    if (response.ok) {
      await router.invalidate();
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Playbooks</h1>
        <Button asChild>
          <Link to="/playbooks/new">New playbook</Link>
        </Button>
      </div>
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {playbooks.length === 0 ? (
        <p className="text-muted-foreground">
          You have no playbooks yet. Add what the assistant may say and when it replies.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Topic</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {playbooks.map((playbook) => (
              <TableRow key={playbook.id}>
                <TableCell className="font-medium">
                  <Link
                    to="/playbooks/$playbookId"
                    params={{ playbookId: playbook.id }}
                    className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {playbook.topic}
                  </Link>
                </TableCell>
                <TableCell>
                  <PlaybookStatusBadge status={getPlaybookStatus(playbook)} />
                </TableCell>
                <TableCell className="text-muted-foreground">{describePeriod(playbook)}</TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`${playbook.enabled ? "Disable" : "Enable"} ${playbook.topic}`}
                    onClick={() => handleToggle(playbook)}
                  >
                    {playbook.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${playbook.topic}`}
                    onClick={() => handleDelete(playbook.id)}
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
