"use client";
import { useEffect, useState } from "react";
import { useFetchJson } from "@/components/useFetchJson";
import {
  CircleDotDashedIcon,
  ClipboardCheckIcon,
  LayoutListIcon,
  SearchIcon,
  SendIcon,
} from "lucide-react";

import {
  filterHistory,
  needsDecision,
  type HistoryFilter,
} from "@/lib/reviewPresentation";
import { localDate } from "@/components/applyHelpers";
import { TintBadge } from "@/components/TintBadge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { relativeDay } from "@/lib/calendar";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";
import type { HistoryItem, Status } from "@/lib/types";

/** Pill color + label for a history status (tracker statuses, or skipped / not decided). */
function statusStyle(status: string): { label: string; color: string } {
  if (status in STATUS_COLOR)
    return {
      label: STATUS_LABEL[status as Status],
      color: STATUS_COLOR[status as Status],
    };
  if (status === "skipped")
    return { label: "Skipped", color: "var(--muted-foreground)" };
  return { label: "Not decided", color: "var(--muted-foreground)" };
}

/**
 * Completed reviews, newest first: one line each with its status. `refreshKey` changes
 * whenever something was logged or a review finished, so the list refetches.
 */
export default function ReviewHistory({
  filter,
  onFilter,
  refreshKey,
  activeId,
  onOpen,
}: {
  filter: HistoryFilter;
  onFilter: (filter: HistoryFilter) => void;
  refreshKey: number;
  activeId: string | null;
  onOpen: (item: HistoryItem) => void;
}) {
  // Shared with the Tracker: one /api/reviews request, refetched when review or tracker files change.
  const history_ = useFetchJson<{ items: HistoryItem[] }>("/api/reviews");
  const items = history_.data?.items ?? null;
  const error = history_.error;
  const [query, setQuery] = useState("");
  const today = localDate();

  const reloadHistory = history_.reload;
  // refreshKey changes when something was logged or a review finished.
  useEffect(() => {
    void reloadHistory();
  }, [refreshKey, reloadHistory]);
  useEffect(() => {
    const refresh = () => void reloadHistory();
    window.addEventListener("review-viewed", refresh);
    return () => window.removeEventListener("review-viewed", refresh);
  }, [reloadHistory]);

  const search = filter === "summaries" ? query.trim().toLowerCase() : "";
  const history = filterHistory(items ?? [], filter);
  const shown = search
    ? history.filter((item) =>
        `${item.company} ${item.role}`.toLowerCase().includes(search),
      )
    : history;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <nav
        className="flex flex-col gap-0.5"
        role="group"
        aria-label="History filter"
      >
        {(
          [
            { value: "summaries", label: "Summaries", Icon: LayoutListIcon },
            { value: "reviews", label: "Reviews", Icon: ClipboardCheckIcon },
            { value: "to-apply", label: "To apply", Icon: SendIcon },
            {
              value: "in-progress",
              label: "In progress",
              Icon: CircleDotDashedIcon,
            },
          ] as const
        ).map(({ value, label, Icon }) => {
          const selected = filter === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => onFilter(value)}
              className={cn(
                "relative flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-3 text-left text-sm outline-none transition-colors hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50",
                selected
                  ? "bg-muted font-semibold text-foreground"
                  : "font-medium text-muted-foreground",
              )}
            >
              {/* Accent bar marks the active filter. */}
              {selected && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                />
              )}
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span
                className={cn(
                  "min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] leading-none tabular-nums",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {filterHistory(items ?? [], value).length}
              </span>
            </button>
          );
        })}
      </nav>
      <Separator className="my-1" />
      {filter === "summaries" && (
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search summaries"
            placeholder="Search company or role"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      )}
      <ul className="flex min-h-0 flex-1 flex-col divide-y divide-border/70 overflow-y-auto">
        {error && (
          <li className="px-2 text-xs text-destructive">
            Couldn&apos;t load history: {error}
          </li>
        )}
        {items && shown.length === 0 && (
          <li className="px-2 py-2 text-sm text-muted-foreground">
            {search
              ? "No matching summaries."
              : filter === "summaries"
                ? "No summaries yet."
                : filter === "reviews"
                  ? "No completed reviews yet."
                  : filter === "in-progress"
                    ? "No applications in progress."
                    : "No reviews to apply to."}
          </li>
        )}
        {shown.map((i) => {
          const undecided = needsDecision(i);
          const st = undecided
            ? {
                label: i.viewedAt === null ? "New" : "Viewed",
                color:
                  i.viewedAt === null
                    ? "var(--primary)"
                    : "var(--muted-foreground)",
              }
            : statusStyle(i.status);
          const active = i.id === activeId;
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onOpen(i)}
                className={cn(
                  "flex min-w-0 w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "bg-muted",
                )}
                title={i.company}
              >
                {i.persistenceWarning && (
                  <span className="text-xs text-warning">Save needs retry</span>
                )}
                <span
                  className={cn(
                    "block w-full truncate text-sm",
                    undecided && i.viewedAt === null
                      ? "font-semibold"
                      : "font-medium",
                  )}
                >
                  {i.company}
                </span>
                <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px]">
                  <TintBadge
                    color={st.color}
                    className="h-4 px-1.5 text-[11px]"
                  >
                    {st.label}
                  </TintBadge>
                  <span className="ml-auto text-muted-foreground">
                    {relativeDay(i.reviewedAt, today)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
