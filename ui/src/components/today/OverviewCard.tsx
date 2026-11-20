"use client";
import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitForkIcon,
} from "lucide-react";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ApplicationFlow } from "@/components/today/ApplicationFlow";
import { useRecruiting } from "@/components/Recruiting";
import { useFetchJson } from "@/components/useFetchJson";
import type { ActionsPayload } from "@/lib/actionTypes";
import {
  deadlineItems,
  upcomingDeadlineItems,
} from "@/lib/recruitingPresentation";
import {
  activityWindow,
  barColor,
  computeAnalytics,
  maxWindowOffset,
  normalizeSource,
} from "@/lib/analytics";
import { longDate, monthGrid } from "@/lib/calendar";
import type { ApplicationRow, Progress } from "@/lib/types";
import { cn } from "@/lib/utils";

const weekdayDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });

/**
 * Dashboard totals and goals with optional activity details. The original flow
 * stays in the right-hand grid slot; its site filter affects only the flow.
 */
export function OverviewCard({
  progress,
  rows,
}: {
  progress: Progress;
  rows: ApplicationRow[];
}) {
  const today = progress.today.date;
  const [source, setSource] = useState("");
  const history = computeAnalytics(rows, today);
  // A site that disappeared from the data falls back to all sites.
  const selected = history.sources.some((s) => s.source === source)
    ? source
    : "";
  const flow = selected
    ? computeAnalytics(
        rows.filter((r) => normalizeSource(r.source) === selected),
        today,
      )
    : history;
  // The same upcoming items as the Upcoming list, so the week strip's blue
  // dots always agree with it.
  const actions = useFetchJson<ActionsPayload>("/api/actions", {
    events: true,
  });
  const recruiting = useRecruiting();
  const upcomingDates = new Set(
    actions.data
      ? upcomingDeadlineItems(
          deadlineItems(actions.data, recruiting.data, new Date()),
          new Date(),
        ).map((item) => item.date)
      : [],
  );
  const rejectedShare = progress.allTime
    ? Math.round((history.totalRejected / progress.allTime) * 100)
    : 0;
  const week = progress.week.tech + progress.week.bridge;
  const applied = progress.today.tech + progress.today.bridge;

  return (
    <section
      aria-label="Applications overview"
      className="grid gap-6 rounded-xl border bg-card px-5 py-5 shadow-xs xl:grid-cols-[minmax(0,0.95fr)_340px_minmax(0,1.15fr)] xl:gap-0 xl:divide-x [&>*]:xl:px-6 [&>*:first-child]:xl:pl-0 [&>*:last-child]:xl:pr-0"
    >
      <div className="flex min-w-0 flex-col justify-start gap-4 xl:col-span-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="All time" value={progress.allTime} />
          <Stat label="This week" value={week} target={progress.week.target} />
          <Stat label="Today" value={applied} target={progress.today.target} />
          <Stat
            label="Total rejected"
            value={history.totalRejected}
            corner={`${rejectedShare}% of all time`}
          />
        </div>
        <WeekStrip
          byDay={progress.byDay}
          today={today}
          upcomingDates={upcomingDates}
        />
        <details className="group/activity rounded-lg border bg-muted/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-medium outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            Last 30 days
            <ChevronDownIcon
              aria-hidden
              className="size-3.5 text-muted-foreground transition-transform group-open/activity:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="px-4 pb-3 pt-1">
            <Bars30 byDay={progress.byDay} today={today} />
          </div>
        </details>
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground">
              <GitForkIcon aria-hidden className="size-3.5 rotate-90" />
            </span>
            Application flow
            <span className="font-mono text-xs font-normal whitespace-nowrap text-muted-foreground">
              {flow.total} submitted
            </span>
          </h2>
          <NativeSelect
            size="sm"
            aria-label="Filter application flow by site"
            value={selected}
            onChange={(e) => setSource(e.target.value)}
          >
            <NativeSelectOption value="">All sites</NativeSelectOption>
            {history.sources.map((s) => (
              <NativeSelectOption key={s.source} value={s.source}>
                {s.source}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <ApplicationFlow total={flow.total} counts={flow.counts} />
      </div>
    </section>
  );
}

/** The same compact typography for counts and application goals. */
function Stat({
  label,
  value,
  target,
  corner,
}: {
  label: string;
  value: number;
  target?: number;
  /** Small muted note at the card's bottom-right (e.g. a share of all time). */
  corner?: string;
}) {
  const met = target !== undefined && value >= target;
  const percent = target ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div
      role="group"
      aria-label={label}
      className="relative flex min-h-[104px] min-w-0 flex-col rounded-lg border bg-muted/30 px-4 py-3.5"
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 font-mono tabular-nums">
        <span
          className={cn(
            "text-3xl leading-none font-semibold tracking-tight",
            met && "text-success",
          )}
        >
          {value}
        </span>
        {target !== undefined && (
          <span className="text-xs text-muted-foreground">/ {target}</span>
        )}
      </p>
      {corner && (
        <span className="absolute right-3 bottom-2.5 text-[10px] text-muted-foreground/80 tabular-nums">
          {corner}
        </span>
      )}
      {target !== undefined && (
        <div className="mt-auto flex items-center gap-2 pt-2.5">
          <div
            role="progressbar"
            aria-label={`${label} application goal`}
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={Math.max(target, value)}
            aria-valuetext={`${value} of ${target} applications`}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                met ? "bg-success" : "bg-chart-1",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {Math.round(percent)}%
          </span>
        </div>
      )}
    </div>
  );
}

/** Always-visible weekly activity, with dates/counts described on hover and to assistive technology. */
function WeekStrip({
  byDay,
  today,
  upcomingDates,
}: {
  byDay: Record<string, number>;
  today: string;
  upcomingDates: Set<string>;
}) {
  const cells = monthGrid(today.slice(0, 7));
  const index = cells.findIndex((cell) => cell?.date === today);
  const start = index - (index % 7);
  const days = cells.slice(start, start + 7);
  const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  return (
    <div
      className="grid grid-cols-7 gap-1.5"
      role="group"
      aria-label="Applications this week"
    >
      {days.map((cell, index) =>
        cell ? (
          <span
            key={cell.date}
            role="img"
            aria-label={`${longDate(cell.date)}: ${byDay[cell.date] ?? 0} applications${upcomingDates.has(cell.date) ? ", something upcoming" : ""}`}
            title={`${longDate(cell.date)}: ${byDay[cell.date] ?? 0} applications${upcomingDates.has(cell.date) ? " · upcoming" : ""}`}
            className={cn(
              "relative flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md tabular-nums",
              byDay[cell.date]
                ? "bg-success/10 text-success"
                : "bg-muted/60 text-muted-foreground",
              cell.date === today && "ring-1 ring-foreground/50",
            )}
          >
            <span className="text-[10px] font-medium tracking-wide uppercase opacity-70">
              {weekdays[index]}
            </span>
            <span className="text-xs font-semibold">
              {byDay[cell.date] || cell.day}
            </span>
            {upcomingDates.has(cell.date) && (
              <span
                aria-hidden
                data-testid="week-upcoming-dot"
                className="absolute top-1 right-1 size-1.5 rounded-full bg-chart-1"
              />
            )}
          </span>
        ) : (
          <span key={`edge-${index}`} />
        ),
      )}
    </div>
  );
}

/**
 * Last 30 days against the daily goal (the thin line). A weekday at or over the
 * goal is green and one under it is red; weekends stay grey unless they reach
 * the goal. Today is still in progress, so it stays blue until it reaches the
 * goal. Hover or focus a bar to see that day's count.
 */
function Bars30({
  byDay,
  today,
}: {
  byDay: Record<string, number>;
  today: string;
}) {
  // offset 0 is the 30 days ending today; each step goes back one more window.
  const [offset, setOffset] = useState(0);
  const maxOffset = maxWindowOffset(byDay, today);
  const current = Math.min(offset, maxOffset);
  const days = activityWindow(byDay, today, current);
  // The scale never drops below the 25 goal so a quiet window is not inflated;
  // the tallest day in the window sets the top.
  const max = Math.max(25, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const range = `${shortDay(days[0].date)} – ${shortDay(days[days.length - 1].date)}`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous 30 days"
            disabled={current >= maxOffset}
            onClick={() => setOffset(current + 1)}
            className="grid size-6 place-items-center rounded-md border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            <ChevronLeftIcon aria-hidden className="size-3.5" />
          </button>
          <span
            className="min-w-[8.5rem] text-center text-xs font-medium tabular-nums"
            aria-live="polite"
          >
            {range}
          </span>
          <button
            type="button"
            aria-label="Next 30 days"
            disabled={current === 0}
            onClick={() => setOffset(current - 1)}
            className="grid size-6 place-items-center rounded-md border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            <ChevronRightIcon aria-hidden className="size-3.5" />
          </button>
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          <strong className="text-sm font-semibold text-foreground">
            {total}
          </strong>{" "}
          total applied
        </span>
      </div>
      <div
        className="flex h-24 items-end gap-1"
        role="group"
        aria-label="Daily application counts, 30-day window"
      >
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            aria-label={`${day.date}: ${day.count} applications`}
            className="group relative flex h-full min-w-0 flex-1 items-end outline-offset-2"
          >
            <span
              className={cn(
                "w-full rounded-t-[3px] rounded-b-[1px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] transition-[filter,transform] group-hover:-translate-y-px group-hover:brightness-110 group-focus-visible:brightness-110 motion-reduce:transition-none",
                day.date === today && "ring-1 ring-foreground/60 ring-offset-1",
              )}
              style={{
                backgroundColor: barColor(day.count),
                height: day.count
                  ? `${Math.max(4, (day.count / max) * 100)}%`
                  : "3px",
              }}
            />
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background shadow-md group-hover:block group-focus-visible:block"
            >
              {weekdayDate(day.date)} · <strong>{day.count}</strong> applied
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const shortDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
