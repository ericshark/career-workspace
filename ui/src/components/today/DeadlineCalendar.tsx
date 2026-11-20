"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { addMonths, monthGrid, monthLabel, longDate } from "@/lib/calendar";
import { localDate, TIME_ZONE } from "@/lib/config";
import {
  numberedUpcoming,
  type CalendarItem,
} from "@/lib/recruitingPresentation";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
const eventTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: TIME_ZONE,
  timeZoneName: "short",
});

/**
 * Upcoming deadlines and appointments: the month calendar on top, the list
 * always open below. Only active items are highlighted, and each highlighted
 * day carries the number of its matching list row.
 */
export function DeadlineCalendar({
  items,
  now,
  unavailable = false,
}: {
  items: CalendarItem[];
  now: Date;
  unavailable?: boolean;
}) {
  const today = localDate(now);
  const upcoming = numberedUpcoming(items, now);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [flash, setFlash] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Clicking a highlighted day points at its rows in the list below.
  function showDay(date: string) {
    setFlash(date);
    listRef.current
      ?.querySelector(`[data-date="${date}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => setFlash((d) => (d === date ? null : d)), 1600);
  }
  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-xs"
      aria-label="Deadline calendar"
    >
      <div className="flex items-center justify-between gap-2 border-b pb-3">
        <h2 className="flex items-center gap-2 text-base">
          <span className="grid size-7 place-items-center rounded-lg bg-muted text-muted-foreground">
            <CalendarClockIcon aria-hidden className="size-4" />
          </span>
          Upcoming
        </h2>
        <div className="flex items-center gap-0.5">
          <p className="mr-1 text-xs font-medium" aria-live="polite">
            {monthLabel(month)}
          </p>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <span key={d} className="pb-1 text-[10px] text-muted-foreground">
            {d}
          </span>
        ))}
        {monthGrid(month).map((cell, index) => {
          if (!cell) return <span key={`blank-${index}`} />;
          const entries = upcoming.filter((i) => i.date === cell.date);
          const overdue = entries.some((i) => i.overdue);
          const label = `${longDate(cell.date)}, ${entries.length} items${overdue ? ", overdue deadline" : ""}`;
          return entries.length ? (
            <button
              key={cell.date}
              type="button"
              aria-label={label}
              aria-current={cell.date === today ? "date" : undefined}
              onClick={() => showDay(cell.date)}
              className="flex h-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span
                className={cn(
                  "relative flex size-7 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                  overdue
                    ? "bg-destructive/15 text-destructive"
                    : "bg-chart-1/15 text-chart-1",
                )}
                title={`${cell.day}: ${entries.map((e) => `${e.number}. ${e.title}`).join(", ")}`}
              >
                {entries[0].number}
                {entries.length > 1 && (
                  <span className="absolute -top-1 -right-1.5 rounded-full bg-foreground px-1 text-[8px] leading-3 text-background">
                    +{entries.length - 1}
                  </span>
                )}
              </span>
            </button>
          ) : (
            <span
              key={cell.date}
              aria-current={cell.date === today ? "date" : undefined}
              className={cn(
                "flex h-8 items-center justify-center rounded-md text-xs text-muted-foreground tabular-nums",
                cell.date === today && "bg-muted font-bold text-foreground",
              )}
            >
              {cell.day}
            </span>
          );
        })}
      </div>
      <div className="mt-2 border-t pt-3">
        {unavailable && (
          <p role="status" className="mb-2 text-xs text-warning">
            Some calendar data is unavailable.
          </p>
        )}
        <ul
          ref={listRef}
          aria-label="Upcoming deadline list"
          className="flex flex-col gap-2"
        >
          {upcoming.map((item) => (
            <li
              key={item.id}
              data-date={item.date}
              className="rounded-lg border bg-muted/30"
            >
              <Link
                href={item.href}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  flash === item.date && "bg-chart-1/10",
                )}
              >
                <span
                  aria-label={`Item ${item.number}`}
                  className={cn(
                    "mt-px grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums",
                    item.overdue
                      ? "bg-destructive/15 text-destructive"
                      : "bg-chart-1/15 text-chart-1",
                  )}
                >
                  {item.number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-5 font-medium break-words">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.company}
                    {item.proposed && " · Proposed, awaiting confirmation"}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <time
                    dateTime={item.at ?? item.date}
                    className={cn(
                      "font-medium",
                      item.overdue && "text-destructive",
                    )}
                  >
                    {new Intl.DateTimeFormat("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      ...(item.date.slice(0, 4) !== today.slice(0, 4)
                        ? { year: "numeric" as const }
                        : {}),
                      timeZone: "UTC",
                    }).format(new Date(`${item.date}T12:00:00Z`))}
                  </time>
                  {item.at && (
                    <time
                      dateTime={item.at}
                      className="mt-0.5 block text-muted-foreground"
                    >
                      {eventTime.format(new Date(item.at))}
                    </time>
                  )}
                  {item.overdue && (
                    <p className="mt-0.5 text-destructive">Overdue</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {upcoming.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">
            No upcoming deadlines or events.
          </p>
        )}
      </div>
    </section>
  );
}
