"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { readApiError } from "../applyHelpers";
import { PROGRESS_CHANGED } from "../useFetchJson";
import type { Provider } from "@/lib/config";
import type { QuickBatchListItem } from "@/lib/quickState";
import type {
  DuplicateReport,
  QuickBatchResult,
  QuickRecord,
  ScoreResult,
} from "@/lib/types";
import type { Workflow } from "./useWorkflow";
import type { OfferUndo } from "./undo";
import { MIN_QUICK, type QuickDraft } from "./useQuickDrafts";
import {
  addInflight,
  dropInflight,
  postsInFlight,
  readInflight,
} from "./quickInflight";

interface Context {
  /** Drops the cards that were queued into the background batch. */
  removeDrafts: (ids: string[]) => void;
  /** Puts cards back in the editor with their original submission IDs (a resend is deduplicated). */
  restoreDrafts: (drafts: QuickDraft[]) => void;
  /** Manual source selected for the batch. */
  source: string;
  /** Claude (Haiku) or ChatGPT (Luna) reads the batch. */
  provider: Provider;
  setError: (s: string | null) => void;
  setResult: (r: ScoreResult | null) => void;
  setDupStop: (d: DuplicateReport | null) => void;
  refreshHistory: () => void;
  resetForm: () => void;
  setToast: (s: string | null) => void;
  offerUndo: OfferUndo;
  workflow: Workflow;
}

const jobs = (n: number) => `${n} job${n === 1 ? "" : "s"}`;

function areBatchesEqual(
  a: QuickBatchListItem[],
  b: QuickBatchListItem[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.batchId !== y.batchId ||
      x.status !== y.status ||
      x.startedAt !== y.startedAt ||
      x.finishedAt !== y.finishedAt ||
      x.viewedAt !== y.viewedAt ||
      x.dismissedFromTop !== y.dismissedFromTop ||
      x.undone !== y.undone ||
      x.added.length !== y.added.length ||
      x.skipped.length !== y.skipped.length ||
      x.remaining.length !== y.remaining.length ||
      x.error !== y.error
    ) {
      return false;
    }
  }
  return true;
}

