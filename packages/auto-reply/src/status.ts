/** The derived period state of a playbook. */
export type AutoReplyStatus = "scheduled" | "active" | "expired";

/** The playbook fields of its period status. */
export interface AutoReplyWindow {
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Computes the period status of a playbook. */
export function getAutoReplyStatus(period: AutoReplyWindow, now: Date): AutoReplyStatus {
  if (period.startsAt && now < period.startsAt) {
    return "scheduled";
  }

  if (period.endsAt && now > period.endsAt) {
    return "expired";
  }

  return "active";
}
