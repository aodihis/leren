import { cn } from "@leren/ui";
import type { ComponentProps } from "react";

/**
 * The header of a page that scrolls inside the dashboard shell. It sticks to the top edge of the
 * scrolling area and cancels the 1.5rem padding of that area, so it spans the whole width, and it
 * stays opaque so that the content scrolls underneath it. A line under it separates it from the
 * content.
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
