// Saved job reviews: every finished review (and every quick add) is kept in
// records/reviews/<slug>.json (canonical record) + <slug>.md (rendered from the JSON).
// ui/.cache/runs/ only holds the working copy; these are tracked in git like applications.md.
import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "./fileStore";
import { CAREER_ROOT, resolveInside } from "./paths";
import { AGE_LABEL, ageLine } from "./scoring/age";
import { FIT_BAND_LABEL } from "./scoring/fit";
import { MATCH_BAND_LABEL } from "./scoring/match";
import { upgradeScoreResult } from "./scoring/review";
import { isValidSlug, makeSlug } from "./slug";
import { findDuplicates, normalizeCompany } from "./duplicates";
import { statusColumn } from "./status";
import type { RunRecord } from "./runs";
import type {
  ApplicationExtras,
  ApplicationRow,
  HistoryItem,
  QuickRecord,
  ReviewDecision,
  ReviewRequirement,
  SavedReviewSummary,
  ScoreResult,
} from "./types";

export const REVIEWS_DIR = "records/reviews";

function reviewsDir(): string {
  const p = resolveInside(CAREER_ROOT, REVIEWS_DIR);
  if (!p) throw new Error("reviews dir resolves outside CAREER_ROOT");
  return p;
}

/** "acme-swe" → "acme-swe-2" → "acme-swe-3" (≤ 60 chars). */
function bump(slug: string): string {
  const m = /^(.*)-(\d+)$/.exec(slug);
  const base = m ? m[1] : slug;
  const suffix = `-${m ? Number(m[2]) + 1 : 2}`;
  return base.slice(0, 60 - suffix.length).replace(/-+$/, "") + suffix;
}

type AnyRecord = RunRecord | QuickRecord;

function isQuick(r: AnyRecord): r is QuickRecord {
  return (r as QuickRecord).kind === "quick";
}

function readAny(file: string): AnyRecord | null {
  try {
    const rec = JSON.parse(fs.readFileSync(file, "utf8")) as AnyRecord;
    if (rec?.version !== 2) return null;
    if (isQuick(rec)) return rec.extract && rec.id ? rec : null;
    if (!rec.result) return null;
    upgradeScoreResult(rec.result);
    return rec;
  } catch {
    return null;
  }
}

/** The id a record is opened by: runId for reviews, the quick id for quick adds. */
export function recordId(rec: AnyRecord): string {
  return isQuick(rec) ? rec.id : rec.result.runId;
}

/** First free slug from `base` (-2, -3, …), unless a record with the same id already owns it. */
function freeSlug(base: string, id: string, dir: string): string {
  let slug = base;
  for (let i = 0; i < 200; i++) {
    const file = path.join(dir, `${slug}.json`);
    const existing = readAny(file);
    // Selection is also used to display cache-only save failures in History.
    if (!existing && fs.existsSync(file)) return slug;
    if (existing && recordId(existing) === id) return slug;
    // Orphaned Markdown may be the only recoverable copy of a prior record.
    if (!existing && !fs.existsSync(path.join(dir, `${slug}.md`))) return slug;
    slug = bump(slug);
  }
  throw new Error("could not find a free review slug");
}

/** Preserve identity across retries even if a former filename collision disappears. */
function existingSlug(id: string, dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  // The real reviews directory has hundreds of files; the cached index avoids parsing them all on
  // every save. It lists exactly the readable records this scan would find.
  if (dir === reviewsDir()) return listReviews().find((r) => r.id === id)?.slug;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const existing = readAny(path.join(dir, name));
    if (existing && recordId(existing) === id) return name.slice(0, -5);
  }
}

/**
 * Pick the file slug: the run's suggested slug, unless a *different* run already owns it (then -2,
 * -3, …). Re-saving the same run reuses its slug, so a later decision updates the same files.
 */
