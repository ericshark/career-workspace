// Today / week / streak. Pure functions, `today` injected for tests. Owner: Agent B. Spec: docs/03-data-layer.md ("Progress math").
import { isRejectedStatus } from "./status";
import {
  DAY_TARGET,
  WEEK_TARGET,
  type ApplicationRow,
  type Progress,
  type WeekRange,
} from "./types";

const DAY_MS = 86_400_000;

// Dates are plain YYYY-MM-DD strings; do all arithmetic in UTC so DST and the local
// timezone can never shift a day.
function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}
export function addDays(date: string, n: number): string {
  return new Date(toMs(date) + n * DAY_MS).toISOString().slice(0, 10);
}
/** 0 = Sunday … 6 = Saturday. */
function dayOfWeek(date: string): number {
  return new Date(toMs(date)).getUTCDay();
}
function isWeekday(date: string): boolean {
  const d = dayOfWeek(date);
  return d >= 1 && d <= 5;
}

/**
 * Streak rule: walk back from `start`. A day with ≥1 application adds 1 (weekends included); an
 * empty Saturday or Sunday is skipped; an empty weekday ends the streak.
 */
export function streakEndingAt(
  byDay: Record<string, number>,
  start: string,
): number {
  let streak = 0;
  // The earliest logged date bounds the walk (also guards against an endless loop).
  const dates = Object.keys(byDay);
  if (!dates.length) return 0;
  const earliest = dates.reduce((a, b) => (a < b ? a : b));
  for (let d = start; d >= earliest; d = addDays(d, -1)) {
    if ((byDay[d] ?? 0) > 0) streak++;
    else if (isWeekday(d)) break;
  }
  return streak;
}

/** Longest streak anywhere in the history, same rule as streakEndingAt. */
export function bestStreak(byDay: Record<string, number>): number {
  const dates = Object.keys(byDay)
    .filter((d) => byDay[d] > 0)
    .sort();
  if (!dates.length) return 0;
  let best = 0;
  let run = 0;
  // Walk forward day by day from the first to the last logged date.
  for (let d = dates[0]; d <= dates[dates.length - 1]; d = addDays(d, 1)) {
    if ((byDay[d] ?? 0) > 0) best = Math.max(best, ++run);
    else if (isWeekday(d)) run = 0;
  }
  return best;
}

/**
 * Rolling averages over completed days: the first application's date through yesterday.
 * Today is left out of both the numerator and the denominator so a half-finished day
 * never drags the numbers down; it joins them tomorrow.
 */
export function computeAverages(
  byDay: Record<string, number>,
  today: string,
): Progress["averages"] {
  const lastDay = addDays(today, -1);
  const dates = Object.keys(byDay).filter((d) => d <= lastDay);
  if (!dates.length) {
    return {
      perWeekday: null,
      perActiveDay: null,
      perCalendarDay: null,
      elapsedDays: null,
    };
  }
  const first = dates.reduce((a, b) => (a < b ? a : b));
  let total = 0;
  let activeDays = 0;
  for (const d of dates) {
    total += byDay[d];
    if (byDay[d] > 0) activeDays++;
  }
  let calendarDays = 0;
  let weekdays = 0;
  for (let d = first; d <= lastDay; d = addDays(d, 1)) {
    calendarDays++;
    if (isWeekday(d)) weekdays++;
  }
  return {
    // A span of only weekend days has no weekdays to divide by.
    perWeekday: weekdays ? total / weekdays : null,
    perActiveDay: activeDays ? total / activeDays : null,
    perCalendarDay: total / calendarDays,
    elapsedDays: calendarDays,
  };
}

/** A row counts as "sent" for any status except `to apply` (later statuses still mean it was sent). */
function isSubmitted(r: ApplicationRow): boolean {
  return r.status !== "to apply";
}

export function computeProgress(
  rows: ApplicationRow[],
  today: string, // YYYY-MM-DD
  week: WeekRange,
  _plan?: null,
): Progress {
  const sent = rows.filter(isSubmitted);
  const inWeek = (d: string) => d >= week.from && d <= week.to;

  // Per-day counts over all dates, any lane (the streak and calendar look back past this week).
  const byDay: Record<string, number> = {};
  let todayTech = 0;
  let todayBridge = 0;
  let weekTech = 0;
  let weekBridge = 0;
  const activeDays = new Set<string>();

  for (const r of sent) {
    byDay[r.date] = (byDay[r.date] ?? 0) + 1;
    if (r.date === today) {
      if (r.lane === "tech") todayTech++;
      else if (r.lane === "bridge") todayBridge++;
    }
    if (inWeek(r.date)) {
      if (r.lane === "tech") weekTech++;
      else if (r.lane === "bridge") weekBridge++;
      if (isWeekday(r.date)) activeDays.add(r.date);
    }
  }

  const appliedToday = (byDay[today] ?? 0) > 0;
  // Start at today if it already has an application, otherwise at yesterday, so the streak
  // doesn't read 0 in the morning before the first application.
  const days = streakEndingAt(byDay, appliedToday ? today : addDays(today, -1));
  const best = Math.max(days, bestStreak(byDay));

  // Pace: weekdays from the week start through today (clamped to the week) × daily target.
  let expected = 0;
  const end = today < week.to ? today : week.to;
  for (let d = week.from; d <= end; d = addDays(d, 1)) {
    if (isWeekday(d)) expected += DAY_TARGET;
  }

  // Newest first; rows are prepended to the table, so a lower lineIndex is newer within a date.
  const last5 = [...rows]
    .sort((a, b) =>
      a.date === b.date ? a.lineIndex - b.lineIndex : a.date < b.date ? 1 : -1,
    )
    .slice(0, 5);

  return {
    today: {
      date: today,
      tech: todayTech,
      bridge: todayBridge,
      target: DAY_TARGET,
    },
    week: {
      from: week.from,
      to: week.to,
      tech: weekTech,
      bridge: weekBridge,
      target: WEEK_TARGET,
      expectedByToday: Math.min(expected, WEEK_TARGET),
    },
    streak: {
      days,
      best,
      appliedToday,
      activeDaysThisWeek: activeDays.size,
    },
    byDay,
    queued: rows.filter((r) => r.status === "to apply").length,
    last5,
    allTime: sent.length,
    rejected: sent.filter((row) => isRejectedStatus(row.status)).length,
    averages: computeAverages(byDay, today),
    plan: null,
  };
}

/** Mon–Sun week containing `date`: the week all weekly counts use. */
export function mondayToSunday(date: string): WeekRange {
  const dow = dayOfWeek(date);
  const fromMonday = dow === 0 ? 6 : dow - 1;
  const from = addDays(date, -fromMonday);
  return { from, to: addDays(from, 6) };
}
