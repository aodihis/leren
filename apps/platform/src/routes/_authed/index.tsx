import { Button, Card, CardContent } from "@leren/ui";
import { Link, createFileRoute } from "@tanstack/react-router";

import { api } from "../../modules/api/api-client";
import { RuleStatusBadge } from "../../modules/auto-reply-rules/components/rule-status-badge";
import type { Rule } from "../../modules/auto-reply-rules/types";

const STATS: { status: Rule["status"]; label: string; meta: string }[] = [
  { status: "active", label: "Active rules", meta: "Replying to email now" },
  { status: "scheduled", label: "Scheduled", meta: "Start later" },
  { status: "expired", label: "Expired", meta: "Their period has ended" },
  { status: "disabled", label: "Disabled", meta: "Turned off by you" },
];

const SHOWN_RULES = 5;

export const Route = createFileRoute("/_authed/")({
  loader: async () => {
    const response = await api.api["auto-reply-rules"].$get();

    if (!response.ok) {
      throw new Error("Could not load your auto-reply rules.");
    }

    const { rules } = await response.json();

    return rules;
  },
  component: OverviewPage,
});

function OverviewPage() {
  const rules = Route.useLoaderData();

  const shown = [
    ...rules.filter((rule) => rule.status === "active"),
    ...rules.filter((rule) => rule.status !== "active"),
  ].slice(0, SHOWN_RULES);

  return (
    <div className="space-y-5">
      <h1 className="text-[17px] leading-6 font-semibold">Overview</h1>
      <section
        aria-label="Rule summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3"
      >
        {STATS.map(({ status, label, meta }) => (
          <Card key={status} className="gap-0 p-4">
            <div className="text-[13px] leading-[18px] text-ink-muted">{label}</div>
            <div className="mt-1.5 text-[28px] leading-9 font-semibold tracking-tight tabular-nums">
              {rules.filter((rule) => rule.status === status).length}
            </div>
            <div className="mt-0.5 text-xs leading-4 text-ink-muted">{meta}</div>
          </Card>
        ))}
      </section>
      <Card className="gap-0 py-0">
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <h2 className="flex-1 text-[15px] leading-[22px] font-semibold">Your rules</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/auto-reply-rules">View all</Link>
          </Button>
        </div>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <div className="space-y-3 p-4">
              <p className="text-sm text-ink-muted">
                You have no rules yet. Create one to choose when and to whom the assistant replies.
              </p>
              <Button asChild>
                <Link to="/auto-reply-rules/new">New rule</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {shown.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Link
                    to="/auto-reply-rules/$ruleId"
                    params={{ ruleId: rule.id }}
                    className="flex-1 truncate font-medium hover:underline"
                  >
                    {rule.name}
                  </Link>
                  <RuleStatusBadge status={rule.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
