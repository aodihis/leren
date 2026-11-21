/**
 * The derived period state of a playbook. The status is computed from the period and the current
 * time and is never stored, so it cannot be stale (decision 0035).
 */
export type AutoReplyStatus = "scheduled" | "active" | "expired";

/**
 * The fields of a playbook that determine its period status. `startsAt` and `endsAt` are instants.
 * A missing bound is open. The playbook's timezone only controls how the bounds are entered and
 * shown, so it does not take part in the computation.
 */
export interface AutoReplyWindow {
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Computes the period status of a playbook at `now`. A playbook is active from `startsAt` to
 * `endsAt`, and both bounds are inclusive. The approval status is separate and is not considered.
 */
export function getAutoReplyStatus(period: AutoReplyWindow, now: Date): AutoReplyStatus {
  if (period.startsAt && now < period.startsAt) {
    return "scheduled";
  }

  if (period.endsAt && now > period.endsAt) {
    return "expired";
  }

  return "active";
}
