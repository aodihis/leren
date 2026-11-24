import { Button, Card } from "@leren/ui";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { api } from "../../../modules/api/api-client";
import {
  DELIVERY_LABELS,
  DELIVERY_STATES,
  OUTCOME_FILTERS,
  OUTCOME_LABELS,
} from "../../../modules/emails/labels";

export const Route = createFileRoute("/_authed/playbooks/$playbookId_/report")({
  loader: async ({ params }) => {
    const response = await api.api.dashboard.playbooks[":id"].report.$get({
      param: { id: params.playbookId },
    });

    if (response.status === 404 || response.status === 400) {
      throw notFound();
    }

    if (response.status === 409) {
      return null;
    }

    if (!response.ok) {
      throw new Error("Could not load the report.");
    }

    return response.json();
  },
  notFoundComponent: () => <p className="text-muted-foreground">This playbook does not exist.</p>,
  component: ReportPage,
});

function formatInTimezone(iso: string | null, timezone: string): string {
  if (!iso) {
    return "the beginning";
  }

  return new Date(iso).toLocaleString(undefined, {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Summarizes what one playbook did in its period. */
function ReportPage() {
  const report = Route.useLoaderData();
  const { playbookId } = Route.useParams();

  if (!report) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Report</h1>
        <p className="text-muted-foreground">
          This playbook has no report yet. A report is available when its period has ended.
        </p>
        <Button asChild variant="outline">
          <Link to="/playbooks/$playbookId" params={{ playbookId }}>
            Back to the playbook
          </Link>
        </Button>
      </div>
    );
  }

  const { playbook } = report;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Report: {playbook.topic}</h1>
        <p className="text-body-sm text-ink-muted">
          From {formatInTimezone(playbook.startsAt, playbook.timezone)} to{" "}
          {formatInTimezone(playbook.endsAt, playbook.timezone)} ({playbook.timezone})
        </p>
      </div>
      <section
        aria-label="Outcomes"
        className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3"
      >
        <Card className="gap-0 p-4">
          <div className="text-body-sm text-ink-muted">Emails handled</div>
          <div className="mt-1.5 text-display font-semibold tabular-nums">{report.total}</div>
        </Card>
        <Card className="gap-0 p-4">
          <div className="text-body-sm text-ink-muted">Cited in a reply</div>
          <div className="mt-1.5 text-display font-semibold tabular-nums">{report.cited}</div>
        </Card>
        {OUTCOME_FILTERS.map((outcome) => (
          <Card key={outcome} className="gap-0 p-4">
            <div className="text-body-sm text-ink-muted">{OUTCOME_LABELS[outcome]}</div>
            <div className="mt-1.5 text-display font-semibold tabular-nums">
              {report.byOutcome[outcome] ?? 0}
            </div>
          </Card>
        ))}
      </section>
      <section aria-label="Deliveries" className="space-y-2">
        <h2 className="text-title-sm font-semibold">Deliveries</h2>
        <ul className="divide-y rounded-lg border text-sm">
          {DELIVERY_STATES.map((state) => (
            <li key={state} className="flex justify-between px-4 py-2.5">
              <span>{DELIVERY_LABELS[state]}</span>
              <span className="tabular-nums">{report.byDeliveryState[state] ?? 0}</span>
            </li>
          ))}
        </ul>
      </section>
      <Button asChild variant="outline">
        <Link to="/playbooks/$playbookId" params={{ playbookId }}>
          Back to the playbook
        </Link>
      </Button>
    </div>
  );
}
