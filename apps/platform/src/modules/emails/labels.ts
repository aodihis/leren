import type { EmailSummary } from "./types";

type Status = EmailSummary["status"];

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/** How each email status is shown. */
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

/** The statuses the email list can filter by. */
export const STATUS_FILTERS = Object.keys(STATUS_LABELS) as Status[];

/** The classes of the badge of each tone. */
export const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-subtle text-ink-muted",
};
