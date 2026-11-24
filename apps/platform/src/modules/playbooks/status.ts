import type { Playbook } from "./types";

/** What a playbook is doing for the user. */
export type PlaybookStatus = "disabled" | "active" | "scheduled" | "expired";

/** Whether a playbook has no active account. */
export function hasNoMailbox(
  playbook: Pick<Playbook, "enabled" | "conditions">,
  activeAccountIds: ReadonlySet<string> | null,
): boolean {
  return (
    playbook.enabled &&
    playbook.conditions.some(
      (entry) =>
        !entry.channelAccountId ||
        (activeAccountIds !== null && !activeAccountIds.has(entry.channelAccountId)),
    )
  );
}

/** Combines enabled state and period into one status. */
export function getPlaybookStatus(
  playbook: Pick<Playbook, "enabled" | "periodStatus">,
): PlaybookStatus {
  return playbook.enabled ? playbook.periodStatus : "disabled";
}
