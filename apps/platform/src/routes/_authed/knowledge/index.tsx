import {
  Alert,
  AlertDescription,
  Badge,
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
import { loadRules } from "../../../modules/knowledge-items/load-rules";

const STATUS_BADGES = {
  draft: { label: "Draft", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  archived: { label: "Archived", variant: "outline" },
} as const;

const ACTIONS = {
  draft: [
    { action: "approve", label: "Approve" },
    { action: "archive", label: "Archive" },
  ],
  approved: [{ action: "archive", label: "Archive" }],
  archived: [{ action: "restore", label: "Restore" }],
} as const;

type Action = (typeof ACTIONS)[keyof typeof ACTIONS][number]["action"];

export const Route = createFileRoute("/_authed/knowledge/")({
  loader: async () => {
    const [response, rules] = await Promise.all([
      api.api["knowledge-items"].$get({ query: {} }),
      loadRules(),
    ]);

    if (!response.ok) {
      throw new Error("Could not load your knowledge.");
    }

    const { items } = await response.json();

    return { items, ruleNames: new Map(rules.map((rule) => [rule.id, rule.name])) };
  },
  component: KnowledgePage,
});

function KnowledgePage() {
  const { items, ruleNames } = Route.useLoaderData();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  async function handleAction(id: string, action: Action) {
    const response = await api.api["knowledge-items"][":id"][":action"].$post({
      param: { id, action },
    });

    setFailure(response.ok ? null : `Could not ${action} the item`);

    if (response.ok) {
      await router.invalidate();
    }
  }

  async function handleDelete(id: string) {
    const response = await api.api["knowledge-items"][":id"].$delete({ param: { id } });

    setFailure(response.ok ? null : "Could not delete the item");

    if (response.ok) {
      await router.invalidate();
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Knowledge</h1>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/knowledge/new">New item</Link>
          </Button>
        </div>
      </div>
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {items.length === 0 ? (
        <p className="text-muted-foreground">
          You have no knowledge yet. Add what the assistant may say, then approve it so the
          assistant can use it.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Topic</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.topic}</TableCell>
                <TableCell className="text-muted-foreground">
                  {ruleNames.get(item.ruleId) ?? "Unknown rule"}
                </TableCell>
                <TableCell className="space-x-2">
                  <Badge variant={STATUS_BADGES[item.approvalStatus].variant}>
                    {STATUS_BADGES[item.approvalStatus].label}
                  </Badge>
                  {item.approvalStatus === "approved" && !item.usable && (
                    <Badge variant="outline">Outside its validity</Badge>
                  )}
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  {ACTIONS[item.approvalStatus].map(({ action, label }) => (
                    <Button
                      key={action}
                      variant="outline"
                      size="sm"
                      aria-label={`${label} ${item.topic}`}
                      onClick={() => handleAction(item.id, action)}
                    >
                      {label}
                    </Button>
                  ))}
                  <Button asChild variant="outline" size="sm">
                    <Link to="/knowledge/$itemId" params={{ itemId: item.id }}>
                      Edit
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${item.topic}`}
                    onClick={() => handleDelete(item.id)}
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
