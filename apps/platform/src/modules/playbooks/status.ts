import type { Playbook } from "./types";

/**
 * What a playbook is doing for the user. A disabled playbook is shown as disabled. An enabled
 * playbook is shown by its period, so the user sees whether it is replying now, will reply later or
 * has stopped.
 */
export type PlaybookStatus = "disabled" | "active" | "scheduled" | "expired";

/**
 * Combines whether a playbook is enabled and its period status into the one status that the
 * interface shows.
 */
export function getPlaybookStatus(
  playbook: Pick<Playbook, "enabled" | "periodStatus">,
): PlaybookStatus {
  return playbook.enabled ? playbook.periodStatus : "disabled";
}
