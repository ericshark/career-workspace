import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { localToday } from "./api";
import { AgentError } from "./claude/agent";
import { withModelDeadline } from "./claude/deadline";
import { localDate, type Provider } from "./config";
import { atomicWrite } from "./fileStore";
import { CAREER_ROOT } from "./paths";
import {
  extractQuickBatch,
  fixtureQuickBatch,
  quickAddBatch,
  recoverQuickBatch,
  type QuickBatchJob,
} from "./quick";
import type { QuickBatchResult } from "./types";
import { UNDO_TTL_MS, renewUndo, saveUndo } from "./undo";

export interface QuickBatchStatus {
  batchId: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  status: "queued" | "running" | "done" | "error" | "cancelled" | "interrupted";
  provider: Provider;
  source: string;
  jobs: QuickBatchJob[];
  totalCount: number;
  added: QuickBatchResult["added"];
  skipped: QuickBatchResult["skipped"];
  remaining: number[];
  error?: string;
  undoExpiresAt?: number;
  undone?: boolean;
  viewedAt: string | null;
  dismissedFromTop?: boolean;
}

/**
 * What status responses carry. The pasted job cards (hundreds of KB, polled every second) are left
 * out; Restore to editor and Undo read one batch in full with quickBatchDetail().
 */
export type QuickBatchListItem = Omit<QuickBatchStatus, "jobs"> & {
  /** Links only, so the editor can warn about postings already in an active batch. */
  jobLinks: string[];
};

// Jobs read per model call. A 50-job batch is 10 sequential calls at 5 (13 at 4).
const MAX_GROUP_JOBS = 5;
// Time allowed per job in one call, with a 2-minute floor.
const GROUP_DEADLINE_PER_JOB_MS = 30_000;
const MAX_GROUP_CHARS = 20_000;
const MAX_SAVED_BATCHES = 20;

export function* extractionGroups(jobs: QuickBatchJob[]) {
  let group: QuickBatchJob[] = [];
  let chars = 0;
  for (const job of jobs) {
    const size = job.description.length + (job.link?.length ?? 0);
    if (
      group.length &&
      (group.length === MAX_GROUP_JOBS || chars + size > MAX_GROUP_CHARS)
    ) {
      yield group;
      group = [];
      chars = 0;
    }
    group.push(job);
    chars += size;
  }
  if (group.length) yield group;
}

const statePath = () =>
  path.join(CAREER_ROOT, "ui", ".cache", "quick-queue.json");

interface ActiveBatch {
  controller: AbortController;
  promise: Promise<QuickBatchResult>;
  resolve: (result: QuickBatchResult) => void;
  reject: (err: unknown) => void;
}

const activeMap = new Map<string, ActiveBatch>();
let loadedRoot: string | null = null;
let batches: QuickBatchStatus[] = [];
let pumping = false;

function persistState() {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    atomicWrite(
      statePath(),
      JSON.stringify(batches.slice(0, MAX_SAVED_BATCHES)),
    );
  } catch {
    // Best-effort cache write; in-memory state remains authoritative for active runs.
  }
}

function ensureLoaded() {
  if (loadedRoot === CAREER_ROOT) return;
  loadedRoot = CAREER_ROOT;
  activeMap.clear();
  pumping = false;
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    if (Array.isArray(raw)) {
      batches = raw.map((b: QuickBatchStatus) => {
        if (b.status === "running" || b.status === "queued") {
          const addedNums = new Set((b.added ?? []).map((a) => a.job));
          const remaining = Array.from(
            { length: b.totalCount },
            (_, i) => i + 1,
          ).filter((n) => !addedNums.has(n));
          return {
            ...b,
            status: "interrupted",
            finishedAt: Date.now(),
            remaining,
            error:
              b.error ||
              "Quick Add was interrupted before all cards were saved.",
          };
        }
        return b;
      });
      persistState();
      return;
    }
  } catch {
    // Missing or unreadable cache starts empty.
  }
  batches = [];
}

function updateBatch(
  batchId: string,
  patch:
    | Partial<QuickBatchStatus>
    | ((current: QuickBatchStatus) => QuickBatchStatus),
) {
  ensureLoaded();
  batches = batches.map((b) =>
    b.batchId === batchId
      ? typeof patch === "function"
        ? patch(b)
        : { ...b, ...patch }
      : b,
  );
  persistState();
}

