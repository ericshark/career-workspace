// Durable, bounded review queue. Recovery is deliberately paused until the workspace owner resumes a job.
import fs from "node:fs";
import { loadRun } from "./runs";
import path from "node:path";
import { CAREER_ROOT } from "./paths";
import type { ReviewJobStatus, ScoreRequest } from "./types";
export interface ReviewJob {
  runId: string;
  sourceRecordId?: string;
  company?: string;
  role?: string;
  status:
    | "queued"
    | "paused"
    | "interrupted"
    | "running"
    | "done"
    | "error"
    | "cancelled";
  step: string | null;
  startedAt: number;
  finishedAt: number | null;
  preview: string;
  error?: string;
  abort: AbortController;
  request?: ScoreRequest;
  queuedAt: number;
}
type Runner = (
  signal: AbortSignal,
  onStep: (s: string) => void,
) => Promise<void>;
const file = () => path.join(CAREER_ROOT, "ui/.cache/review-queue.json");
const g = globalThis as unknown as {
  __careerReviewQueue?: { jobs: ReviewJob[]; runners: Map<string, Runner> };
};
const state: { jobs: ReviewJob[]; runners: Map<string, Runner> } =
  (g.__careerReviewQueue ??= { jobs: [], runners: new Map() });
if (!state.jobs.length) {
  try {
    state.jobs = JSON.parse(fs.readFileSync(file(), "utf8")).map(
      (j: ReviewJob) => ({
        ...j,
        status:
          j.status === "running"
            ? "interrupted"
            : j.status === "queued"
              ? "paused"
              : j.status,
        abort: new AbortController(),
      }),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(state.jobs.map(({ abort, ...j }) => j)),
    { mode: 0o600 },
  );
  fs.renameSync(tmp, file());
}
export function currentReview(): ReviewJob | null {
  return (
    state.jobs.find((j) => j.status === "running") ?? state.jobs.at(-1) ?? null
  );
}
export function reviewRunning(): boolean {
  return state.jobs.some((j) => j.status === "running");
}
function pump() {
  for (const job of state.jobs) {
    if (state.jobs.filter((j) => j.status === "running").length >= 2) break;
    if (job.status !== "queued") continue;
    const run = state.runners.get(job.runId);
    if (!run) continue;
    job.status = "running";
    job.startedAt = Date.now();
    if (job.request) job.request.queueWaitMs = job.startedAt - job.queuedAt;
    save();
    const timeoutMs = timeouts.get(job.runId) ?? 120_000;
    const timer = setTimeout(
      () => job.abort.abort(new Error("timeout")),
      timeoutMs,
    );
    (async () => {
      await run(job.abort.signal, (s: string) => {
        job.step = s;
      });
    })()
      .then(() => {
        job.status = job.abort.signal.aborted ? "cancelled" : "done";
      })
      .catch((e: unknown) => {
        const timedOut = job.abort.signal.reason?.message === "timeout";
        job.status =
          job.abort.signal.aborted && !timedOut ? "cancelled" : "error";
        job.error = timedOut
          ? "Review took longer than 2 minutes"
          : e instanceof Error
            ? e.message
            : String(e);
      })
      .finally(() => {
        clearTimeout(timer);
        job.finishedAt = Date.now();
        job.step = null;
        if (job.status === "done") {
          job.preview = "";
          job.request = undefined;
        }
        state.runners.delete(job.runId);
        timeouts.delete(job.runId);
        save();
        pump();
      });
  }
}
const timeouts = new Map<string, number>();
export function startReview(
  runId: string,
  jobPost: string,
  run: Runner,
  timeoutMs = 120_000,
  request?: ScoreRequest,
): ReviewJob {
  const job: ReviewJob = {
    runId,
    sourceRecordId: request?.sourceRecordId,
    company: request?.trackerCompany,
    role: request?.trackerRole,
    status: "queued",
    step: "Waiting",
    startedAt: Date.now(),
    queuedAt: Date.now(),
    finishedAt: null,
    preview: jobPost.replace(/\s+/g, " ").trim().slice(0, 80),
    abort: new AbortController(),
    request,
  };
  state.jobs.push(job);
  state.runners.set(runId, run);
  timeouts.set(runId, timeoutMs);
  save();
  pump();
  return job;
}
export function cancelReview(runId?: string): boolean {
  const j = runId ? state.jobs.find((j) => j.runId === runId) : currentReview();
  if (!j || !["running", "queued", "paused", "interrupted"].includes(j.status))
    return false;
  j.abort.abort();
  if (j.status !== "running") {
    j.status = "cancelled";
    j.finishedAt = Date.now();
    state.runners.delete(j.runId);
    save();
    pump();
  }
  return true;
}
export async function resumeReview(runId: string): Promise<boolean> {
  const j = state.jobs.find((j) => j.runId === runId);
  if (
    !j?.request ||
    !["paused", "interrupted", "error", "cancelled"].includes(j.status)
  )
    return false;
  const { executeReview } = await import("./executeReview");
  j.status = "queued";
  j.error = undefined;
  j.finishedAt = null;
  j.abort = new AbortController();
  state.runners.set(runId, (signal, step) =>
    executeReview(j.request!, runId, signal, step),
  );
  save();
  pump();
  return true;
}
function status(j: ReviewJob, now: number): ReviewJobStatus {
  return {
    viewedAt: j.status === "done" ? loadRun(j.runId)?.viewedAt : undefined,
    sourceRecordId: j.sourceRecordId,
    company: j.company,
    role: j.role,
    running: j.status === "running",
    runId: j.runId,
    status: j.status,
    step: j.step,
    elapsedMs: (j.finishedAt ?? now) - j.startedAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    preview: j.preview,
    error: j.error,
  };
}
export function reviewStatuses(now = Date.now()) {
  return state.jobs
    .filter((j) => j.status !== "done" || loadRun(j.runId)?.viewedAt === null)
    .map((j) => status(j, now));
}
export function reviewStatus(now = Date.now()): ReviewJobStatus {
  const j = currentReview();
  return j
    ? status(j, now)
    : {
        running: false,
        runId: null,
        status: "idle",
        step: null,
        elapsedMs: 0,
        startedAt: null,
        preview: "",
      };
}
export function _resetReviewState(): void {
  for (const j of state.jobs) j.abort.abort();
  state.jobs = [];
  state.runners.clear();
}

export function pendingReview(request: ScoreRequest): boolean {
  return state.jobs.some(
    (j) =>
      ["queued", "running", "paused", "interrupted"].includes(j.status) &&
      j.request &&
      ((!!request.sourceRecordId &&
        j.sourceRecordId === request.sourceRecordId) ||
        j.request.jobPost.trim() === request.jobPost.trim() ||
        (!!request.link && j.request.link === request.link)),
  );
}

export function setReviewIdentity(
  runId: string,
  company: string,
  role: string,
) {
  const job = state.jobs.find((j) => j.runId === runId);
  if (job) Object.assign(job, { company, role });
}

/** Discarded results must not leave a dead View review link in the queue. */
export function forgetCompletedReview(runId: string) {
  state.jobs = state.jobs.filter(
    (j) => j.runId !== runId || j.status !== "done",
  );
  save();
}
