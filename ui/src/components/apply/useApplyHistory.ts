"use client";
import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  DuplicateReport,
  QuickRecord,
  QuickBatchResult,
  ScoreResult,
} from "@/lib/types";
import type { Workflow } from "./useWorkflow";
type RunPayload =
  | {
      kind: "review";
      result: ScoreResult;
      decision: string;
      jobPost: string;
    }
  | { kind: "quick"; record: QuickRecord };

// localStorage can throw (private mode, blocked storage): every access is wrapped.
export function lsGet<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
}
export function lsSet(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const OPEN_KEY = "career-ui.apply.open";

/**
 * Apply opens clean (Quick add, nothing shown) except after a browser refresh of /apply itself, when
 * the item that was on screen comes back. Read once per document: a later client-side visit to
 * /apply (from the nav) starts clean even if this document was loaded by a refresh.
 */
let restoreAfterRefresh = (() => {
  if (typeof window === "undefined") return false;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    return nav?.type === "reload" && new URL(nav.name).pathname === "/apply";
  } catch {
    return false;
  }
})();

type Setter<T> = Dispatch<SetStateAction<T>>;
interface Context {
  workflow: Workflow;
  setDupStop: Setter<DuplicateReport | null>;
  setQuickSummary: Setter<QuickBatchResult | null>;
  setError: Setter<string | null>;
  setResult: Setter<ScoreResult | null>;
  setQuickView: Setter<{ record: QuickRecord; status: string | null } | null>;
  setOpenStatus: Setter<string | null>;
  setJobPost: Setter<string>;
  setLink: Setter<string>;
}
export function useApplyHistory({
  workflow,
  setDupStop,
  setQuickSummary,
  setError,
  setResult,
  setQuickView,
  setOpenStatus,
  setJobPost,
  setLink,
}: Context) {
  const opening = useRef<number | null>(null);
  /** Show a saved item; resolves to its kind (null when it wasn't shown). */
  const openItem = useCallback(
    async (
      id: string,
      status: string | null = null,
      canOpen?: () => boolean,
    ): Promise<"review" | "quick" | null> => {
      const token = workflow.begin("history", id);
      opening.current = token;
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!workflow.current(token) || (canOpen && !canOpen())) return null;
        if (!res.ok) {
          lsSet(OPEN_KEY, null);
          return null;
        }
        const p = (await res.json()) as RunPayload;
        if (!workflow.current(token) || (canOpen && !canOpen())) return null;
        setDupStop(null);
        setQuickSummary(null);
        setError(null);
        if (p.kind === "quick") {
          setResult(null);
          setQuickView({ record: p.record, status });
        } else {
          setQuickView(null);
          setResult(p.result);
          setOpenStatus(
            status ?? (p.decision === "undecided" ? null : p.decision),
          );
        }
        lsSet(OPEN_KEY, id);
        return p.kind;
      } finally {
        if (opening.current === token) opening.current = null;
      }
    },
    [workflow],
  );

  return {
    openItem,
    isOpening: () =>
      opening.current !== null && workflow.current(opening.current),
  };
}

/**
 * On load: reattach to a running tailor job (reopening its review), or after a refresh reopen
 * the item that was on screen. `onRestored` gets the kind shown so
 * the page can switch to its tab. Never replaces a newer action.
 */
export function useApplyRestoration({
  openItem,
  workflow,
  onRestored,
}: {
  openItem: (id: string) => Promise<"review" | "quick" | null>;
  workflow: Workflow;
  onRestored: (kind: "review" | "quick") => void;
}) {
  const TAILOR_KEY = "career-ui.apply.tailor";
  useEffect(() => {
    let live = true;
    const token = workflow.generation();
    (async () => {
      const t = lsGet<{ jobId: string; runId: string; slug: string }>(
        TAILOR_KEY,
      );
      let tailorRunning = false;
      if (t && live) {
        const r = await fetch(`/api/jobs/${t.jobId}`, { cache: "no-store" });
        const j = r.ok ? ((await r.json()) as { done: boolean }) : null;
        tailorRunning = !!j && !j.done;
        if (!tailorRunning) lsSet(TAILOR_KEY, null);
      }
      if (!live || !workflow.current(token)) return;
      const open = tailorRunning ? t!.runId : lsGet<string>(OPEN_KEY);
      if (!tailorRunning && !restoreAfterRefresh) {
        lsSet(OPEN_KEY, null);
        return;
      }
      restoreAfterRefresh = false;
      const kind = open ? await openItem(open) : null;
      if (!live || !kind) return;
      onRestored(kind);
    })();
    return () => {
      live = false;
    };
  }, [openItem]);
}
