import { Badge, cn } from "@leren/ui";

import type { Rule } from "../types";

const STATUS_BADGES = {
  active: { label: "Active", className: "bg-success-soft text-success" },
  scheduled: { label: "Scheduled", className: "bg-info-soft text-info" },
  expired: { label: "Expired", className: "bg-subtle text-ink-muted" },
  disabled: { label: "Disabled", className: "bg-subtle text-ink-muted" },
} as const satisfies Record<Rule["status"], { label: string; className: string }>;

interface RuleStatusBadgeProps {
  status: Rule["status"];
}

/**
 * A status badge for a rule. Following the design system, status colours only carry status, and
 * every badge also has a dot so that the status never depends on colour alone.
 */
export function RuleStatusBadge({ status }: RuleStatusBadgeProps) {
  const { label, className } = STATUS_BADGES[status];

  return (
    <Badge variant="secondary" className={cn("h-5.5 gap-1.5 px-2", className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </Badge>
  );
}
