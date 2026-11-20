import type { BranchList, WorktreeInfo } from "@/lib/dev/types";

/** What the commits and graph dialogs need to know about the open checkout. */
export interface GitContext {
  itemId: string;
  projectName: string;
  worktree: WorktreeInfo;
  branches: BranchList;
  /** True while a checkout is in flight. */
  switching: boolean;
  /** Absent until the actions are available; the dialogs then only show history. */
  onCheckout?: (target: { branch: string } | { commit: string }) => void;
  onGoTo?: (worktreePath: string) => void;
}
