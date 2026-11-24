import type { EmailDetail, EmailSummary } from "./types";

type Status = EmailSummary["status"];

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/**
 * How each status of an email is shown. Colours only carry status (the design system): success is
 * sent, warning is a reply that waits for the user, danger is an escalation or a failure, and info
 * is work in progress.
 */
export const STATUS_LABELS: Record<Status, { label: string; tone: Tone }> = {
  received: { label: "Received", tone: "neutral" },
  not_applicable: { label: "Ignored", tone: "neutral" },
  queued: { label: "Queued", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  drafted: { label: "Reply ready", tone: "warning" },
  sent: { label: "Sent", tone: "success" },
  escalated: { label: "Escalated", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
};

type Outcome = NonNullable<EmailSummary["outcome"]>;

/** What the pipeline decided to do with an email. */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  answer: "Answer",
  escalate: "Escalate",
  ignore: "Ignore",
};

/** The outcomes that the list can be filtered by. */
export const OUTCOME_FILTERS = Object.keys(OUTCOME_LABELS) as Outcome[];

type DeliveryState = NonNullable<EmailSummary["deliveryState"]>;

/** How far the delivery of a reply got. */
export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  pending: "Waiting",
  started: "In progress",
  completed: "Delivered",
  failed: "Not delivered",
};

/** The delivery states, in the order of the flow. */
export const DELIVERY_STATES = Object.keys(DELIVERY_LABELS) as DeliveryState[];

/** What a received email is about, as triage decides it. */
export const CATEGORY_LABELS = {
  project_question: "Project question",
  task_assignment: "Task assignment",
  informational: "Informational",
  urgent: "Urgent",
  other: "Other",
} as const;

type DeliveryMode = NonNullable<NonNullable<EmailDetail["decision"]>["delivery"]["mode"]>;

/** Whether a reply is saved as a draft or sent without approval. */
export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  draft: "Saved as a draft",
  send: "Sent without approval",
};

/**
 * Why an email has its status, for the reasons that are stored as a code. Any other reason is
 * already a sentence and is shown as it is.
 */
export const STATUS_REASON_LABELS = {
  bulk_mail: "A mailing list or automatic message",
  sender_not_allowed: "The sender is not on the allowed list",
  thread_mode: "The thread does not match the reply conditions",
  recipient_role: "You were not a direct recipient",
  not_sole_recipient: "Other people were also addressed",
  no_active_playbook: "No playbook is active for this account",
  account_unavailable: "The email account is not available",
  pipeline_error: "The assistant could not process the email",
  not_addressed: "The email does not address you",
} as const;

/**
 * Looks up the label of a stored code. A value that has no label, such as free text or a code from a
 * newer version, is returned unchanged, and an empty value is shown as a dash.
 */
export function labelFor(labels: Readonly<Record<string, string>>, value: string | null): string {
  if (!value) {
    return "—";
  }

  return labels[value] ?? value;
}

/** The statuses that the list can be filtered by, in the order of the flow. */
export const STATUS_FILTERS = Object.keys(STATUS_LABELS) as Status[];

/** The classes of the badge of each tone. */
export const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-subtle text-ink-muted",
};