async function runSingleBatch(batchId: string) {
  ensureLoaded();
  const entry = batches.find((b) => b.batchId === batchId);
  const active = activeMap.get(batchId);
  if (!entry || !active) return;

  if (active.controller.signal.aborted) {
    const remaining = Array.from({ length: entry.totalCount }, (_, i) => i + 1);
    const cancelledResult: QuickBatchResult = {
      added: [],
      skipped: [],
      remaining,
      error: "Cancelled.",
    };
    updateBatch(batchId, {
      status: "cancelled",
      finishedAt: Date.now(),
      remaining,
      error: "Cancelled.",
    });
    active.resolve(cancelledResult);
    activeMap.delete(batchId);
    return;
  }

  updateBatch(batchId, {
    status: "running",
    startedAt: Date.now(),
    error: undefined,
  });

  const today = localToday();
  const calendarToday = localDate();
  const result: QuickBatchResult = { added: [], skipped: [], remaining: [] };
  const newUndoIds: string[] = [];
  let offset = 0;
  let initialThrow: unknown = null;

  for (const groupJobs of extractionGroups(entry.jobs)) {
    if (active.controller.signal.aborted) {
      result.error = "Cancelled.";
      break;
    }
    let extracted;
    try {
      extracted =
        recoverQuickBatch(groupJobs) ??
        (process.env.UI_FIXTURES === "1"
          ? fixtureQuickBatch(groupJobs)
          : await withModelDeadline(
              active.controller.signal,
              Math.max(120_000, groupJobs.length * GROUP_DEADLINE_PER_JOB_MS),
              (signal) => extractQuickBatch(groupJobs, signal, entry.provider),
            ));
    } catch (e) {
      const msg = active.controller.signal.aborted
        ? "Cancelled."
        : e instanceof Error
          ? e.message
          : String(e);
      result.error = msg;
      if (!(e instanceof AgentError) || offset === 0) {
        if (!active.controller.signal.aborted) initialThrow = e;
      }
      break;
    }

    const group = await quickAddBatch(
      extracted,
      {
        jobs: groupJobs,
        source: entry.source,
        provider: entry.provider,
      },
      today,
      (record) => {
        const id = saveUndo(record);
        newUndoIds.push(id);
        return id;
      },
      calendarToday,
    );
    result.added.push(
      ...group.added.map((item) => ({ ...item, job: item.job + offset })),
    );
    result.skipped.push(
      ...group.skipped.map((item) => ({
        ...item,
        job: item.job + offset,
      })),
    );
    result.remaining.push(...group.remaining.map((job) => job + offset));
    offset += groupJobs.length;

    const interimRemaining = [
      ...result.remaining,
      ...Array.from(
        { length: Math.max(0, entry.jobs.length - offset) },
        (_, i) => offset + i + 1,
      ),
    ];
    updateBatch(batchId, {
      added: [...result.added],
      skipped: [...result.skipped],
      remaining: interimRemaining,
    });

    if (group.error) {
      result.error = group.error;
      break;
    }
  }

  for (let job = offset + 1; job <= entry.jobs.length; job++) {
    if (!result.remaining.includes(job)) result.remaining.push(job);
  }
  renewUndo(newUndoIds);

  const now = Date.now();
  const isCancelled = active.controller.signal.aborted;
  const finalStatus: QuickBatchStatus["status"] = isCancelled
    ? "cancelled"
    : result.error || result.remaining.length > 0
      ? "error"
      : "done";

  updateBatch(batchId, {
    status: finalStatus,
    finishedAt: now,
    added: result.added,
    skipped: result.skipped,
    remaining: result.remaining,
    error: result.error,
    undoExpiresAt: result.added.length ? now + UNDO_TTL_MS : undefined,
    viewedAt: null,
  });

  activeMap.delete(batchId);
  if (initialThrow) {
    active.reject(initialThrow);
  } else {
    active.resolve(result);
  }
}

async function pumpQuickQueue() {
  if (pumping) return;
  pumping = true;
  try {
    while (true) {
      ensureLoaded();
      // Oldest queued batch first (strict FIFO).
      const next = [...batches]
        .reverse()
        .find((b) => b.status === "queued" && activeMap.has(b.batchId));
      if (!next) break;
      await runSingleBatch(next.batchId);
    }
  } finally {
    pumping = false;
  }
}

