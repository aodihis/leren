import { cn } from "@leren/ui";
import type { ComponentProps } from "react";

/**
 * The header of a page in the dashboard shell. It sticks to the top of the scrolling area, cancels
 * that area's padding to span its full width, and stays opaque so that content scrolls underneath
 * it.
 */
export function StickyPageHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "sticky -top-6 z-10 -mx-6 -mt-6 mb-6 bg-background px-6 shadow-[0_0_0_100vmax_var(--color-background)] [clip-path:inset(0_-100vmax)] after:absolute after:inset-x-[-100vmax] after:bottom-0 after:h-px after:bg-border",
        className,
      )}
      {...props}
    />
  );
}
