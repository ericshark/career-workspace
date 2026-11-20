// Tracker list logic: view tabs, filter, sort and stale detection. Pure, so it's
// unit-tested and shared by the page. Legacy statuses are mapped through statusColumn() everywhere.
import { statusColumn } from "./status";
import type { ApplicationRow, Status } from "./types";

/** Status order for menus and the status sort: things needing action first. */
export const GROUP_ORDER: Status[] = [
  "to apply",
  "in progress",
  "applied",
  "no response",
  "rejected",
  "unsuccessful",
];

/** The tab row above the list: everything or one status. */
export type TrackerView = "all" | Status;

export type SortKey = "date" | "company" | "fit" | "match";
export type SortDir = "asc" | "desc";

/** Date range: the Mon→Sun week containing today, the last 30 days, or everything. */
export type Since = "all" | "week" | "30d";

export interface TrackerFilters {
  q: string;
  view: TrackerView;
  sources: string[]; // empty = all
  since: Since;
}

export const NO_FILTERS: TrackerFilters = {
  q: "",
  view: "all",
  sources: [],
  since: "all",
};

export const STALE_DAYS = 21;

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** `applied` (not yet answered) and dated ≥21 days before today: the "no reply" rule. */
export function isStale(row: ApplicationRow, today: string): boolean {
  if (statusColumn(row.status).column !== "applied") return false;
  return dayNumber(today) - dayNumber(row.date) >= STALE_DAYS;
}

/** The first YYYY-MM-DD in the Next column ("OA by 2026-10-25"), or null. */
export function nextDueDate(row: ApplicationRow): string | null {
  return /\b\d{4}-\d{2}-\d{2}\b/.exec(row.next)?.[0] ?? null;
}

/** Monday of the week containing `today` (weeks run Mon → Sun). */
export function weekStart(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - sinceMonday * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function inView(row: ApplicationRow, view: TrackerView, today: string) {
  if (view === "all") return true;
  return statusColumn(row.status).column === view;
}

function inRange(row: ApplicationRow, since: Since, today: string) {
  if (since === "week") return row.date >= weekStart(today);
  if (since === "30d") return dayNumber(today) - dayNumber(row.date) < 30;
  return true;
}

/** Rows matching search, source and date range, before the view tab is applied. */
function baseFilter(
  rows: ApplicationRow[],
  f: TrackerFilters,
  today: string,
): ApplicationRow[] {
  const q = f.q.trim().toLowerCase();
  const sources = f.sources.map((s) => s.toLowerCase());
  return rows.filter(
    (r) =>
      (!q ||
        r.company.toLowerCase().includes(q) ||
        r.role.toLowerCase().includes(q)) &&
      (!sources.length || sources.includes(r.source.trim().toLowerCase())) &&
      inRange(r, f.since, today),
  );
}

export function filterRows(
  rows: ApplicationRow[],
  f: TrackerFilters,
  today: string,
): ApplicationRow[] {
  return baseFilter(rows, f, today).filter((r) => inView(r, f.view, today));
}

/** Count per tab under the current search, source and date filters, so tab badges match the list. */
export function viewCounts(
  rows: ApplicationRow[],
  f: TrackerFilters,
  today: string,
): Record<TrackerView, number> {
  const base = baseFilter(rows, f, today);
  const counts = { all: base.length } as Record<TrackerView, number>;
  for (const s of GROUP_ORDER) counts[s] = 0;
  for (const r of base) {
    counts[statusColumn(r.status).column]++;
  }
  return counts;
}

/** Numeric Fit or Match, or -1 when blank (hand-added and pre-v2 rows). */
const scoreOf = (r: ApplicationRow, field: "fit" | "match") =>
  r[field] === "" || Number.isNaN(Number(r[field])) ? -1 : Number(r[field]);

/** Default tie-break: newest date first, then file order (prepended rows are newer). */
function newestFirst(a: ApplicationRow, b: ApplicationRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.lineIndex - b.lineIndex;
}

/** Sorted copy. Rows without a score always sort last when sorting by Fit or Match. */
export function sortRows(
  rows: ApplicationRow[],
  key: SortKey,
  dir: SortDir,
): ApplicationRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: ApplicationRow, b: ApplicationRow): number => {
    switch (key) {
      case "date":
        return a.date === b.date ? 0 : a.date < b.date ? -1 : 1;
      case "company":
        return a.company.localeCompare(b.company, undefined, {
          sensitivity: "base",
        });
      case "fit":
      case "match":
        return scoreOf(a, key) - scoreOf(b, key);
    }
  };
  return [...rows].sort((a, b) => {
    if (key === "fit" || key === "match") {
      // Unscored rows go last in both directions.
      const ua = scoreOf(a, key) < 0;
      const ub = scoreOf(b, key) < 0;
      if (ua !== ub) return ua ? 1 : -1;
    }
    return sign * cmp(a, b) || newestFirst(a, b);
  });
}

/** Number of active filters in the Filter menu (for its badge); search and tabs aren't counted. */
export function activeFilterCount(f: TrackerFilters): number {
  return f.sources.length + (f.since !== "all" ? 1 : 0);
}
