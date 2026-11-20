"use client";
import { useEffect, useRef, useState } from "react";
import { readApiError } from "../applyHelpers";
import { PROVIDER_LABELS, providerOf } from "@/lib/config";
import type { DuplicateReport, ModelId, ReviewJobStatus } from "@/lib/types";

export function useReviewJobs({
  onAccepted,
  onCompleted,
  jobPost,
  model,
  link,
  source,
  refreshHistory,
  setError,
  setDupStop,
}: {
  onAccepted: () => void;
  onCompleted: (runId: string) => void;
  jobPost: string;
  model: ModelId;
  link: string;
  source: string;
  refreshHistory: () => void;
  setError: (message: string | null) => void;
  setDupStop: (report: DuplicateReport | null) => void;
}) {
  const [jobs, setJobs] = useState<ReviewJobStatus[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const accepting = useRef(false);
  const latest = useRef({ refreshHistory, onCompleted });
  latest.current = { refreshHistory, onCompleted };
  const refreshQueue = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let live = true,
      polling = false;
    let previous = "";
    const watchingSince = Date.now();
    const seenCompleted = new Set<string>();
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch("/api/score/status", {
          cache: "no-store",
        });
        if (!response.ok || !live) return;
        const payload = await response.json();
        if (!live) return;
        const next: ReviewJobStatus[] = payload.jobs ?? [];
        setJobs(next);
        const signature = next.map((j) => `${j.runId}:${j.status}`).join("|");
        if (signature !== previous) latest.current.refreshHistory();
        previous = signature;
        // Jobs already done when this page opened stay in the queue for manual viewing.
        let firstId: string | undefined;
        let firstFinishedAt = Infinity;
        for (const job of next) {
          if (
            job.status !== "done" ||
            !job.runId ||
            seenCompleted.has(job.runId)
          )
            continue;
          seenCompleted.add(job.runId);
          if (job.finishedAt == null || job.finishedAt < watchingSince)
            continue;
          if (job.finishedAt < firstFinishedAt) {
            firstId = job.runId;
            firstFinishedAt = job.finishedAt;
          }
        }
        if (firstId) latest.current.onCompleted(firstId);
      } catch {
        /* Keep the last good queue during transient failures. */
      } finally {
        polling = false;
      }
    };
    refreshQueue.current = poll;
    void poll();
    window.addEventListener("review-viewed", poll);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("review-viewed", poll);
    };
  }, []);

  async function score(ignoreDuplicate = false) {
    if (accepting.current || jobPost.trim().length < 200) return;
    accepting.current = true;
    setSubmitting(true);
    setError(null);
    setDupStop(null);
    try {
      const response = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobPost,
          resume: "tech",
          model,
          source,
          ...(link.trim() ? { link: link.trim() } : {}),
          ...(ignoreDuplicate ? { ignoreDuplicate: true } : {}),
        }),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        throw new Error(
          error.code === "CLAUDE_UNAVAILABLE"
            ? `${PROVIDER_LABELS[providerOf(model)]} is unavailable: ${error.message} (check the health dot in the header)`
            : error.message,
        );
      }
      const payload = await response.json();
      if (payload.duplicate) {
        setDupStop(payload.duplicate);
        return;
      }
      // The callback belongs to this submitted snapshot, not the next draft.
      onAccepted();
      latest.current.refreshHistory();
      await refreshQueue.current();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Request failed");
    } finally {
      accepting.current = false;
      setSubmitting(false);
    }
  }

  async function control(runId: string, action: "cancel" | "resume") {
    const response = await fetch(`/api/score/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    if (!response.ok) throw new Error((await readApiError(response)).message);
    await refreshQueue.current();
  }
  return { jobs, submitting, score, control };
}
