import { Badge, cn } from "@leren/ui";

import type { PlaybookStatus } from "../status";

const STATUS_BADGES = {
  active: { label: "Active", className: "bg-success-soft text-success" },
  scheduled: { label: "Scheduled", className: "bg-info-soft text-info" },
  expired: { label: "Expired", className: "bg-subtle text-ink-muted" },
  draft: { label: "Draft", className: "bg-subtle text-ink-muted" },
  archived: { label: "Archived", className: "bg-subtle text-ink-muted" },
} as const satisfies Record<PlaybookStatus, { label: string; className: string }>;

interface PlaybookStatusBadgeProps {
  status: PlaybookStatus;
}

/**
 * A status badge for a playbook. Following the design system, status colours only carry status, and
 * every badge also has a dot so that the status never depends on colour alone.
 *
 * The design system defines status colours for messages, not for playbooks. Playbooks follow the
 * closest pattern: success for a playbook that is replying, info for one that will reply later, and
 * the subtle neutral colour for one that is not in effect.
 */
export function PlaybookStatusBadge({ status }: PlaybookStatusBadgeProps) {
  const { label, className } = STATUS_BADGES[status];

  return (
    <Badge variant="secondary" className={cn("h-5.5 gap-1.5 px-2", className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </Badge>
  );
}
