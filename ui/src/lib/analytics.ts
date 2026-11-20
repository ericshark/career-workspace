import type { ApplicationRow } from "./types";
import { addDays } from "./progress";
import { statusColumn } from "./status";
import { SOURCES } from "./sources";

export const OUTCOMES = [
  { key: "applied", label: "Awaiting response", color: "var(--chart-1)" },
  { key: "in progress", label: "In progress", color: "var(--chart-4)" },
  {
    key: "no response",
    label: "No response",
    color: "var(--warning)",
  },
  { key: "rejected", label: "Rejected", color: "var(--chart-5)" },
  {
    key: "unsuccessful",
    label: "Unsuccessful",
    color: "color-mix(in oklab, var(--chart-4) 55%, var(--chart-5))",
  },
  { key: "other", label: "Other status", color: "var(--chart-4)" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["key"];
export type AnalyticsRange = "30" | "90" | "all";
export type OutcomeCounts = Record<Outcome, number>;
export interface SourceResults {
  source: string;
  total: number;
  counts: OutcomeCounts;
  progressRate: number;
}
const blank = (): OutcomeCounts => ({
  applied: 0,
  "in progress": 0,
  "no response": 0,
  rejected: 0,
  unsuccessful: 0,
  other: 0,
});

function outcome(status: string): Outcome | "to apply" {
  const parsed = statusColumn(status);
  // statusColumn intentionally falls back to Applied for the tracker. Analytics must disclose unknown data instead.
  if (
    parsed.legacy &&
    !["replied", "screen", "interview", "offer", "ghosted"].includes(
      status.trim().toLowerCase(),
    )
  )
    return "other";
  return parsed.column;
}
/** Canonical site name: known names match case-insensitively, blanks group under Other. */
export function normalizeSource(rawSource: string) {
  const raw = rawSource.trim() || "Other";
  return SOURCES.find((s) => s.toLowerCase() === raw.toLowerCase()) ?? raw;
}
export function computeAnalytics(
  rows: ApplicationRow[],
  today: string,
  range: AnalyticsRange = "all",
) {
  const submitted = rows.filter(
    (r) => outcome(r.status) !== "to apply" && r.date <= today,
  );
  const from =
    range === "all" ? "0000-01-01" : addDays(today, -(Number(range) - 1));
  const selected = submitted.filter((r) => r.date >= from);
  const counts = blank();
  const sources = new Map<string, SourceResults>();
  for (const row of selected) {
    const status = outcome(row.status) as Outcome;
    counts[status]++;
    const source = normalizeSource(row.source);
    const key = source.toLowerCase();
    const entry = sources.get(key) ?? {
      source,
      total: 0,
      counts: blank(),
      progressRate: 0,
    };
    entry.total++;
    entry.counts[status]++;
    // Unsuccessful rows reached an assessment or interview, so they count as progress too.
    entry.progressRate =
      (entry.counts["in progress"] + entry.counts.unsuccessful) / entry.total;
    sources.set(key, entry);
  }
  const byDay: Record<string, number> = {};
  for (const row of submitted) byDay[row.date] = (byDay[row.date] ?? 0) + 1;
  const rollingStart = addDays(today, -27);
  return {
    total: selected.length,
    totalRejected:
      counts.rejected + counts["no response"] + counts.unsuccessful,
    counts,
    sources: [...sources.values()].sort(
      (a, b) => b.total - a.total || a.source.localeCompare(b.source),
    ),
    byDay,
    weeklyAverage: submitted.filter((r) => r.date >= rollingStart).length / 4,
  };
}

/** First date (<= today) with a recorded application, or undefined when none. */
export function earliestActivityDate(
  byDay: Record<string, number>,
  today: string,
) {
  return Object.keys(byDay)
    .filter((date) => date <= today && byDay[date] > 0)
    .sort()[0];
}

/**
 * A `length`-day window ending `offset` windows before `today` (offset 0 ends
 * today). Pure so the dashboard's back/forward buttons are testable.
 */
export function activityWindow(
  byDay: Record<string, number>,
  today: string,
  offset = 0,
  length = 30,
) {
  const end = addDays(today, -offset * length);
  const from = addDays(end, 1 - length);
  return Array.from({ length }, (_, i) => {
    const date = addDays(from, i);
    return { date, count: byDay[date] ?? 0 };
  });
}

/** Furthest-back offset whose window still reaches the earliest activity. */
export function maxWindowOffset(
  byDay: Record<string, number>,
  today: string,
  length = 30,
) {
  const first = earliestActivityDate(byDay, today);
  if (!first) return 0;
  const daysBack = Math.round(
    (Date.parse(today) - Date.parse(first)) / 86_400_000,
  );
  return Math.max(0, Math.floor(daysBack / length));
}

/**
 * Bar color from a day's count: deep red at 0-4, easing through orange to
 * light green at 25, then darker green every 5 up to the darkest at 100+.
 */
export function barColor(count: number) {
  if (count < 25) {
    const step = Math.floor(Math.max(0, count) / 5); // 0..4
    const hue = Math.round((step / 4) * 28); // red 0 -> orange 28
    const lightness = 38 + step * 5; // deep -> lighter
    return `hsl(${hue} 78% ${lightness}%)`;
  }
  const step = Math.min(15, Math.floor((count - 25) / 5)); // 0..15
  const lightness = 62 - (step / 15) * 36; // light green -> darkest
  return `hsl(142 62% ${Math.round(lightness)}%)`;
}

export function activityDays(
  byDay: Record<string, number>,
  today: string,
  range: "7" | "30" | "all" = "7",
) {
  const first = Object.keys(byDay)
    .filter((date) => date <= today && byDay[date] > 0)
    .sort()[0];
  const from =
    range === "all" ? (first ?? today) : addDays(today, 1 - Number(range));
  const count =
    Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000) + 1;
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(from, i);
    return { date, count: byDay[date] ?? 0 };
  });
}
