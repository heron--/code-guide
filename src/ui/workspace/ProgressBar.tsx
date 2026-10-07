import { cn } from "@/lib/utils";

/**
 * How far a module's run is: a narrow bar with a notch between each of its jobs, filling as they finish and
 * as the running one reports work.
 */
export function ProgressBar({
  fraction,
  jobs,
  label,
  className,
}: {
  fraction: number;
  /** The most jobs the run can take: one segment each. */
  jobs: number;
  label: string;
  className?: string;
}) {
  const actual = Math.min(1, Math.max(0, fraction));
  // A sliver shows even at the start, so the bar reads as started; assistive technology gets the real value.
  const shown = Math.max(0.04, actual);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(actual * 100)}
      className={cn("relative block h-2 w-[200px] max-w-full border border-border bg-surface-3", className)}
    >
      <span
        className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-700 ease-out"
        style={{ width: `${shown * 100}%` }}
      />
      {Array.from({ length: jobs - 1 }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-surface"
          style={{ left: `${((i + 1) / jobs) * 100}%` }}
        />
      ))}
    </span>
  );
}