export function reviewSlug(rec: RunRecord, dir = reviewsDir()): string {
  const r = rec.result;
  const owned = existingSlug(r.runId, dir);
  if (owned) return owned;
  const base = isValidSlug(r.suggestedSlug)
    ? r.suggestedSlug
    : makeSlug(r.company, r.role);
  return freeSlug(base, r.runId, dir);
}

function writeBoth(dir: string, slug: string, json: unknown, md: string) {
  const file = path.join(dir, `${slug}.json`);
  if (fs.existsSync(file) && !readAny(file))
    throw new Error(
      `Unreadable saved review: ${slug}.json; recover it before saving`,
    );
  fs.mkdirSync(dir, { recursive: true });
  atomicWrite(
    path.join(dir, `${slug}.json`),
    JSON.stringify(json, null, 2) + "\n",
  );
  atomicWrite(path.join(dir, `${slug}.md`), md);
  listCache = null;
}

/**
 * Write a review's two files atomically; returns the repo-relative paths. Every finished review is
 * saved automatically; saving again (e.g. with the workspace owner's decision) rewrites the same files. `savedAt`
 * keeps the review's original time so the history order never jumps.
 */
export function saveReview(
  rec: RunRecord,
  decision?: ReviewDecision,
): { slug: string; jsonPath: string; mdPath: string } {
  const dir = reviewsDir();
  const slug = reviewSlug(rec, dir);
  const out: RunRecord = {
    ...rec,
    decision: decision ?? rec.decision ?? "undecided",
    savedAt: rec.savedAt || new Date().toISOString(),
  };
  writeBoth(dir, slug, out, renderReviewMarkdown(out));
  return {
    slug,
    jsonPath: `${REVIEWS_DIR}/${slug}.json`,
    mdPath: `${REVIEWS_DIR}/${slug}.md`,
  };
}

/** Write a quick add's two files (the extracted fields + the full pasted description). */
export function saveQuick(q: QuickRecord): {
  slug: string;
  jsonPath: string;
  mdPath: string;
} {
  const dir = reviewsDir();
  const base =
    q.slug && isValidSlug(q.slug)
      ? q.slug
      : makeSlug(q.extract.company, q.extract.role);
  const slug = existingSlug(q.id, dir) ?? freeSlug(base, q.id, dir);
  const out: QuickRecord = { ...q, slug };
  writeBoth(dir, slug, out, renderQuickMarkdown(out));
  return {
    slug,
    jsonPath: `${REVIEWS_DIR}/${slug}.json`,
    mdPath: `${REVIEWS_DIR}/${slug}.md`,
  };
}

// Parsed summaries cached by the directory's mtime (adding or replacing a file changes it).
let listCache: { sig: string; items: SavedReviewSummary[] } | null = null;

/** Drop the cached summaries (after files are deleted outside writeBoth). */
export function forgetReviewCache(): void {
  listCache = null;
}

/** Every saved review and quick add (newest first); unreadable files are skipped. */
export function listReviews(): SavedReviewSummary[] {
  let dir: string;
  try {
    dir = reviewsDir();
  } catch {
    return [];
  }
  if (!fs.existsSync(dir)) return [];
  const sig = `${dir}:${fs.statSync(dir).mtimeMs}`;
  if (listCache?.sig === sig) return listCache.items;
  const out: SavedReviewSummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const rec = readAny(path.join(dir, f));
    if (!rec) continue;
    const slug = f.slice(0, -5);
    const paths = {
      slug,
      jsonPath: `${REVIEWS_DIR}/${slug}.json`,
      mdPath: `${REVIEWS_DIR}/${slug}.md`,
    };
    if (isQuick(rec))
      out.push({
        kind: "quick",
        id: rec.id,
        ...paths,
        company: rec.extract.company,
        role: rec.extract.role,
        link: rec.request.link ?? "",
        jobId: rec.extract.jobId,
        reviewedAt: rec.reviewedAt,
        savedAt: rec.savedAt,
        decision: rec.decision,
        fit: null,
        match: null,
      });
    else
      out.push({
        kind: "review",
        sourceRecordId: rec.request.sourceRecordId,
        viewedAt: rec.viewedAt,
        id: rec.result.runId,
        ...paths,
        company: rec.result.company,
        role: rec.result.role,
        link: rec.result.link || rec.request.link || "",
        jobId: rec.result.jobId,
        reviewedAt: rec.result.reviewedAt,
        savedAt: rec.savedAt,
        decision: rec.decision ?? "undecided",
        fit: rec.result.fit.total,
        match: rec.result.match.total,
      });
  }
  const items = out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  listCache = { sig, items };
  return items;
}

