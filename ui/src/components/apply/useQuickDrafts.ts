"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_QUICK } from "@/lib/config";
import { lsGet, lsSet } from "./useApplyHistory";

/** One job waiting in the Quick add list: an optional URL and its description. */
export interface QuickDraft {
  submissionId?: string;
  id: string;
  url: string;
  description: string;
}

// the workspace owner queues jobs for a while before one batch, so the list survives a reload.
const DRAFTS_KEY = "career-ui.quick.drafts";
export const MIN_QUICK = 25; // matches the quick-add API's per-job minimum

const newDraft = (): QuickDraft => ({
  submissionId: crypto.randomUUID(),
  id: Math.random().toString(36).slice(2, 10),
  url: "",
  description: "",
});

export const hasContent = (d: QuickDraft) =>
  d.url.trim().length > 0 || d.description.trim().length > 0;

/** "Job 2 · linkedin.com" or the description's first line, for pickers and messages. */
export function draftLabel(d: QuickDraft, number: number): string {
  let detail = "";
  try {
    if (d.url.trim())
      detail = new URL(
        /^https?:\/\//i.test(d.url.trim()) ? d.url.trim() : `https://${d.url}`,
      ).hostname.replace(/^www\./, "");
  } catch {
    /* not a URL; fall back to the description */
  }
  if (!detail)
    detail =
      d.description
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean)
        ?.slice(0, 50) ?? "";
  return detail ? `Job ${number} · ${detail}` : `Job ${number}`;
}

function loadDrafts(): QuickDraft[] {
  const saved = lsGet<QuickDraft[]>(DRAFTS_KEY);
  const valid = Array.isArray(saved)
    ? saved.filter(
        (d) =>
          d &&
          typeof d.id === "string" &&
          typeof d.url === "string" &&
          typeof d.description === "string",
      )
    : [];
  return valid.length
    ? valid.map((d) => ({
        ...d,
        submissionId: d.submissionId ?? crypto.randomUUID(),
      }))
    : [newDraft()];
}

/** The Quick add job list. There is always at least one (possibly empty) card. */
export function useQuickDrafts() {
  const [drafts, setDrafts] = useState<QuickDraft[]>(() => [newDraft()]);
  // Saving starts only once the stored list is in state, so the first render never overwrites it.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setDrafts(loadDrafts());
    setLoaded(true);
  }, []);
  // The raw text this tab last wrote, so its own writes are not mistaken for another tab's.
  const written = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const keep = drafts.some(hasContent) ? drafts : null;
    written.current = keep ? JSON.stringify(keep) : null;
    lsSet(DRAFTS_KEY, keep);
  }, [drafts, loaded]);
  // Another tab changed the list (typed, removed, or sent a batch): follow it instead of overwriting
  // it with this tab's older copy on the next keystroke.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DRAFTS_KEY || event.newValue === written.current)
        return;
      setDrafts(loadDrafts());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /** Adds an empty card and returns its id, or null when the list is already full. */
  const add = useCallback((): string | null => {
    if (drafts.length >= MAX_QUICK) return null;
    const d = newDraft();
    setDrafts((list) => (list.length >= MAX_QUICK ? list : [...list, d]));
    return d.id;
  }, [drafts.length]);
  const update = useCallback(
    (id: string, patch: Partial<Omit<QuickDraft, "id">>) =>
      setDrafts((list) =>
        list.map((d) =>
          d.id === id
            ? { ...d, ...patch, submissionId: crypto.randomUUID() }
            : d,
        ),
      ),
    [],
  );
  const removeIds = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setDrafts((list) => {
      const kept = list.filter((d) => !drop.has(d.id));
      return kept.length ? kept : [newDraft()];
    });
  }, []);
  /**
   * Put jobs back (after Undo) ahead of the current list, dropping empty cards. Nothing typed is
   * dropped, so this alone may exceed MAX_QUICK; the page then blocks Quick add until some are removed.
   */
  const restore = useCallback(
    (back: QuickDraft[], keepSubmissionIds = false) => {
      setDrafts((list) => {
        const ids = new Set(list.map((d) => d.id));
        const merged = [
          ...back
            .filter((d) => !ids.has(d.id))
            // After a failed send the server never saw these IDs, and a resend of unchanged cards is
            // deduplicated by them. After Undo the rows were removed, so fresh IDs avoid a conflict.
            .map((d) =>
              keepSubmissionIds
                ? d
                : { ...d, submissionId: crypto.randomUUID() },
            ),
          ...list.filter(hasContent),
        ];
        return merged.length ? merged : [newDraft()];
      });
    },
    [],
  );

  return { drafts, add, update, removeIds, restore };
}
