// Posting age: deterministic parse of the posting-date text, resolved against the review date. Pure.
// Age is shown to the workspace owner; it never feeds Candidate Fit.
import { AGE_BANDS } from "./constants";
import { postContains } from "./verify";
import type { AgeBand, PostingAge } from "../types";

const DAY_MS = 86_400_000;
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

function minusDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Parse a posting-date phrase into a date relative to `today`. Handles "today", "just posted",
 * "N hours ago", "yesterday", "N days/weeks/months ago", "30+ days ago", ISO dates,
 * "Oct 3, 2026" / "3 October 2026", and "10/03/2026" (US order). Returns null if nothing parses.
 */
export function parsePostedText(text: string, today: string): string | null {
  const t = text.toLowerCase();
  if (
    /\b(today|just (now|posted)|\d+\s*(minute|min|hour|hr)s?\s+ago)\b/.test(t)
  )
    return today;
  if (/\byesterday\b/.test(t)) return minusDays(today, 1);
  const rel = /(\d+)\s*\+?\s*(day|week|month)s?\s+ago/.exec(t);
  if (rel) {
    const n = Number(rel[1]);
    // "30+ days ago" means more than 30: push it one day further so it lands in Stale.
    const plus = /\d+\s*\+/.test(rel[0]) ? 1 : 0;
    const mult = rel[2] === "day" ? 1 : rel[2] === "week" ? 7 : 30;
    return minusDays(today, n * mult + plus);
  }
  const isoM = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (isoM && validIso(isoM[0])) return isoM[0];
  // "Oct 3, 2026" or "October 3 2026"
  const mdy =
    /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(t);
  if (mdy && MONTHS.includes(mdy[1].slice(0, 3))) {
    const d = iso(
      Number(mdy[3]),
      MONTHS.indexOf(mdy[1].slice(0, 3)) + 1,
      Number(mdy[2]),
    );
    if (validIso(d)) return d;
  }
  // "3 October 2026"
  const dmy = /\b(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/.exec(t);
  if (dmy && MONTHS.includes(dmy[2].slice(0, 3))) {
    const d = iso(
      Number(dmy[3]),
      MONTHS.indexOf(dmy[2].slice(0, 3)) + 1,
      Number(dmy[1]),
    );
    if (validIso(d)) return d;
  }
  const us = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t);
  if (us) {
    const d = iso(Number(us[3]), Number(us[1]), Number(us[2]));
    if (validIso(d)) return d;
  }
  return null;
}

export function ageBand(days: number | null): AgeBand {
  if (days === null || days < 0) return "unknown";
  if (days <= AGE_BANDS.fresh) return "fresh";
  if (days <= AGE_BANDS.recent) return "recent";
  if (days <= AGE_BANDS.older) return "older";
  return "stale";
}

export const AGE_LABEL: Record<AgeBand, string> = {
  fresh: "Fresh",
  recent: "Recent",
  older: "Older",
  stale: "Stale",
  unknown: "Unknown",
};

/**
 * Posting age from Claude's extraction. The quoted text must be in the post; it is parsed here, and
 * Claude's own normalized date is only a fallback when the verified quote itself doesn't parse.
 * `override` (YYYY-MM-DD, typed by the workspace owner) wins over both.
 */
export function postingAge(
  postedText: string,
  postedDate: string,
  jobPost: string,
  today: string,
  override?: string | null,
): PostingAge {
  const reposted = /re-?posted/i.test(postedText);
  const result = (date: string | null, source: PostingAge["source"]) => {
    const days = date ? daysBetween(date, today) : null;
    // A date in the future is unreliable.
    const ok = days !== null && days >= 0;
    return {
      date: ok ? date : null,
      days: ok ? days : null,
      band: ageBand(ok ? days : null),
      source: ok ? source : null,
      quote: postedText,
      reposted,
    };
  };
  if (override && validIso(override)) return result(override, "override");
  if (!postedText || !postContains(postedText, jobPost))
    return result(null, null);
  const parsed = parsePostedText(postedText, today);
  if (parsed) return result(parsed, "post");
  return result(validIso(postedDate) ? postedDate : null, "post");
}

/** "2 days ago — Fresh" */
export function ageLine(a: PostingAge): string {
  if (a.days === null) return "Unknown";
  const when =
    a.days === 0 ? "today" : a.days === 1 ? "1 day ago" : `${a.days} days ago`;
  return `${when} — ${AGE_LABEL[a.band]}${a.reposted ? " (reposted)" : ""}`;
}
