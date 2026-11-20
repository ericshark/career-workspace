// Month-grid math for the Today calendar. Pure, UTC-only on YYYY-MM-DD strings (like progress.ts),
// so the local timezone and DST can never shift a day.

export interface MonthCell {
  date: string; // YYYY-MM-DD
  day: number; // 1..31
  weekend: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10" for a YYYY-MM-DD date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Shift a YYYY-MM month by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * Sunday-first grid for a month: leading nulls for the days before the 1st, then one cell per
 * day, then trailing nulls to complete the last week row.
 */
export function monthGrid(month: string): (MonthCell | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (MonthCell | null)[] = Array(first).fill(null);
  for (let day = 1; day <= days; day++) {
    const dow = (first + day - 1) % 7;
    cells.push({
      date: `${month}-${pad(day)}`,
      day,
      weekend: dow === 0 || dow === 6,
    });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Green intensity bucket for a day's application count: 0 none, 1 one, 2 for 2–4, 3 for 5+. */
export function heatLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count < 5) return 2;
  return 3;
}

/** "October 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Tracker formats these dates for every displayed row.
const longDateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const shortDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Tuesday, October 6" for a YYYY-MM-DD date. */
export function longDate(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(parsed) ? "Invalid Date" : longDateFormat.format(parsed);
}

/** "today", "yesterday", "3d ago", "2w ago", or "Oct 6" for older dates. */
export function relativeDay(date: string, today: string): string {
  const diff = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
      86_400_000,
  );
  if (Number.isNaN(diff)) return date;
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff > 1 && diff < 14) return `${diff}d ago`;
  if (diff >= 14 && diff < 60) return `${Math.floor(diff / 7)}w ago`;
  return shortDateFormat.format(Date.parse(`${date}T00:00:00Z`));
}
