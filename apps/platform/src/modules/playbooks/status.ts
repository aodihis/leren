import type { Playbook } from "./types";

/**
 * What a playbook is doing for the user. A draft or archived playbook is shown by its approval
 * status. An approved playbook is shown by its period, so the user sees whether it is replying now,
 * will reply later or has stopped.
 */
export type PlaybookStatus = "draft" | "archived" | "active" | "scheduled" | "expired";

/**
 * Combines the approval status and the period status of a playbook into the one status that the
 * interface shows.
 */
export function getPlaybookStatus(playbook: Pick<Playbook, "approvalStatus" | "periodStatus">) {
  return playbook.approvalStatus === "approved" ? playbook.periodStatus : playbook.approvalStatus;
}
