import { Button, Card, CardContent } from "@leren/ui";
import { Link } from "@tanstack/react-router";

import { EmailStatusBadge } from "../../emails/components/email-status-badge";
import { DELIVERY_LABELS, OUTCOME_FILTERS, OUTCOME_LABELS } from "../../emails/labels";
import type { Overview } from "../types";

/**
 * Shows how many emails arrived in the window of the overview and what the assistant decided for
 * them, with a link to the processed emails of each outcome, and lists the latest failures (decision
 * 0048). The counts are the ones the API computed, so this component does not derive them.
 */
export function MessageCounts({ overview }: { overview: Overview }) {
  return (
    <>
      <section aria-label="Email summary" className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-title-sm font-semibold">
            Emails in the last {overview.days} days
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/emails">View all</Link>
          </Button>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Card className="gap-0 p-4">
            <div className="text-body-sm text-ink-muted">Received</div>
            <div className="mt-1.5 text-display font-semibold tabular-nums">{overview.total}</div>
          </Card>
          {OUTCOME_FILTERS.map((outcome) => (
            <Card key={outcome} className="gap-0 p-4">
              <div className="text-body-sm text-ink-muted">{OUTCOME_LABELS[outcome]}</div>
              <div className="mt-1.5 text-display font-semibold tabular-nums">
                <Link
                  to="/emails"
                  search={{ outcome, since: overview.since }}
                  aria-label={`${OUTCOME_LABELS[outcome]} emails`}
                >
                  {overview.byOutcome[outcome] ?? 0}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </section>
      <Card className="gap-0 py-0">
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <h2 className="flex-1 text-title-sm font-semibold">Failures</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/emails" search={{ failed: true, since: overview.since }}>
              Failed emails
            </Link>
          </Button>
        </div>
        <CardContent className="p-0">
          {overview.failures.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">Nothing failed in this period.</p>
          ) : (
            <ul className="divide-y">
              {overview.failures.map((failure) => (
                <li key={failure.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Link
                    to="/emails/$messageId"
                    params={{ messageId: failure.id }}
                    className="flex-1 truncate font-medium hover:underline"
                  >
                    {failure.subject || "(no subject)"}
                  </Link>
                  {failure.deliveryState === "failed" ? (
                    <span className="text-ink-muted">{DELIVERY_LABELS.failed}</span>
                  ) : null}
                  <EmailStatusBadge status={failure.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