export function useQuickAdd({
  removeDrafts,
  restoreDrafts,
  source,
  provider,
  setError,
  setResult,
  setDupStop,
  refreshHistory,
  setToast,
  offerUndo,
}: Context) {
  const [quickBatches, setQuickBatches] = useState<QuickBatchListItem[]>([]);
  const [quickSummary, setQuickSummary] = useState<QuickBatchResult | null>(
    null,
  );
  const [quickView, setQuickView] = useState<{
    record: QuickRecord;
    status: string | null;
  } | null>(null);
  const prevRunningRef = useRef(false);
  const refreshHistoryRef = useRef(refreshHistory);
  refreshHistoryRef.current = refreshHistory;

  /** Refreshes batch state; resolves with the batch IDs the server knows, or null if it could not be read. */
  const loadBatches = useCallback(async (): Promise<string[] | null> => {
    try {
      const r = await fetch("/api/quick/status", { cache: "no-store" });
      if (!r.ok) return null;
      const payload = (await r.json()) as {
        runningCount: number;
        batches: QuickBatchListItem[];
      };
      setQuickBatches((prev) =>
        areBatchesEqual(prev, payload.batches ?? [])
          ? prev
          : (payload.batches ?? []),
      );
      const isRunning = payload.runningCount > 0;
      if (prevRunningRef.current && !isRunning) {
        window.dispatchEvent(new Event(PROGRESS_CHANGED));
        refreshHistoryRef.current();
      }
      prevRunningRef.current = isRunning;
      return (payload.batches ?? []).map((b) => b.batchId);
    } catch {
      // Ignore transient poll errors.
      return null;
    }
  }, []);

  // Cards that were sent but never reached the server (request failed, or the page was refreshed or
  // closed mid-send) come back to the editor; batches the server owns are just forgotten here.
  const restoreDraftsRef = useRef(restoreDrafts);
  restoreDraftsRef.current = restoreDrafts;
  const setToastRef = useRef(setToast);
  setToastRef.current = setToast;
  useEffect(() => {
    void (async () => {
      const known = await loadBatches();
      if (!known) return;
      let restored = 0;
      for (const entry of readInflight()) {
        if (postsInFlight.has(entry.batchId)) continue;
        if (!known.includes(entry.batchId)) {
          restoreDraftsRef.current(entry.drafts);
          restored += entry.drafts.length;
        }
        dropInflight(entry.batchId);
      }
      if (restored)
        setToastRef.current(
          `Quick Add didn't start. ${jobs(restored)} ${restored === 1 ? "is" : "are"} back in the editor.`,
        );
    })();
  }, [loadBatches]);

  const hasActiveBatch = quickBatches.some(
    (b) => b.status === "running" || b.status === "queued",
  );

  useEffect(() => {
    if (!hasActiveBatch) return;
    const t = setInterval(() => {
      void loadBatches();
    }, 600);
    return () => clearInterval(t);
  }, [hasActiveBatch, loadBatches]);

  const controlBatch = useCallback(async (body: Record<string, unknown>) => {
    try {
      const r = await fetch("/api/quick/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) return;
      const payload = (await r.json()) as {
        runningCount: number;
        batches: QuickBatchListItem[];
      };
      setQuickBatches((prev) =>
        areBatchesEqual(prev, payload.batches ?? [])
          ? prev
          : (payload.batches ?? []),
      );
    } catch {
      // Ignore control error.
    }
  }, []);

  const cancelBatch = useCallback(
    (batchId: string) => void controlBatch({ action: "cancel", batchId }),
    [controlBatch],
  );
  const retryBatch = useCallback(
    (batchId: string) => void controlBatch({ action: "retry", batchId }),
    [controlBatch],
  );
  const markBatchesViewed = useCallback(
    (batchIds?: string[]) =>
      void controlBatch({ action: "mark-viewed", batchIds }),
    [controlBatch],
  );
  const markBatchUndone = useCallback(
    (batchId: string) => void controlBatch({ action: "mark-undone", batchId }),
    [controlBatch],
  );
  const dismissBatchTop = useCallback(
    (batchId?: string) =>
      void controlBatch({
        action: "dismiss-top",
        ...(batchId ? { batchId } : {}),
      }),
    [controlBatch],
  );

  /**
   * Non-blocking background Quick Add:
   * Immediately clears the submitted cards from the editor and launches the batch on the server
   * FIFO queue so the user can keep adding jobs right away.
   */
  const quickAdd = useCallback(
    async (sent: QuickDraft[]): Promise<QuickBatchResult | null> => {
      if (
        !sent.length ||
        sent.some((d) => d.description.trim().length < MIN_QUICK)
      )
        return null;
      const batchId = crypto.randomUUID();
      const jobPayload = sent.map((d) => ({
        submissionId: d.submissionId ?? d.id,
        description: d.description,
        ...(d.url.trim() ? { link: d.url.trim() } : {}),
      }));

      // Keep the cards until the server confirms the batch, then reset the composer so the user can
      // continue pasting.
      addInflight(batchId, sent);
      postsInFlight.add(batchId);
      removeDrafts(sent.map((d) => d.id));
      setError(null);
      setResult(null);
      setQuickView(null);
      setDupStop(null);
      setQuickSummary(null);

      // Optimistically show the running batch at the top and dismiss any prior done bar.
      const optimistic: QuickBatchListItem = {
        batchId,
        createdAt: Date.now(),
        startedAt: Date.now(),
        finishedAt: null,
        status: "running",
        provider,
        source: source || "Other",
        jobLinks: jobPayload.flatMap((job) => (job.link ? [job.link] : [])),
        totalCount: sent.length,
        added: [],
        skipped: [],
        remaining: sent.map((_, i) => i + 1),
        viewedAt: null,
      };
      prevRunningRef.current = true;
      setQuickBatches((prev) => [
        optimistic,
        ...prev.map((b) =>
          b.status === "done" ? { ...b, dismissedFromTop: true } : b,
        ),
      ]);

      // Stays false when a failure leaves it unclear whether the server queued the batch, so the saved
      // copy of the cards is kept for recovery on the next load.
      let settled = true;
      try {
        const res = await fetch("/api/quick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId,
            jobs: jobPayload,
            source: source || "Other",
            provider,
          }),
        });
        const known = await loadBatches();
        if (!res.ok) {
          const apiErr = await readApiError(res);
          // A rejected request (validation, server error before queueing) leaves no batch behind: the
          // jobs go back to the editor. If the server did queue the batch, the status bar owns it.
          if (known && !known.includes(batchId)) {
            restoreDrafts(sent);
            setToast(
              `Quick Add failed: ${apiErr.message}. Your jobs are back in the editor.`,
            );
          } else {
            if (!known) settled = false;
            setToast(`Quick Add failed: ${apiErr.message}`);
          }
          return null;
        }
        const summary = (await res.json()) as QuickBatchResult;
        const addedNumbers = new Set(summary.added.map((a) => a.job));
        const restore = {
          batchId,
          quickDrafts: sent.filter((_, i) => addedNumbers.has(i + 1)),
        };
        if (summary.added.length) {
          window.dispatchEvent(new Event(PROGRESS_CHANGED));
          refreshHistory();
        }
        const n = summary.added.length;
        const message = n
          ? `Added ${jobs(n)} as applied${summary.skipped.length ? ` · ${summary.skipped.length} skipped` : ""}.`
          : summary.error
            ? "Quick add incomplete. Retry to finish."
            : "Nothing added.";
        if (n)
          offerUndo(
            message,
            summary.added.map((a) => a.undoId),
            restore,
          );
        else setToast(message);
        return summary;
      } catch (e) {
        const known = await loadBatches();
        const message = e instanceof Error ? e.message : "Request failed";
        if (known && !known.includes(batchId)) {
          restoreDrafts(sent);
          setToast(`${message}. Your jobs are back in the editor.`);
        } else {
          if (!known) settled = false;
          setToast(message);
        }
        return null;
      } finally {
        postsInFlight.delete(batchId);
        if (settled) dropInflight(batchId);
      }
    },
    [
      source,
      provider,
      removeDrafts,
      restoreDrafts,
      setError,
      setResult,
      setDupStop,
      loadBatches,
      refreshHistory,
      offerUndo,
      setToast,
    ],
  );

  return {
    quickBatches,
    quickSummary,
    setQuickSummary,
    quickBusy: false,
    quickView,
    setQuickView,
    quickAdd,
    cancelBatch,
    retryBatch,
    markBatchesViewed,
    markBatchUndone,
    dismissBatchTop,
  };
}