/** The saved record with this runId / quick id, if any. */
export function findSaved(
  id: string,
): { summary: SavedReviewSummary; record: AnyRecord } | null {
  const summary = listReviews().find((r) => r.id === id);
  if (!summary) return null;
  const record = readAny(path.join(CAREER_ROOT, summary.jsonPath));
  return record ? { summary, record } : null;
}

const DECISION_STATUS: Record<ReviewDecision, string> = {
  applied: "applied",
  later: "to apply",
  skip: "skipped",
  undecided: "not decided",
};

/**
 * History status: the matching application row's *current* status when there is one (exact URL /
 * job id, or same company + identical role for link-less posts), so tracker changes show up here;
 * otherwise the review's own decision.
 */
export function historyStatus(
  r: SavedReviewSummary,
  rows: ApplicationRow[],
): string {
  const linked = rows.find(
    (row) => row.recordId === (r.sourceRecordId ?? r.id),
  );
  if (linked) return statusColumn(linked.status).column;
  const exact = findDuplicates(
    { link: r.link || undefined, jobId: r.jobId, company: r.company },
    rows,
  ).exact;
  const sameRole = rows.filter(
    (row) =>
      !r.link &&
      normalizeCompany(row.company) === normalizeCompany(r.company) &&
      row.role.trim().toLowerCase() === r.role.trim().toLowerCase(),
  );
  // Newest matching row wins (rows are newest first).
  const key = exact[0]?.key ?? sameRole[0]?.key;
  const row = key ? rows.find((x) => x.key === key) : undefined;
  return row ? statusColumn(row.status).column : DECISION_STATUS[r.decision];
}

// History is polled by several screens but only changes when a review file or the tracker does.
// listReviews() hands back the same array until the directory changes and readApplications() the same
// rows until the file changes, so identity of both is a complete cache key.
let historyMemo: {
  reviews: SavedReviewSummary[];
  rows: ApplicationRow[];
  items: HistoryItem[];
} | null = null;

/** History sidebar items: every saved record with its derived status. */
export function historyItems(rows: ApplicationRow[]): HistoryItem[] {
  const reviews = listReviews();
  // Callers add and sort items, so hand out a copy of the cached array.
  if (historyMemo?.reviews === reviews && historyMemo.rows === rows)
    return [...historyMemo.items];
  // The tracker row is where the workspace owner corrects a name (Edit, or fixing a Quick Add), so it wins.
  const items = reviews.map((r) => {
    const row = rows.find((x) => x.recordId === r.id);
    return {
      ...r,
      ...(row ? { company: row.company, role: row.role } : {}),
      status: historyStatus(r, rows),
    };
  });
  historyMemo = { reviews, rows, items };
  return [...items];
}

// ───────── Markdown rendering (deterministic: same JSON → same text) ─────────

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

function reqLine(r: ReviewRequirement): string {
  const ev =
    r.careerQuote && r.career !== "none"
      ? ` — career.md: “${r.careerQuote}”${r.careerVerified ? "" : " (quote not matched to source)"}`
      : "";
  const on = r.resumeQuote ? ` — resume: “${r.resumeQuote}”` : "";
  return `- **${r.text}** (${r.kind}, ${r.effectiveCredit}${r.fix ? `, fix: ${r.fix}` : ""})${ev}${on}`;
}

