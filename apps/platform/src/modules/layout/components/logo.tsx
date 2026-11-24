import { cn } from "@leren/ui";

interface LogoProps {
  className?: string;
}

/** The brand mark of the product. */
export function Logo({ className }: LogoProps) {
  return (
    <span
      className={cn("grid size-7 flex-none place-items-center rounded-md bg-brand", className)}
      aria-hidden="true"
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle className="fill-sun" cx="10" cy="8" r="4" />
        <path
          className="fill-none stroke-on-brand stroke-2 [stroke-linecap:round]"
          d="M3 15c1.75-1.6 3.5-1.6 5.25 0s3.5 1.6 5.25 0 2.75-1.2 3.5-.6"
        />
      </svg>
    </span>
  );
}
