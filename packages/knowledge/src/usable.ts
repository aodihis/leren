/** The playbook fields that decide usability. */
export interface KnowledgeUsability {
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Reports whether a playbook is usable at a time. */
export function isKnowledgeUsable(playbook: KnowledgeUsability, now: Date): boolean {
  if (!playbook.enabled) {
    return false;
  }

  if (playbook.startsAt && now < playbook.startsAt) {
    return false;
  }

  return !playbook.endsAt || now <= playbook.endsAt;
}
