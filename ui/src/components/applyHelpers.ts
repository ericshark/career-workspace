import { applicationDate } from "@/lib/config";
// Pure helpers for the Apply screen (no React, no node APIs) so they can be unit-tested.
import type {
  BuildResult,
  JobEvent,
  NewApplication,
  ResumeCategory,
  ScoreResult,
  TailorResult,
} from "@/lib/types";

// Moved to lib/sources.ts (with per-source colors); re-exported for existing imports.
import { sourceFromLink } from "@/lib/sources";
import { jobKeyFromUrl } from "@/lib/duplicates";
export { SOURCES } from "@/lib/sources";

import { localDate, laneForResume } from "@/lib/config";
export { RESUMES, MODELS, localDate, laneForResume } from "@/lib/config";
import { RESUMES } from "@/lib/config";

export type BandColor = "green" | "blue" | "orange" | "grey";

/** Candidate Fit color: Strong green · Reasonable blue · Possible fit orange · Weak grey (lib/scoring bands). */
export function fitColor(fit: number): BandColor {
  if (fit >= 80) return "green";
  if (fit >= 60) return "blue";
  if (fit >= 45) return "orange";
  return "grey";
}

/** Resume Match color: Strong green · Moderate blue · Weak orange. */
export function matchColor(match: number): BandColor {
  if (match >= 80) return "green";
  if (match >= 60) return "blue";
  return "orange";
}

export const BAND_CSS: Record<BandColor, string> = {
  green: "var(--success)",
  blue: "var(--primary)",
  orange: "var(--warning)",
  grey: "var(--muted-foreground)",
};

/** Historical light-tailor records lead to the same current Tailor action. */
export function tailorRecommended(
  r: Pick<ScoreResult, "recommendation">,
): boolean {
  return (
    r.recommendation.kind === "light-tailor" ||
    r.recommendation.kind === "tailor"
  );
}

/** The master a resume option is based on: itself for a master, the recorded base for tailored/<slug>. */
export function baseCategory(
  resume: string,
  bases: Record<string, ResumeCategory>,
): ResumeCategory {
  if ((RESUMES as readonly string[]).includes(resume))
    return resume as ResumeCategory;
  return bases[resume] ?? "tech";
}

/** A line this short (in words) is a fragment, e.g. a copied list item, and joins the line above. */
const FRAGMENT_MAX_WORDS = 4;

/**
 * Tidy pasted job text: CRLF → LF, whitespace runs inside a line collapsed, every blank line
 * dropped, and short fragment lines (up to four words) folded onto the line before with one space,
 * so words pasted one per line flow across the full width instead of each taking a row.
 */
export function compressPastedText(text: string): string {
  const lines: string[] = [];
  for (const line of text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)) {
    if (lines.length && line.split(" ").length <= FRAGMENT_MAX_WORDS)
      lines[lines.length - 1] += ` ${line}`;
    else lines.push(line);
  }
  return lines.join("\n");
}

/** The URL when a paste is just one link (scheme optional), else null; https:// is added if missing. */
export function pastedUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const url = new URL(withScheme);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname)
      ? withScheme
      : null;
  } catch {
    return null;
  }
}

const POSTING_PATH_RE = /job|career|position|opening|vacanc|apply|requisition/i;
const POSTING_HOST_RE =
  /(^|\.)(jobs|careers)\.|greenhouse\.io$|lever\.co$|ashbyhq\.com$|myworkdayjobs\.com$|workday\.com$|smartrecruiters\.com$|workable\.com$|icims\.com$|bamboohr\.com$/i;

