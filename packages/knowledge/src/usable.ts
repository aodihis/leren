/**
 * The approval state of a knowledge item. Only a person changes it, never an agent (decision
 * 0020).
 */
export type KnowledgeApproval = "draft" | "approved" | "archived";

/**
 * The fields of a knowledge item that decide whether the assistant may use it. `validFrom` and
 * `validUntil` are instants and a missing bound is open.
 */
export interface KnowledgeUsability {
  approvalStatus: KnowledgeApproval;
  validFrom: Date | null;
  validUntil: Date | null;
}

/**
 * Reports whether the assistant may use a knowledge item at `now`. An item is usable only when it
 * is approved and `now` is inside its validity window, and both bounds are inclusive. Indexing and
 * retrieval apply this same rule, so an item that is not usable never reaches a reply.
 */
export function isKnowledgeUsable(item: KnowledgeUsability, now: Date): boolean {
  if (item.approvalStatus !== "approved") {
    return false;
  }

  if (item.validFrom && now < item.validFrom) {
    return false;
  }

  return !item.validUntil || now <= item.validUntil;
}
