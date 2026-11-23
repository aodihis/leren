import type { EmailSummary } from "./types";

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
  delegate: "Delegate",
  escalate: "Escalate",
  ignore: "Ignore",
};

type DeliveryState = NonNullable<EmailSummary["deliveryState"]>;

/** How far the delivery of a reply got. */
export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  pending: "Waiting",
  started: "In progress",
  completed: "Delivered",
  failed: "Not delivered",
};

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