/** Compact summary lines used by the saved review and the CLI. */
export function summaryLines(r: ScoreResult): string[] {
  const lines = [
    `Posting: ${ageLine(r.age)}`,
    `Candidate Fit: ${r.fit.total}/100 — ${FIT_BAND_LABEL[r.fit.band]}`,
    `Resume Match: ${r.match.total === null ? "n/a" : `${r.match.total}/100 — ${MATCH_BAND_LABEL[r.match.band!]}`} (${r.resume} master)`,
    `Verdict: ${r.fit.band === "stretch" ? "Possible fit" : r.verdict.text}`,
    `Resume Recommendation: ${r.recommendation.text}`,
  ];
  if (r.estimate)
    lines.push(
      `Estimated after tailoring: ${r.estimate.low}–${r.estimate.high}/100`,
      `Potential improvement: +${r.estimate.gainLow}–${r.estimate.gainHigh}`,
    );
  return lines;
}

/** Saved answers and cover letter, as plain markdown sections (none when there are no extras). */
export function extrasMarkdown(
  extras: ApplicationExtras | undefined,
): string[] {
  if (!extras?.questions?.length && !extras?.coverLetter) return [];
  const out = ["## Application extras", ""];
  for (const set of extras.questions ?? []) {
    out.push(`### Questions (${set.at.slice(0, 10)})`, "");
    if (set.note) out.push(`Note: ${set.note}`, "");
    if (set.result.company.whatTheyDo)
      out.push(`What they do: ${set.result.company.whatTheyDo}`, "");
    for (const a of set.result.answers) {
      out.push(`**${a.question}**`, "");
      a.options.forEach((o, i) => out.push(`${i + 1}. ${o}`));
      if (a.needsUser) out.push("", `Needs you: ${a.needsUser}`);
      out.push("");
    }
  }
  if (extras.coverLetter)
    out.push(
      `### Cover letter (${extras.coverLetter.at.slice(0, 10)}, ${extras.coverLetter.resume} resume)`,
      "",
      ...(extras.coverLetter.note
        ? [`Note: ${extras.coverLetter.note}`, ""]
        : []),
      extras.coverLetter.result.letter.trim(),
      "",
    );
  return out;
}

