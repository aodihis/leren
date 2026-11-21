/**
 * The fields of a playbook that decide whether the assistant may use it. `startsAt` and
 * `endsAt` are instants and a missing bound is open.
 */
export interface KnowledgeUsability {
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Reports whether the assistant may use a playbook at `now`. A playbook is usable only when it
 * is enabled and `now` is inside its period, and both bounds are inclusive. Code that
 * selects knowledge for a reply calls this function, so the rule is defined in one place.
 */
export function isKnowledgeUsable(playbook: KnowledgeUsability, now: Date): boolean {
  if (!playbook.enabled) {
    return false;
  }

  if (playbook.startsAt && now < playbook.startsAt) {
    return false;
  }

  return !playbook.endsAt || now <= playbook.endsAt;
}
