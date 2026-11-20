"use client";
import { applicationDate } from "@/lib/config";
import { useState } from "react";
import {
  buildNewApplication,
  confirmDefaults,
  localDate,
  readApiError,
  type ConfirmValues,
} from "../applyHelpers";
import { PROGRESS_CHANGED } from "../useFetchJson";
import type {
  ApplicationsPayload,
  DuplicateReport,
  Progress,
  ScoreResult,
  TailorResult,
  UpsertResult,
} from "@/lib/types";
import type { Workflow } from "./useWorkflow";
import type { OfferUndo } from "./undo";
interface Context {
  workflow: Workflow;
  result: ScoreResult | null;
  resume: string;
  source: string;
  link: string;
  tailored: TailorResult | null;
  refreshHistory: () => void;
  resetForm: () => void;
  setError: (message: string | null) => void;
  setToast: (message: string | null) => void;
  offerUndo: OfferUndo;
}
/**
 * Logging a reviewed job. Mark applied logs straight away (today, the selected resume, the review's
 * Fit and Match, the remembered source) and offers Undo; Skip deletes the review.
 */
export function useSubmissionConfirmation({
  result,
  resume,
  source,
  link,
  tailored,
  refreshHistory,
  resetForm,
  setError,
  setToast,
  offerUndo,
  workflow,
}: Context) {
  const [saving, setSaving] = useState(false);
  /** The saved-for-later row (exact URL / job-id match) this log would update, if any. */
  function pendingFrom(dups: DuplicateReport | null | undefined) {
    const hit = dups?.exact.find(
      (m) => m.kind === "application" && m.status === "to apply",
    );
    return hit ? { date: hit.date, key: hit.key! } : null;
  }

  /** Skip: delete the review (no row). It stays on screen if the delete fails, so Skip can be retried. */
  async function skip(): Promise<boolean> {
    const token = workflow.begin("submission");
    if (result) {
      const res = await fetch(
        `/api/reviews/${encodeURIComponent(result.runId)}`,
        { method: "DELETE" },
      ).catch((e: unknown) => e as Error);
      if (!workflow.current(token)) return false;
      if (res instanceof Error) {
        setError(`Couldn't skip: ${res.message}`);
        return false;
      }
      if (!res.ok) {
        setError(`Couldn't skip: ${(await readApiError(res)).message}`);
        return false;
      }
    }
    refreshHistory();
    resetForm();
    setToast("Skipped · review discarded");
    return true;
  }

  /** "Mark applied" straight from the duplicate stop: flip the saved-for-later row to applied today. */
  async function markPendingApplied(key: string) {
    const got = await fetch("/api/applications", { cache: "no-store" });
    if (!got.ok) return setError((await readApiError(got)).message);
    const payload = (await got.json()) as ApplicationsPayload;
    const res = await fetch("/api/applications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileHash: payload.fileHash,
        key,
        status: "applied",
        date: applicationDate(),
      }),
    });
    if (!res.ok) return setError((await readApiError(res)).message);
    window.dispatchEvent(new Event(PROGRESS_CHANGED));
    refreshHistory();
    resetForm();
    setToast("Marked applied.");
  }

  /** One POST attempt: fresh fileHash from GET /api/applications, then POST the row. */
  async function postRow(v: ConfirmValues, decision: "submitted" | "later") {
    const got = await fetch("/api/applications", { cache: "no-store" });
    if (!got.ok) return got;
    const payload = (await got.json()) as ApplicationsPayload;
    if (payload.readOnly)
      return new Response(
        JSON.stringify({
          error: { code: "LOCKED", message: payload.readOnly.reason },
        }),
        { status: 423 },
      );
    return fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // runId ties the row to its review, so the saved review records the decision.
      body: JSON.stringify({
        ...buildNewApplication(payload.fileHash, decision, v),
        ...(result ? { runId: result.runId } : {}),
      }),
    });
  }

  /** Mark applied: log the reviewed job as applied today, then clear the page with an Undo toast. */
  async function logApplied(decision: "submitted" | "later" = "submitted") {
    if (!result || saving) return;
    const v = confirmDefaults(
      result,
      resume,
      result.source ?? source,
      result.link,
      tailored?.actualMatch ?? null,
    );
    const token = workflow.begin("submission");
    setSaving(true);
    setError(null);
    try {
      let retryNote = "";
      let res = await postRow(v, decision);
      // 409: the file changed under us. Refetch the hash and retry once.
      if (res.status === 409) {
        res = await postRow(v, decision);
        if (res.ok)
          retryNote =
            " (applications.md changed outside the UI; retried with the latest version)";
      }
      // 423: lock held. Retry once after 500 ms (docs/03 safe writes).
      if (res.status === 423) {
        await new Promise((r) => setTimeout(r, 500));
        res = await postRow(v, decision);
      }
      if (!workflow.current(token)) return;
      if (!res.ok) {
        const err = await readApiError(res);
        setError(
          res.status === 409
            ? "applications.md changed again outside the UI. It wasn't logged; try again."
            : res.status === 423
              ? `Can't write applications.md right now: ${err.message}`
              : err.message,
        );
        return;
      }
      const upsert = (await res.json()) as UpsertResult;
      refreshHistory();
      // Refresh the header "N/25 today" counter (it lives in the layout and only refetches on focus).
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
      let count = "";
      try {
        const p = (await (
          await fetch("/api/progress", { cache: "no-store" })
        ).json()) as Progress;
        count = ` ${p.today.tech}/${p.today.target} today`;
      } catch {
        /* progress is a nicety */
      }
      if (!workflow.current(token)) return;
      // Kept so Undo can reopen this review after the page is cleared.
      const restore = { runId: result.runId, jobPost: "", link, source };
      resetForm();
      const message =
        decision === "later"
          ? "Saved · To apply"
          : `${upsert.action === "updated" ? "Applied · updated your saved-for-later row." : "Logged as applied."}${count}${retryNote}`;
      if (upsert.undoId) offerUndo(message, upsert.undoId, restore);
      else setToast(message);
    } catch (e) {
      if (workflow.current(token))
        setError(e instanceof Error ? e.message : "Couldn't log it");
    } finally {
      setSaving(false);
    }
  }

  return {
    saving,
    pendingFrom,
    skip,
    markPendingApplied,
    logApplied,
  };
}
