// Types shared by the Workshop Dev server code and its UI (ported from Project Explorer).

export type RunStatus =
  "starting" | "running" | "stopping" | "exited" | "failed";

export type RunKind = "service" | "setup";

export interface RunInfo {
  id: string;
  projectId: string;
  worktree: string;
  name: string;
  kind: RunKind;
  command: string;
  cwd: string;
  port: number | null;
  url: string | null;
  status: RunStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface LogLine {
  stream: "out" | "err" | "sys";
  text: string;
}

export interface ServiceDef {
  name: string;
  /** Directory relative to the worktree root. */
  cwd?: string;
  /** Shell command; `{port}` and `{ports.<service>}` are filled in at launch. */
  command: string;
  /** Ports are allocated from `defaultPort + 1` upwards. Omit for services the hub can't re-port. */
  defaultPort?: number;
  env?: Record<string, string>;
  /** Show an "Open" link for this service (http://localhost:{port} unless `url` is set). */
  open?: boolean;
  url?: string;
}

export interface SetupStep {
  name: string;
  cwd?: string;
  command: string;
  /** Path (relative to the worktree) this step produces; its absence means the step is needed. */
  creates?: string;
}

export interface GitInfo {
  /** null when HEAD is detached. */
  branch: string | null;
  head: string | null;
  subject: string | null;
  committedAt: number | null;
  dirty: number;
  ahead: number | null;
  behind: number | null;
}

export interface BranchInfo {
  /** Short name: `main`, or `origin/main` for a remote branch. */
  name: string;
  remote: boolean;
  head: string;
  subject: string;
  committedAt: number;
  upstream: string | null;
  /** Worktree that has this branch checked out (local branches only). */
  checkedOutIn: string | null;
  /** Uncommitted changes in that worktree; null when it isn't checked out. */
  dirty: number | null;
  /**
   * Any branch against the default branch; the default branch itself against its upstream.
   * null when there is nothing to compare with.
   */
  compare: BranchCompare | null;
  /** Synchronization with the configured upstream, independent of default-branch divergence. */
  upstreamCompare: BranchCompare | null;
  /** Divergence from the repository default branch; null for the default itself. */
  defaultCompare: BranchCompare | null;
}

export interface BranchCompare {
  against: string;
  ahead: number;
  behind: number;
}

export interface BranchList {
  /** null when HEAD is detached. */
  current: string | null;
  head: string | null;
  /** `main`/`master` or whatever origin/HEAD points at; null when none of those exist. */
  defaultBranch: string | null;
  /** While HEAD is detached: the branch it was detached from, to go back to. */
  previousBranch: string | null;
  branches: BranchInfo[];
}

export interface CommitInfo {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  committedAt: number;
  subject: string;
}

export interface GraphData {
  commits: CommitInfo[];
  branches: BranchInfo[];
  head: string | null;
}

export interface WorktreeRef {
  path: string;
  isMain: boolean;
  /** null when HEAD is detached. */
  branch: string | null;
}

export type AttentionKind =
  "uncommitted" | "unpushed" | "unpublished" | "behind";

export interface AttentionItem {
  kind: AttentionKind;
  /** null when HEAD is detached. */
  branch: string | null;
  /** The checkout to open; null for a branch that isn't checked out anywhere. */
  worktree: string | null;
  isMain: boolean;
  /** Files for `uncommitted`, commits for the rest. */
  count: number;
  /** Upstream the commits are counted against; null for `uncommitted` and `unpublished`. */
  against: string | null;
}

export interface WorktreeInfo extends WorktreeRef {
  git: GitInfo;
  /** Setup steps whose `creates` path is missing. */
  missing: string[];
  /** `creates` paths that exist, i.e. what Uninstall would delete. */
  installed: string[];
  runs: RunInfo[];
}

/** What the card hover shows; also the header facts of the Dev tab. */
export interface DevSummary {
  /** The folder resolved to a git repo. When false, `problem` says why. */
  available: boolean;
  problem: string | null;
  path: string | null;
  /** The linked folder is the Career UI itself: it is shown but cannot be run. */
  isThisApp: boolean;
  branch: string | null;
  worktrees: number;
  localBranches: number;
  remoteBranches: number;
  /** Uncommitted files across every checkout. */
  uncommitted: number;
  attention: AttentionItem[];
  /** The default branch against its upstream, e.g. main is 2 behind origin/main. */
  defaultBranch: {
    name: string;
    ahead: number;
    behind: number;
    against: string;
  } | null;
  needsInstall: boolean;
  running: { name: string; url: string | null }[];
  totalCommits: number;
}

export interface DevDetail extends DevSummary {
  checkouts: WorktreeInfo[];
  /** Services the selected checkout can run (detected or configured). */
  services: ServiceDef[];
  setup: SetupStep[];
  canRun: boolean;
  canOpenInEditor: boolean;
  hasRemote: boolean;
}

/** One changed path in a checkout. `status` is git's two-letter porcelain code. */
export interface ChangedFile {
  path: string;
  status: string;
}

/** Uncommitted changes in a checkout: the file list and one unified diff of all of them. */
export interface ChangesResult {
  files: ChangedFile[];
  diff: string;
  /** The diff was cut at the size cap; the file list is always complete. */
  truncated: boolean;
}
