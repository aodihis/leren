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
  OUTCOME_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
} from "../../../modules/emails/labels";
import type { EmailSummary } from "../../../modules/emails/types";

const PAGE_SIZE = "25";

interface EmailsSearch {
  status?: EmailSummary["status"];
  cursor?: string;
}

export const Route = createFileRoute("/_authed/emails/")({
  validateSearch: (search: Record<string, unknown>): EmailsSearch => ({
    status: STATUS_FILTERS.find((status) => status === search.status),
    cursor: typeof search.cursor === "string" && search.cursor ? search.cursor : undefined,
  }),
  loaderDeps: ({ search }) => ({ status: search.status, cursor: search.cursor }),
  loader: async ({ deps }) => {
    const response = await api.api.messages.$get({
      query: { limit: PAGE_SIZE, status: deps.status, cursor: deps.cursor },
    });

    if (!response.ok) {
      throw new Error("Could not load your processed emails.");
    }

    return response.json();
  },
  component: EmailsPage,
});

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Lists what the assistant did with each email, newest first, with the sender, the subject, the
 * status, the outcome and the delivery state. The status filter and the page are in the address, so
 * a filtered view can be shared and survives a reload. The list is read only: a draft is acted on in
 * the mailbox (decision 0046).
 */
function EmailsPage() {
  const { messages, nextCursor } = Route.useLoaderData();
  const { status, cursor } = Route.useSearch();
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
                search: { status: STATUS_FILTERS.find((value) => value === event.target.value) },
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
      </div>
      {messages.length === 0 ? (
        <p className="text-muted-foreground">
          {status ? "No email has this status." : "No email has been processed yet."}
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
          <Link to="/emails" search={{ status }}>
            Newest emails
          </Link>
        )}
        {nextCursor && (
          <Link to="/emails" search={{ status, cursor: nextCursor }}>
            Older emails
          </Link>
        )}
      </nav>
    </div>
  );
}
