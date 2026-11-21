/**
 * The approval state of a playbook. Only a person changes it, never an agent (decision 0035).
 */
export type KnowledgeApproval = "draft" | "approved" | "archived";

/**
 * The fields of a playbook that decide whether the assistant may use it. `startsAt` and
 * `endsAt` are instants and a missing bound is open.
 */
export interface KnowledgeUsability {
  approvalStatus: KnowledgeApproval;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Reports whether the assistant may use a playbook at `now`. A playbook is usable only when it
 * is approved and `now` is inside its period, and both bounds are inclusive. Code that
 * selects knowledge for a reply calls this function, so the rule is defined in one place.
 */
export function isKnowledgeUsable(playbook: KnowledgeUsability, now: Date): boolean {
  if (playbook.approvalStatus !== "approved") {
    return false;
  }

  if (playbook.startsAt && now < playbook.startsAt) {
    return false;
  }

  return !playbook.endsAt || now <= playbook.endsAt;
}
