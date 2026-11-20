// Review runs. The working copy lives in ui/.cache/runs/<runId>.json (disposable, gitignored); every
// finished review is also saved to records/reviews/ (lib/reviews.ts), and loadRun falls back
// to that copy when the cache was cleared.
import fs from "node:fs";
import path from "node:path";
import { CAREER_ROOT } from "./paths";
import { atomicWrite } from "./fileStore";
import { findSaved, saveReview } from "./reviews";
import { upgradeScoreResult } from "./scoring/review";
import type {
  ApplicationExtras,
  ClaudeReviewOutput,
  ReviewDecision,
  ScoreRequest,
  ScoreResult,
  TailorResult,
  ClaudeTailorReport,
  ManualApproval,
  AgentMetrics,
  VerifiedTailorReport,
} from "./types";

export interface RunRecord {
  version: 2;
  /** Legacy records omit this field; new reviews explicitly start unopened. */
  viewedAt?: string | null;
  request: ScoreRequest; // new UI reviews carry the saved brief; legacy reviews carry the original post
  analysis: ClaudeReviewOutput; // Claude's raw classification (so the scores can be recomputed)
  result: ScoreResult;
  savedAt: string;
  decision?: ReviewDecision;
  /** Baseline captured before CLI tailoring; missing on legacy reviews. */
  masterHashes?: Record<string, string>;
  /** Set after a tailor run: the tailored resume and its recomputed Resume Match. */
  tailor?: {
    slug: string;
    actualMatch: number | null;
    at: string;
    result?: TailorResult;
    report?: ClaudeTailorReport | VerifiedTailorReport;
    candidateHash?: string;
    verification?: TailorResult["verification"];
    metrics?: AgentMetrics;
    masterTex?: string;
    manualApproval?: ManualApproval;
  };
  /** Answers to the application's questions and a cover letter, generated after the review. */
  extras?: ApplicationExtras;
}

const dir = () => path.join(CAREER_ROOT, "ui", ".cache", "runs");
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function saveRun(rec: RunRecord): void {
  fs.mkdirSync(dir(), { recursive: true });
  atomicWrite(
    path.join(dir(), `${rec.result.runId}.json`),
    JSON.stringify(rec, null, 2),
  );
}

/** Load a v2 run from the cache, else from its saved review; v1 runs are ignored. */
export function loadRun(runId: string): RunRecord | null {
  if (!ID_RE.test(runId)) return null;
  try {
    const rec = JSON.parse(
      fs.readFileSync(path.join(dir(), `${runId}.json`), "utf8"),
    ) as RunRecord;
    if (rec.version === 2 && rec.result) {
      upgradeScoreResult(rec.result);
      return rec;
    }
  } catch {
    /* not cached: try the saved review */
  }
  const saved = findSaved(runId);
  if (saved && saved.summary.kind === "review") {
    const rec = saved.record as RunRecord;
    saveRun(rec); // re-warm the cache so tailoring and later updates work as before
    return rec;
  }
  return null;
}

/** Read-modify-write one run (e.g. to attach the tailor outcome). No-op if the run is gone. */
export function updateRun(
  runId: string,
  change: (r: RunRecord) => void,
): RunRecord | null {
  const rec = loadRun(runId);
  if (!rec) return null;
  change(rec);
  saveRun(rec);
  return rec;
}

/**
 * Save a finished run twice: the working copy (ui/.cache/runs) and the permanent review
 * (records/reviews). A failed permanent write leaves an explicit warning on the recoverable cached result.
 */
export function persistRun(
  rec: RunRecord,
): ReturnType<typeof saveReview> | null {
  const started = Date.now();
  delete rec.result.meta.persistenceWarning;
  saveRun(rec);
  let saved: ReturnType<typeof saveReview> | null = null;
  try {
    saved = saveReview(rec);
    if (rec.result.meta.metrics) {
      const metrics = rec.result.meta.metrics;
      metrics.savingMs = Date.now() - started;
      metrics.totalMs = (metrics.totalMs ?? 0) + metrics.savingMs;
      saved = saveReview(rec);
    }
  } catch (error) {
    rec.result.meta.persistenceWarning =
      "This review could not be permanently saved. It is only in the working cache; retry saving before clearing that cache.";
    console.error("could not save review", error);
  }
  saveRun(rec);
  return saved;
}

/** Include cache-only results in History so navigation and restarts do not hide save failures. */
// Runs whose review failed to save. Reading every cached run (hundreds of KB) on each History poll
// is wasteful; writes go through atomicWrite (temp file + rename), which always bumps the directory's
// mtime, so the directory signature changes whenever any run is added, replaced or removed.
let unsavedCache: { sig: string; runs: RunRecord[] } | null = null;

export function unsavedRuns(): RunRecord[] {
  if (!fs.existsSync(dir())) return [];
  const sig = `${dir()}:${fs.statSync(dir()).mtimeMs}`;
  if (unsavedCache?.sig === sig) return unsavedCache.runs;
  const runs = fs
    .readdirSync(dir())
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const rec = loadRun(name.slice(0, -5));
      return rec?.result.meta.persistenceWarning ? [rec] : [];
    });
  unsavedCache = { sig, runs };
  return runs;
}

/** Record the workspace owner's decision on a run (both copies). Returns false if the run is unknown. */
export function recordDecision(
  runId: string,
  decision: ReviewDecision,
): boolean {
  const rec = updateRun(runId, (r) => {
    r.decision = decision;
  });
  if (!rec) return false;
  persistRun(rec);
  return true;
}

/** Mark an actual display, independently of decisions and generation metrics. */
export function markReviewViewed(runId: string): string | null {
  const rec = loadRun(runId);
  if (!rec) return null;
  if (rec.viewedAt) return rec.viewedAt;
  rec.viewedAt = new Date().toISOString();
  // Cache-only reviews remain recoverable without turning this into a save retry.
  if (!rec.result.meta.persistenceWarning) saveReview(rec);
  saveRun(rec);
  return rec.viewedAt;
}
