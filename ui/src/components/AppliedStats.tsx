import type { Progress } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Applied totals: all time · this week · today, counting submitted applications in any lane.
 * Neutral numbers with a quiet target; a count turns green once its target is reached.
 * `compact` is the smaller strip used above the Apply form.
 */
export function AppliedStats({
  progress,
  compact,
}: {
  progress: Progress;
  compact?: boolean;
}) {
  const today = progress.today.tech + progress.today.bridge;
  const week = progress.week.tech + progress.week.bridge;
  return (
    <div
      className={cn(
        "grid grid-cols-3 divide-x divide-border [&>div]:px-3 [&>div:first-child]:pl-0",
        compact ? "gap-2" : "gap-3",
      )}
    >
      <Stat label="All time" value={progress.allTime} compact={compact} />
      <Stat
        label="This week"
        value={week}
        of={progress.week.target}
        compact={compact}
      />
      <Stat
        label="Today"
        value={today}
        of={progress.today.target}
        compact={compact}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  of,
  compact,
}: {
  label: string;
  value: number;
  of?: number;
  compact?: boolean;
}) {
  const hit = of !== undefined && value >= of;
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-mono font-medium tracking-tight tabular-nums",
          compact ? "text-2xl" : "text-4xl sm:text-5xl",
          hit && "text-success",
        )}
      >
        {value}
        {compact && of !== undefined ? (
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            / {of}
          </span>
        ) : null}
      </div>
      {!compact && of !== undefined ? (
        <div className="text-xs text-muted-foreground">of {of}</div>
      ) : null}
    </div>
  );
}