export function looksLikePostingUrl(link: string): boolean {
  if (sourceFromLink(link) || jobKeyFromUrl(link)) return true;
  try {
    const u = new URL(link);
    return POSTING_PATH_RE.test(u.pathname) || POSTING_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

/** Pick a recognizable posting link while retaining all surrounding description text. */
export function splitJobPaste(raw: string): {
  link: string | null;
  text: string;
} {
  const lone = pastedUrl(raw);
  if (lone) return { link: lone, text: "" };
  const urls = [...raw.matchAll(/https?:\/\/[^\s<>"'()[\]]+/gi)].map((m) =>
    m[0].replace(/[),.;:!?]+$/, ""),
  );
  const link = urls.find(looksLikePostingUrl) ?? null;
  return { link, text: compressPastedText(link ? raw.replace(link, "") : raw) };
}

/** "m:ss" */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

import { tailorValidated } from "@/lib/tailorStatus";
export { tailorPassed, tailorValidated } from "@/lib/tailorStatus";

export interface ConfirmValues {
  company: string;
  role: string;
  lane: "tech" | "bridge";
  resume: string;
  fit: number | null;
  match: number | null;
  source: string;
  link: string;
  date: string; // YYYY-MM-DD: submit date (applied) or save date (later)
}

/**
 * Prefill for the confirm sheet. Match is the reviewed master's score; for a tailored resume it is the
 * Match recomputed on that resume (when known).
 */
export function confirmDefaults(
  r: ScoreResult,
  resume: string,
  source: string,
  link: string,
  tailoredMatch: number | null = null,
  today = new Date(),
): ConfirmValues {
  return {
    company: r.company,
    role: r.role,
    lane: laneForResume(resume, r.resume),
    resume,
    fit: r.fit.total,
    match: resume.startsWith("tailored/") ? tailoredMatch : r.match.total,
    source,
    link,
    date: applicationDate(today),
  };
}

const clampScore = (n: number | null) =>
  n === null || Number.isNaN(n)
    ? null
    : Math.max(0, Math.min(100, Math.round(n)));

/** Build the POST /api/applications body. Blank optional fields are omitted. */
export function buildNewApplication(
  fileHash: string,
  decision: "submitted" | "later",
  v: ConfirmValues,
): NewApplication {
  const link = v.link.trim();
  return {
    fileHash,
    decision,
    ...(v.date ? { date: v.date } : {}),
    row: {
      company: v.company.trim() || "Unknown",
      role: v.role.trim() || "Unknown",
      lane: v.lane,
      resume: v.resume,
      fit: clampScore(v.fit),
      match: clampScore(v.match),
      source: v.source,
      ...(link ? { link } : {}),
    },
  };
}

/** Slug typing helper: lowercase, spaces/underscores to hyphens, strip anything else, collapse hyphens, <=60. */
export function sanitizeSlugInput(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60);
}

/** Same rule as lib/slug.ts isValidSlug (duplicated: that module imports node:fs). */
export function isValidSlugClient(s: string): boolean {
  return s.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

/** Alternative slug for the "slug exists" choice (acme -> acme-2, acme-2 -> acme-3), kept <=60 chars. */
export function bumpSlug(slug: string): string {
  const m = /^(.*)-(\d+)$/.exec(slug);
  const base = m ? m[1] : slug;
  const n = m ? Number(m[2]) + 1 : 2;
  const suffix = `-${n}`;
  return base.slice(0, 60 - suffix.length).replace(/-+$/, "") + suffix;
}

// ───────────── tailor SSE reducer ─────────────

export interface TailorState {
  steps: { text: string; at: number }[];
  logs: string[];
  build: BuildResult | null;
  result: TailorResult | null;
  ok: boolean | null; // null while running
  error: { message: string; kind: string } | null;
}

export const initialTailorState: TailorState = {
  steps: [],
  logs: [],
  build: null,
  result: null,
  ok: null,
  error: null,
};

export function tailorReducer(s: TailorState, e: JobEvent): TailorState {
  switch (e.type) {
    case "step":
      return { ...s, steps: [...s.steps, { text: e.text, at: e.at }] };
    case "log":
      return { ...s, logs: [...s.logs, e.text].slice(-20) };
    case "build":
      return { ...s, build: e.result };
    case "done":
      return {
        ...s,
        result: e.result,
        build: e.result.build,
        ok: e.ok && tailorValidated(e.result),
      };
    case "error":
      return { ...s, ok: false, error: { message: e.message, kind: e.kind } };
  }
}

/** True once a terminal event (done/error) has been received. */
export function isFinished(s: TailorState): boolean {
  return s.ok !== null;
}

/** Pull the API error code/message out of a non-2xx response body. */
export async function readApiError(
  res: Response,
): Promise<{ code: string; message: string; details?: unknown }> {
  try {
    const j = await res.json();
    return {
      code: j?.error?.code ?? "INTERNAL",
      message: j?.error?.message ?? `HTTP ${res.status}`,
      details: j?.error?.details,
    };
  } catch {
    return { code: "INTERNAL", message: `HTTP ${res.status}` };
  }
}
