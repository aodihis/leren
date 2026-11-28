import { Badge, cn } from "@leren/ui";

import type { PlaybookStatus } from "../status";

const STATUS_BADGES = {
  active: { label: "Active", className: "bg-success-soft text-success" },
  scheduled: { label: "Scheduled", className: "bg-info-soft text-info" },
  expired: { label: "Expired", className: "bg-subtle text-ink-muted" },
  disabled: { label: "Disabled", className: "bg-subtle text-ink-muted" },
} as const satisfies Record<PlaybookStatus, { label: string; className: string }>;

interface PlaybookStatusBadgeProps {
  status: PlaybookStatus;
}

/**
 * A status badge for a playbook. Every badge has a dot, so the status never depends on colour
 * alone. The colours follow the design system's message statuses: success for replying, info for
 * replying later, and subtle neutral for not in effect.
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
