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

const ACTIONS = {
  draft: [
    { action: "approve", label: "Approve" },
    { action: "archive", label: "Archive" },
  ],
  approved: [{ action: "archive", label: "Archive" }],
  archived: [{ action: "restore", label: "Restore" }],
} as const;

type Action = (typeof ACTIONS)[keyof typeof ACTIONS][number]["action"];

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

  async function handleAction(id: string, action: Action) {
    const response = await api.api.playbooks[":id"][":action"].$post({ param: { id, action } });

    setFailure(response.ok ? null : `Could not ${action} the playbook`);

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
          You have no playbooks yet. Add what the assistant may say and when it replies, then
          approve the playbook so the assistant can use it.
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
                <TableCell className="font-medium">{playbook.topic}</TableCell>
                <TableCell>
                  <PlaybookStatusBadge status={getPlaybookStatus(playbook)} />
                </TableCell>
                <TableCell className="text-muted-foreground">{describePeriod(playbook)}</TableCell>
                <TableCell className="space-x-2 text-right">
                  {ACTIONS[playbook.approvalStatus].map(({ action, label }) => (
                    <Button
                      key={action}
                      variant="outline"
                      size="sm"
                      aria-label={`${label} ${playbook.topic}`}
                      onClick={() => handleAction(playbook.id, action)}
                    >
                      {label}
                    </Button>
                  ))}
                  <Button asChild variant="outline" size="sm">
                    <Link to="/playbooks/$playbookId" params={{ playbookId: playbook.id }}>
                      Edit
                    </Link>
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