export function enqueueQuickBatch(input: {
  batchId?: string;
  jobs: QuickBatchJob[];
  source?: string;
  provider?: Provider;
}): { batchId: string; promise: Promise<QuickBatchResult> } {
  ensureLoaded();
  const batchId = input.batchId ?? randomUUID();
  const existingActive = activeMap.get(batchId);
  if (existingActive) {
    return { batchId, promise: existingActive.promise };
  }

  const controller = new AbortController();
  let resolve!: (result: QuickBatchResult) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<QuickBatchResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const item: QuickBatchStatus = {
    batchId,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    status: "queued",
    provider: input.provider ?? "claude",
    source: input.source?.trim() || "Other",
    jobs: input.jobs.map((j) => ({
      submissionId: j.submissionId ?? randomUUID(),
      ...(j.link ? { link: j.link } : {}),
      description: j.description,
    })),
    totalCount: input.jobs.length,
    added: [],
    skipped: [],
    remaining: input.jobs.map((_, i) => i + 1),
    viewedAt: null,
  };

  // Dismiss earlier completed/done top bars when a new batch is submitted.
  batches = [
    item,
    ...batches
      .filter((b) => b.batchId !== batchId)
      .map((b) => (b.status === "done" ? { ...b, dismissedFromTop: true } : b)),
  ].slice(0, MAX_SAVED_BATCHES);
  activeMap.set(batchId, { controller, promise, resolve, reject });
  persistState();
  void pumpQuickQueue();
  return { batchId, promise };
}

export function quickBatches(): {
  runningCount: number;
  batches: QuickBatchListItem[];
} {
  ensureLoaded();
  const runningCount = batches.filter(
    (b) => b.status === "running" || b.status === "queued",
  ).length;
  return {
    runningCount,
    batches: batches
      .slice(0, MAX_SAVED_BATCHES)
      .map(({ jobs, ...summary }) => ({
        ...summary,
        jobLinks: jobs.flatMap((job) => (job.link ? [job.link] : [])),
      })),
  };
}

/** One batch including its job text, for Restore to editor and Undo. */
export function quickBatchDetail(batchId: string): QuickBatchStatus | null {
  ensureLoaded();
  return batches.find((b) => b.batchId === batchId) ?? null;
}

export function cancelQuickBatch(batchId: string): boolean {
  ensureLoaded();
  const target = batches.find((b) => b.batchId === batchId);
  if (!target) return false;
  const active = activeMap.get(batchId);
  if (active) {
    active.controller.abort(new Error("Cancelled."));
    if (target.status === "queued") {
      updateBatch(batchId, {
        status: "cancelled",
        finishedAt: Date.now(),
        error: "Cancelled.",
      });
      active.resolve({
        added: target.added,
        skipped: target.skipped,
        remaining: target.remaining,
        error: "Cancelled.",
      });
      activeMap.delete(batchId);
    }
    return true;
  }
  return false;
}

export function retryQuickBatch(batchId: string): {
  batchId: string;
  promise: Promise<QuickBatchResult>;
} | null {
  ensureLoaded();
  const target = batches.find((b) => b.batchId === batchId);
  if (!target) return null;
  if (target.status === "running" || target.status === "queued") {
    const active = activeMap.get(batchId);
    if (active) return { batchId, promise: active.promise };
  }
  const controller = new AbortController();
  let resolve!: (result: QuickBatchResult) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<QuickBatchResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Handle unhandled rejection if retry is triggered fire-and-forget from control endpoint.
  promise.catch(() => {});

  updateBatch(batchId, {
    status: "queued",
    finishedAt: null,
    error: undefined,
    dismissedFromTop: false,
  });
  activeMap.set(batchId, { controller, promise, resolve, reject });
  void pumpQuickQueue();
  return { batchId, promise };
}

export function markQuickBatchesViewed(batchIds?: string[]) {
  ensureLoaded();
  const now = new Date().toISOString();
  const set = batchIds ? new Set(batchIds) : null;
  batches = batches.map((b) =>
    (!set || set.has(b.batchId)) && b.viewedAt === null
      ? { ...b, viewedAt: now }
      : b,
  );
  persistState();
}

export function markQuickBatchUndone(batchId: string) {
  updateBatch(batchId, {
    undone: true,
    undoExpiresAt: undefined,
  });
}

export function dismissQuickBatchTop(batchId?: string) {
  ensureLoaded();
  batches = batches.map((b) =>
    !batchId || b.batchId === batchId ? { ...b, dismissedFromTop: true } : b,
  );
  persistState();
}