export function renderReviewMarkdown(rec: RunRecord): string {
  // Normalize a display copy; legacy canonical review fields must remain unchanged.
  const r = upgradeScoreResult(structuredClone(rec.result));
  const b = (n: 1 | 2 | 3) => r.requirements.filter((q) => q.bucket === n);
  const out: string[] = [
    `# Review: ${r.company} — ${r.role}`,
    "",
    "Saved by `/apply` (generated from the `.json` next to this file; edit that, not this).",
    "",
    `- **Company:** ${r.company}`,
    `- **Role:** ${r.role}`,
    `- **Location:** ${r.location}${r.workMode !== "unknown" ? ` (${r.workMode})` : ""}`,
    `- **Source:** ${rec.request.source || "–"}`,
    `- **Link:** ${r.link || "–"}`,
    `- **Job ID:** ${r.jobId || "–"}`,
    `- **Posted:** ${r.age.date ?? "unknown"}${r.age.quote ? ` (“${r.age.quote}”)` : ""} · ${AGE_LABEL[r.age.band]}`,
    `- **Reviewed:** ${r.reviewedAt} · **Decision:** ${rec.decision ?? "undecided"}`,
    ...(rec.tailor
      ? [
          `- **Tailored resume:** tailored/${rec.tailor.slug} (actual Resume Match ${rec.tailor.actualMatch ?? "n/a"})`,
        ]
      : []),
    "",
    "## Summary",
    "",
    ...summaryLines(r).map((l) => `- ${l}`),
    "",
    `Why: ${r.recommendation.reason}`,
    "",
  ];
  if (r.why.length) out.push("**Why**", "", ...r.why.map((w) => `- ${w}`), "");
  if (r.recommendedChanges.length)
    out.push(
      "**Recommended changes**",
      "",
      ...r.recommendedChanges.map((c) => `- ${c.action}: ${c.text}`),
      "",
    );
  if (r.gaps.length)
    out.push(
      "**Work requirements needing stronger evidence**",
      "",
      "Limited or undocumented in career.md; missing evidence does not establish inability.",
      "",
      ...r.gaps.map((g) => `- ${g}`),
      "",
    );
  out.push(
    "## Fit and Match",
    "",
    ...(r.fit.summary ? [`- **Fit:** ${r.fit.summary}`] : []),
    ...(r.match.summary ? [`- **Match:** ${r.match.summary}`] : []),
    `- **Keywords on the resume:** ${r.match.termsFound.map(cell).join(", ") || "none"}`,
    "",
    r.match.termsMissing.length
      ? `Missing keywords: ${r.match.termsMissing.map(cell).join(", ")}`
      : "Missing keywords: none",
    "",
    ...(r.blockers.confirmed.length || r.blockers.check.length
      ? [
          "## Historical screening notes",
          "",
          ...r.blockers.confirmed.map(
            (x) => `- **${x.type}:** “${x.quote}” — ${x.why}`,
          ),
          ...r.blockers.check.map(
            (x) => `- check (${x.reason}): ${x.type} “${x.quote}”`,
          ),
          "",
        ]
      : []),
    "## Requirements and evidence",
    "",
    "### 1 · On the resume",
    "",
    ...(b(1).length ? b(1).map(reqLine) : ["- none"]),
    "",
    "### 2 · In career.md, missing or underrepresented on the resume",
    "",
    ...(b(2).length ? b(2).map(reqLine) : ["- none"]),
    "",
    "### 3 · Not demonstrated in career.md",
    "",
    ...(b(3).length ? b(3).map((q) => `- ${q.text} (${q.kind})`) : ["- none"]),
    "",
    ...extrasMarkdown(rec.extras),
    rec.request.postFormat === "brief"
      ? "## Job description summary"
      : "## Original job post",
    "",
    // A fence longer than any backtick run in the post, so the post can't close it.
    (() => {
      const longest = Math.max(
        2,
        ...(rec.request.jobPost.match(/`+/g) ?? []).map((m) => m.length),
      );
      const fence = "`".repeat(longest + 1);
      return `${fence}text\n${rec.request.jobPost.trim()}\n${fence}`;
    })(),
    "",
  );
  return out.join("\n");
}

/** Short markdown for a quick add: the extracted fields and its saved post or brief. */
export function renderQuickMarkdown(q: QuickRecord): string {
  const e = q.extract;
  const longest = Math.max(
    2,
    ...(q.request.jobPost.match(/`+/g) ?? []).map((m) => m.length),
  );
  const fence = "`".repeat(longest + 1);
  return [
    `# Quick add: ${e.company} — ${e.role}`,
    "",
    "Added to the tracker without a review (generated from the `.json` next to this file).",
    "",
    `- **Company:** ${e.company}`,
    `- **Role:** ${e.role}`,
    `- **Location:** ${e.location}${e.workMode !== "unknown" ? ` (${e.workMode})` : ""}`,
    `- **Level:** ${e.level || "–"}`,
    `- **Source:** ${q.request.source || "–"}`,
    `- **Link:** ${q.request.link || "–"}`,
    `- **Job ID:** ${e.jobId || "–"}`,
    `- **Posted:** ${q.age.date ?? "unknown"}${q.age.quote ? ` (“${q.age.quote}”)` : ""} · ${AGE_LABEL[q.age.band]}`,
    `- **Resume:** ${q.resume}`,
    `- **Added:** ${q.reviewedAt} · **Decision:** ${q.decision}`,
    "",
    ...extrasMarkdown(q.extras),
    q.postFormat === "brief"
      ? "## Job description summary"
      : "## Original job post",
    "",
    `${fence}text\n${q.request.jobPost.trim()}\n${fence}`,
    "",
  ].join("\n");
}
