// Quick Add clears the composer the moment it is pressed so the workspace owner can keep pasting. Until the server
// confirms it owns the batch, the submitted cards are kept here, so a failed request, a refresh in
// the middle of sending, or a closed tab can never lose them. Entries are removed once the server
// lists the batch; any entry the server does not know is restored to the editor on the next load.
import { lsGet, lsSet } from "./useApplyHistory";
import type { QuickDraft } from "./useQuickDrafts";

const INFLIGHT_KEY = "career-ui.quick.inflight";

export interface InflightBatch {
  batchId: string;
  at: number;
  drafts: QuickDraft[];
}

/** Batches whose POST is still pending in this document; recovery must not touch them. */
export const postsInFlight = new Set<string>();

export function readInflight(): InflightBatch[] {
  const saved = lsGet<InflightBatch[]>(INFLIGHT_KEY);
  return Array.isArray(saved)
    ? saved.filter(
        (entry) =>
          entry &&
          typeof entry.batchId === "string" &&
          Array.isArray(entry.drafts),
      )
    : [];
}

export function addInflight(batchId: string, drafts: QuickDraft[]) {
  lsSet(INFLIGHT_KEY, [
    ...readInflight().filter((entry) => entry.batchId !== batchId),
    { batchId, at: Date.now(), drafts },
  ]);
}

export function dropInflight(batchId: string) {
  const rest = readInflight().filter((entry) => entry.batchId !== batchId);
  lsSet(INFLIGHT_KEY, rest.length ? rest : null);
}
