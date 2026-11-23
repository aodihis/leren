import { Badge, cn } from "@leren/ui";

import { STATUS_LABELS, TONE_CLASSES } from "../labels";
import type { EmailSummary } from "../types";

interface EmailStatusBadgeProps {
  status: EmailSummary["status"];
}

/**
 * A status badge for an email. Following the design system, status colours only carry status, and
 * every badge has a dot so that the status never depends on colour alone.
 */
export function EmailStatusBadge({ status }: EmailStatusBadgeProps) {
  const { label, tone } = STATUS_LABELS[status];

  return (
    <Badge variant="secondary" className={cn("h-5.5 gap-1.5 px-2", TONE_CLASSES[tone])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </Badge>
  );
}
