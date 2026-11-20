/**
 * The derived state of an auto-reply rule. The status is computed from the rule and the current
 * time and is never stored, so it cannot be stale (decision 0019).
 */
export type AutoReplyStatus = "disabled" | "scheduled" | "active" | "expired";

/**
 * The fields of an auto-reply rule that determine its status. `startsAt` and `endsAt` are instants.
 * A missing bound is open. The rule's timezone only controls how the bounds are entered and shown,
 * so it does not take part in the computation.
 */
export interface AutoReplyWindow {
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Computes the status of a rule at `now`. A rule is active from `startsAt` to `endsAt`, and both
 * bounds are inclusive.
 */
export function getAutoReplyStatus(rule: AutoReplyWindow, now: Date): AutoReplyStatus {
  if (!rule.enabled) {
    return "disabled";
  }

  if (rule.startsAt && now < rule.startsAt) {
    return "scheduled";
  }

  if (rule.endsAt && now > rule.endsAt) {
    return "expired";
  }

  return "active";
}
