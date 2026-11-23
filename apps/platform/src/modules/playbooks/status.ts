import type { Playbook } from "./types";

/**
 * What a playbook is doing for the user. A disabled playbook is shown as disabled. An enabled
 * playbook is shown by its period, so the user sees whether it is replying now, will reply later or
 * has stopped.
 */
export type PlaybookStatus = "disabled" | "active" | "scheduled" | "expired";

/**
 * Whether a playbook is on and listens on a channel without an account that is active. It names no
 * account, or it names one that was revoked or deleted, so it answers no email, and the list shows
 * it so that the user can choose an account (decision 0044). `activeAccountIds` is `null` when the
 * accounts could not be loaded, and then only a playbook that names no account is flagged.
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
