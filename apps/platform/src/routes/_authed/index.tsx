import { Button, Card, CardContent } from "@leren/ui";
import { Link, createFileRoute } from "@tanstack/react-router";

import { api } from "../../modules/api/api-client";
import { MessageCounts } from "../../modules/dashboard/components/message-counts";
import { loadOverview } from "../../modules/dashboard/load-overview";
import { PlaybookStatusBadge } from "../../modules/playbooks/components/playbook-status-badge";
import { getPlaybookStatus } from "../../modules/playbooks/status";
import type { PlaybookStatus } from "../../modules/playbooks/status";

const STATS: { status: PlaybookStatus; label: string; meta: string }[] = [
  { status: "active", label: "Active playbooks", meta: "Replying to email now" },
  { status: "scheduled", label: "Scheduled", meta: "Start later" },
  { status: "expired", label: "Expired", meta: "Their period has ended" },
  { status: "disabled", label: "Disabled", meta: "Turned off by you" },
];

const SHOWN_PLAYBOOKS = 5;

export const Route = createFileRoute("/_authed/")({
  loader: async () => {
    const [response, overview] = await Promise.all([
      api.api.playbooks.$get({ query: {} }),
      loadOverview(),
    ]);

    if (!response.ok) {
      throw new Error("Could not load your playbooks.");
    }

    const { playbooks } = await response.json();

    return { playbooks, overview };
  },
  component: OverviewPage,
});

function OverviewPage() {
  const { playbooks, overview } = Route.useLoaderData();

  const shown = [
    ...playbooks.filter((playbook) => getPlaybookStatus(playbook) === "active"),
    ...playbooks.filter((playbook) => getPlaybookStatus(playbook) !== "active"),
  ].slice(0, SHOWN_PLAYBOOKS);

  return (
    <div className="space-y-5">
      <h1 className="text-title font-semibold">Overview</h1>
      <section
        aria-label="Playbook summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3"
      >
        {STATS.map(({ status, label, meta }) => (
          <Card key={status} className="gap-0 p-4">
            <div className="text-body-sm text-ink-muted">{label}</div>
            <div className="mt-1.5 text-display font-semibold tabular-nums">
              {playbooks.filter((playbook) => getPlaybookStatus(playbook) === status).length}
            </div>
            <div className="mt-0.5 text-xs leading-4 text-ink-muted">{meta}</div>
          </Card>
        ))}
      </section>
      {overview ? <MessageCounts overview={overview} /> : null}
      <Card className="gap-0 py-0">
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <h2 className="flex-1 text-title-sm font-semibold">Your playbooks</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/playbooks">View all</Link>
          </Button>
        </div>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <div className="space-y-3 p-4">
              <p className="text-sm text-ink-muted">
                You have no playbooks yet. Create one to choose what the assistant says and when it
                replies.
              </p>
              <Button asChild>
                <Link to="/playbooks/new">New playbook</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {shown.map((playbook) => (
                <li key={playbook.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Link
                    to="/playbooks/$playbookId"
                    params={{ playbookId: playbook.id }}
                    className="flex-1 truncate font-medium hover:underline"
                  >
                    {playbook.topic}
                  </Link>
                  <PlaybookStatusBadge status={getPlaybookStatus(playbook)} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
