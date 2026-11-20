// What a log hook needs to offer Undo: the toast message, the server's undo id (several for a batch
// quick add), and what to put back on screen afterwards (the reopened review, the pasted post, or
// the Quick add cards that were logged).
import type { QuickDraft } from "./useQuickDrafts";

export interface UndoRestore {
  runId?: string;
  jobPost?: string;
  quickDrafts?: QuickDraft[];
  batchId?: string;
  link?: string;
  source?: string;
}
export type OfferUndo = (
  message: string,
  undoId: string | string[],
  restore: UndoRestore,
) => void;
