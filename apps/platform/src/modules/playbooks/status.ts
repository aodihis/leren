import type { Playbook } from "./types";

/**
 * What a playbook is doing for the user. A disabled playbook is shown as disabled. An enabled
 * playbook is shown by its period, so the user sees whether it is replying now, will reply later or
 * has stopped.
 */
export type PlaybookStatus = "disabled" | "active" | "scheduled" | "expired";

/**
 * Whether a playbook is on but listens on a channel without an active account, so it answers no
 * email (decision 0044). When `activeAccountIds` is `null` because the accounts could not be
 * loaded, only a playbook that names no account is flagged.
 */
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

/**
 * Combines whether a playbook is enabled and its period status into the one status that the
 * interface shows.
 */
export function getPlaybookStatus(
  playbook: Pick<Playbook, "enabled" | "periodStatus">,
): PlaybookStatus {
  return playbook.enabled ? playbook.periodStatus : "disabled";
}
