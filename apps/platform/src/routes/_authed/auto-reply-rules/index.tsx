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
import { RuleStatusBadge } from "../../../modules/auto-reply-rules/components/rule-status-badge";
import type { Rule } from "../../../modules/auto-reply-rules/types";

export const Route = createFileRoute("/_authed/auto-reply-rules/")({
  loader: async () => {
    const response = await api.api["auto-reply-rules"].$get();

    if (!response.ok) {
      throw new Error("Could not load your auto-reply rules.");
    }

    const { rules } = await response.json();

    return rules;
  },
  component: RulesPage,
});

/**
 * Describes the period of a rule in its own timezone, or says that it has no bounds.
 */
function describePeriod(rule: Rule): string {
  if (!rule.startsAt && !rule.endsAt) {
    return "Always";
  }

  const format = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(undefined, {
          timeZone: rule.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "open";

  return `${format(rule.startsAt)} to ${format(rule.endsAt)} (${rule.timezone})`;
}

function RulesPage() {
  const rules = Route.useLoaderData();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  async function handleDelete(id: string) {
    const response = await api.api["auto-reply-rules"][":id"].$delete({ param: { id } });

    setFailed(!response.ok);

    if (response.ok) {
      await router.invalidate();
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Auto-reply rules</h1>
        <Button asChild>
          <Link to="/auto-reply-rules/new">New rule</Link>
        </Button>
      </div>
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>Could not delete the rule</AlertDescription>
        </Alert>
      )}
      {rules.length === 0 ? (
        <p className="text-muted-foreground">
          You have no rules yet. Create one to choose when and to whom the assistant replies.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell>
                  <RuleStatusBadge status={rule.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{describePeriod(rule)}</TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/auto-reply-rules/$ruleId" params={{ ruleId: rule.id }}>
                      Edit
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${rule.name}`}
                    onClick={() => handleDelete(rule.id)}
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
