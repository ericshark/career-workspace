"use client";

import { STATUS_LABEL } from "@/lib/status";
import { SUMMARY_STATUSES, trackerSummary } from "@/lib/trackerSummary";
import type { RecruitingView } from "@/lib/recruitingTypes";
import type { ApplicationRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function TrackerSummary({
  rows,
  recruiting,
  historyUnavailable,
  today,
}: {
  rows: ApplicationRow[];
  recruiting: RecruitingView | null;
  historyUnavailable: boolean;
  today: string;
}) {
  const summary = trackerSummary(rows, recruiting?.workflows, today);
  const metrics = [
    { label: "All time", value: summary.allTime },
    { label: "This week", value: summary.week },
    { label: "Today", value: summary.today },
    ...SUMMARY_STATUSES.map((status) => ({
      label: STATUS_LABEL[status],
      value: summary.totals[status],
      delta: status === "applied" || recruiting ? summary.recent[status] : null,
      bad: status !== "applied" && status !== "in progress",
      tooltip:
        status === "applied"
          ? "Applications submitted in the past 7 days, including those now in another status."
          : "Applications recorded entering this status in the past 7 days, even if they later moved on. Older history may be incomplete.",
    })),
  ];
  return (
    <section aria-label="Application summary">
      {historyUnavailable && (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          Status activity could not refresh.
        </p>
      )}
      <dl className="grid grid-cols-3 gap-x-5 gap-y-5 rounded-xl border bg-card px-4 py-4 sm:grid-cols-4 xl:grid-cols-8">
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={cn(
              "flex min-w-0 flex-col",
              index === 3 && "xl:border-l xl:pl-5",
            )}
          >
            <dt className="mb-1 text-xs text-muted-foreground">
              {metric.label}
            </dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              <strong className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
                {metric.value.toLocaleString()}
              </strong>
              {"delta" in metric && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className={cn(
                        "inline-flex shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-4 tabular-nums outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
                        !metric.delta
                          ? "bg-muted text-muted-foreground"
                          : metric.bad
                            ? "bg-destructive/10 text-destructive"
                            : "bg-success/10 text-success",
                      )}
                      aria-label={
                        metric.delta === null
                          ? `${metric.label} activity ${historyUnavailable ? "unavailable" : "loading"}`
                          : `${metric.delta} ${metric.label.toLowerCase()} in the past seven days`
                      }
                    >
                      {metric.delta === null ? "—" : `+${metric.delta}`}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {metric.delta === null
                      ? "Recorded status activity is not available yet."
                      : metric.tooltip}
                  </TooltipContent>
                </Tooltip>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
