import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { api } from "../../../modules/api/api-client";
import { EmailStatusBadge } from "../../../modules/emails/components/email-status-badge";
import { DELIVERY_LABELS, OUTCOME_LABELS } from "../../../modules/emails/labels";

export const Route = createFileRoute("/_authed/emails/$messageId")({
  loader: async ({ params }) => {
    const response = await api.api.messages[":id"].$get({ param: { id: params.messageId } });

    if (response.status === 404) {
      throw notFound();
    }

    if (!response.ok) {
      throw new Error("Could not load the email.");
    }

    return response.json();
  },
  notFoundComponent: () => <p className="text-muted-foreground">This email does not exist.</p>,
  component: EmailPage,
});

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatTime(value: string | null): string {
  return value ? TIME_FORMAT.format(new Date(value)) : "—";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-title-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm">{label}</summary>
      <pre className="mt-2 overflow-x-auto rounded-md bg-subtle p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

/** Shows one email and the assistant's action. */
function EmailPage() {
  const email = Route.useLoaderData();
  const { decision } = email;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-2">
        <Link to="/emails" className="text-sm">
          Back to processed emails
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{email.subject || "(no subject)"}</h1>
          <EmailStatusBadge status={email.status} />
        </div>
      </div>
      <Section title="Email">
        <Fields
          rows={[
            ["From", email.from],
            ["To", email.to.join(", ") || "—"],
            ["Received", formatTime(email.receivedAt)],
            ["Status reason", email.statusReason ?? "—"],
          ]}
        />
        <pre className="whitespace-pre-wrap rounded-md bg-subtle p-3 text-sm">{email.body}</pre>
      </Section>
      {decision ? (
        <>
          <Section title="Decision">
            <Fields
              rows={[
                ["Outcome", OUTCOME_LABELS[decision.outcome]],
                ["Category", decision.category ?? "—"],
                ["Revisions", String(decision.revisions)],
                ["Reasons", decision.reasons.length > 0 ? decision.reasons.join(" ") : "—"],
              ]}
            />
            <h3 className="text-sm font-semibold">Reply</h3>
            {decision.body ? (
              <pre className="whitespace-pre-wrap rounded-md bg-subtle p-3 text-sm">
                {decision.body}
              </pre>
            ) : (
              <p className="text-muted-foreground">The assistant wrote no reply.</p>
            )}
            <h3 className="text-sm font-semibold">Cited playbooks</h3>
            {decision.citedPlaybooks.length > 0 ? (
              <ul className="list-disc pl-5 text-sm">
                {decision.citedPlaybooks.map((playbook) => (
                  <li key={playbook.id}>
                    <Link to="/playbooks/$playbookId" params={{ playbookId: playbook.id }}>
                      {playbook.topic}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">The reply cites no playbook.</p>
            )}
            <Json label="What the evaluator found" value={decision.evaluations} />
          </Section>
          <Section title="Delivery">
            <Fields
              rows={[
                ["Mode", decision.delivery.mode ?? "—"],
                ["State", decision.delivery.state ? DELIVERY_LABELS[decision.delivery.state] : "—"],
                ["Attempts", String(decision.delivery.attempts)],
                ["Started", formatTime(decision.delivery.startedAt)],
                ["Finished", formatTime(decision.delivery.finishedAt)],
                ["Draft id", decision.delivery.mailboxDraftId ?? "—"],
                ["Sent message id", decision.delivery.sentMessageId ?? "—"],
                ["Error", decision.delivery.error ?? "—"],
              ]}
            />
            {decision.delivery.request !== null && (
              <Json
                label="Request that was stored before the call"
                value={decision.delivery.request}
              />
            )}
            {decision.delivery.response !== null && (
              <Json label="Answer of the provider" value={decision.delivery.response} />
            )}
          </Section>
        </>
      ) : (
        <p className="text-muted-foreground">The assistant has not decided on this email yet.</p>
      )}
    </div>
  );
}
