import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  NativeSelect,
  NativeSelectOption,
} from "@leren/ui";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { api } from "../../../modules/api/api-client";
import { EmailStatusBadge } from "../../../modules/emails/components/email-status-badge";
import {
  DELIVERY_LABELS,
  OUTCOME_FILTERS,
  OUTCOME_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
} from "../../../modules/emails/labels";
import type { EmailSummary } from "../../../modules/emails/types";

const PAGE_SIZE = "25";

interface EmailsSearch {
  status?: EmailSummary["status"];
  outcome?: NonNullable<EmailSummary["outcome"]>;
  failed?: true;
  since?: string;
  cursor?: string;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Returns a valid ISO instant or undefined. */
function parseSince(value: unknown): string | undefined {
  return typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

export const Route = createFileRoute("/_authed/emails/")({
  validateSearch: (search: Record<string, unknown>): EmailsSearch => ({
    status: STATUS_FILTERS.find((status) => status === search.status),
    outcome: OUTCOME_FILTERS.find((outcome) => outcome === search.outcome),
    failed: search.failed === true || search.failed === "true" ? true : undefined,
    since: parseSince(search.since),
    cursor: typeof search.cursor === "string" && search.cursor ? search.cursor : undefined,
  }),
  loaderDeps: ({ search }) => ({
    status: search.status,
    outcome: search.outcome,
    failed: search.failed,
    since: search.since,
    cursor: search.cursor,
  }),
  loader: async ({ deps }) => {
    const response = await api.api.messages.$get({
      query: {
        limit: PAGE_SIZE,
        status: deps.status,
        outcome: deps.outcome,
        failed: deps.failed ? "true" : undefined,
        since: deps.since,
        cursor: deps.cursor,
      },
    });

    if (!response.ok) {
      throw new Error("Could not load your processed emails.");
    }

    return response.json();
  },
  component: EmailsPage,
});

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Lists what the assistant did with each email. */
function EmailsPage() {
  const { messages, nextCursor } = Route.useLoaderData();
  const { status, outcome, failed, since, cursor } = Route.useSearch();
  const filters = { status, outcome, failed, since };
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Processed emails</h1>
          <p className="text-body-sm text-ink-muted">
            What the assistant did with each email it received.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Status
          <NativeSelect
            value={status ?? ""}
            onChange={(event) =>
              navigate({
                search: {
                  ...filters,
                  status: STATUS_FILTERS.find((value) => value === event.target.value),
                },
              })
            }
          >
            <NativeSelectOption value="">All</NativeSelectOption>
            {STATUS_FILTERS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {STATUS_LABELS[value].label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Outcome
          <NativeSelect
            value={outcome ?? ""}
            onChange={(event) =>
              navigate({
                search: {
                  ...filters,
                  outcome: OUTCOME_FILTERS.find((value) => value === event.target.value),
                },
              })
            }
          >
            <NativeSelectOption value="">All</NativeSelectOption>
            {OUTCOME_FILTERS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {OUTCOME_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      {failed || since ? (
        <p className="flex flex-wrap items-center gap-3 text-body-sm text-ink-muted">
          <span>
            Showing {failed ? "failed emails" : "emails"}
            {since ? ` received since ${TIME_FORMAT.format(new Date(since))}` : ""}.
          </span>
          <Link to="/emails" search={{ status, outcome }} className="underline">
            Show all emails
          </Link>
        </p>
      ) : null}
      {messages.length === 0 ? (
        <p className="text-muted-foreground">
          {status || outcome || failed || since
            ? "No email matches these filters."
            : "No email has been processed yet."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Delivery</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {messages.map((email) => (
              <TableRow key={email.id}>
                <TableCell>{email.from}</TableCell>
                <TableCell className="max-w-64 truncate font-medium">
                  <Link to="/emails/$messageId" params={{ messageId: email.id }}>
                    {email.subject || "(no subject)"}
                  </Link>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {TIME_FORMAT.format(new Date(email.receivedAt))}
                </TableCell>
                <TableCell>
                  <EmailStatusBadge status={email.status} />
                </TableCell>
                <TableCell>{email.outcome ? OUTCOME_LABELS[email.outcome] : "—"}</TableCell>
                <TableCell>
                  {email.deliveryState ? DELIVERY_LABELS[email.deliveryState] : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <nav aria-label="Pages" className="flex gap-4 text-sm">
        {cursor && (
          <Link to="/emails" search={{ ...filters }}>
            Newest emails
          </Link>
        )}
        {nextCursor && (
          <Link to="/emails" search={{ ...filters, cursor: nextCursor }}>
            Older emails
          </Link>
        )}
      </nav>
    </div>
  );
}
