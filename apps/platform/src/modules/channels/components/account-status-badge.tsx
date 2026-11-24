import { Badge, cn } from "@leren/ui";

import type { ChannelAccount } from "../types";

const BADGES = {
  active: { label: "Connected", className: "bg-success-soft text-success" },
  revoked: { label: "Reconnect needed", className: "bg-danger-soft text-danger" },
  unavailable: { label: "Provider off", className: "bg-subtle text-ink-muted" },
} as const;

/** Returns the badge key of an account. */
function badgeOf(account: ChannelAccount): keyof typeof BADGES {
  if (account.status === "revoked") {
    return "revoked";
  }

  return account.usable ? "active" : "unavailable";
}

interface AccountStatusBadgeProps {
  account: ChannelAccount;
}

/** A status badge for a channel account. */
export function AccountStatusBadge({ account }: AccountStatusBadgeProps) {
  const { label, className } = BADGES[badgeOf(account)];

  return (
    <Badge variant="secondary" className={cn("h-5.5 gap-1.5 px-2", className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </Badge>
  );
}
