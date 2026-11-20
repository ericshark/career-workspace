"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  CheckIcon,
  CodeIcon,
  FileDiffIcon,
  GitCommitHorizontalIcon,
  GitForkIcon,
  HistoryIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  BranchInfo,
  BranchList,
  DevDetail,
  WorktreeInfo,
} from "@/lib/dev/types";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/workshop/model";

import {
  branchState,
  compareText,
  devGet,
  devPost,
  localNameOf,
  plural,
  timeAgo,
} from "./api";
import { CommitDialog } from "./CommitDialog";
import { CommitsDialog } from "./CommitsDialog";
import { DiffDialog } from "./DiffDialog";
import { RunSection } from "./RunSection";
import type { GitContext } from "./context";
import { GraphDialog } from "./GraphDialog";
import { forgetDevSummary } from "./summary";

/** Which dialog is open, and for which checkout. */
type Dialog = {
  kind: "commits" | "graph" | "commit" | "diff";
  path: string;
} | null;

/**
 * The Dev tab of a linked project: the current checkout and its state, history,
 * and every branch. Git is read from the project's own folder on the server.
 */
export function DevPanel({
  item,
  notify,
}: {
  item: Item;
  notify: (message: string) => void;
}) {
  const [worktree, setWorktree] = useState<string | null>(null);
  const [detail, setDetail] = useState<DevDetail | null>(null);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (path: string | null) => {
      try {
        const [nextDetail, nextBranches] = await Promise.all([
          devGet<DevDetail>(item.id, "detail", { worktree: path }),
          devGet<BranchList>(item.id, "branches", { worktree: path }),
        ]);
        setDetail(nextDetail);
        setBranches(nextBranches);
        setError("");
      } catch (failure) {
        setError((failure as Error).message);
      }
    },
    [item.id],
  );
  useEffect(() => {
    void load(worktree);
  }, [load, worktree]);
  // While something is starting, running or installing, keep its state current.
  const anyActive = Boolean(
    detail?.checkouts.some((entry) =>
      entry.runs.some(
        (run) =>
          run.status === "starting" ||
          run.status === "running" ||
          run.status === "stopping",
      ),
    ),
  );
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void load(worktree), 2000);
    return () => clearInterval(timer);
  }, [anyActive, load, worktree]);

  async function refresh() {
    forgetDevSummary(item.id);
    await load(worktree);
  }
  /** One git action on a checkout, then a fresh read of everything. */
  async function gitAction(
    path: string,
    label: string,
    action: string,
    body: object = {},
    done?: string,
  ) {
    setBusy(true);
    try {
      await devPost(item.id, action, { worktree: path, ...body });
      if (done) notify(done);
      await refresh();
    } catch (failure) {
      notify(`${label}: ${(failure as Error).message}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function openInEditor(path: string) {
    setBusy(true);
    try {
      await devPost(item.id, "open", { worktree: path });
    } catch (failure) {
      notify((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p className="flex items-start gap-2 text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
        <p className="text-muted-foreground">
          The folder is saved on the project as{" "}
          <span className="font-mono">{item.localFolder}</span>. Edit the
          project to change it.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  if (!detail || !branches)
    return <p className="text-sm text-muted-foreground">Reading folder…</p>;

  const current =
    detail.checkouts.find((entry) => entry.path === (worktree ?? "")) ??
    detail.checkouts[0];
  const dialogCheckout = dialog
    ? (detail.checkouts.find((entry) => entry.path === dialog.path) ?? current)
    : current;
  const gitContext: GitContext = {
    itemId: item.id,
    projectName: item.title,
    worktree: dialogCheckout,
    branches,
    switching: busy,
    onCheckout: (target) =>
      void gitAction(
        dialogCheckout.path,
        "Switch",
        "checkout",
        target,
        "Switched.",
      ),
    onGoTo: (path) => setWorktree(path),
  };
  const mainFirst = [...detail.checkouts].sort(
    (a, b) => Number(b.isMain) - Number(a.isMain),
  );

  return (
    <div className="space-y-4">
      <section
        aria-label="Repository overview"
        className="overflow-hidden rounded-xl border bg-card"
      >
        <h3 className="border-b px-4 py-2.5 text-base font-semibold">
          Overview
        </h3>
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {[
            ["Checkouts", detail.checkouts.length],
            ["Local branches", detail.localBranches],
            ["Remote branches", detail.remoteBranches],
            ["Total commits", detail.totalCommits],
          ].map(([label, value]) => (
            <div key={label} className="bg-card px-4 py-3">
              <dd className="text-2xl leading-none font-bold tabular-nums">
                {value}
              </dd>
              <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Checkouts" className="rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <h3 className="text-base font-semibold">Checkouts</h3>
          <CountPill count={detail.checkouts.length} />
        </div>
        <div className="space-y-3 p-3">
          {mainFirst.map((entry) => (
            <CheckoutCard
              key={entry.path}
              entry={entry}
              here={branches.branches.find(
                (branch) => !branch.remote && branch.name === entry.git.branch,
              )}
              remoteBranchExists={branches.branches.some(
                (candidate) =>
                  candidate.remote &&
                  localNameOf(candidate) === entry.git.branch,
              )}
              hasRemote={detail.hasRemote}
              canOpenInEditor={detail.canOpenInEditor}
              busy={busy}
              onOpenEditor={() => void openInEditor(entry.path)}
              onAction={(label, action, done) =>
                void gitAction(entry.path, label, action, {}, done)
              }
              onDialog={(kind) => setDialog({ kind, path: entry.path })}
            />
          ))}
        </div>
      </section>

      <RunSection
        key={current.path}
        itemId={item.id}
        detail={detail}
        worktree={current.path}
        onSelectWorktree={setWorktree}
        onChange={refresh}
        onError={notify}
      />

      <BranchesSection
        branches={branches}
        checkouts={detail.checkouts}
        hasRemote={detail.hasRemote}
        currentPath={current.path}
        dirty={current.git.dirty}
        busy={busy}
        onSwitch={(branch) =>
          void gitAction(
            current.path,
            "Switch",
            "checkout",
            { branch },
            "Switched.",
          )
        }
        onGoTo={setWorktree}
      />

      {dialog?.kind === "commits" && (
        <CommitsDialog context={gitContext} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "graph" && (
        <GraphDialog context={gitContext} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "diff" && (
        <DiffDialog
          itemId={item.id}
          worktree={dialogCheckout.path}
          branch={dialogCheckout.git.branch ?? "detached HEAD"}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "commit" && (
        <CommitDialog
          itemId={item.id}
          worktree={dialogCheckout.path}
          branch={dialogCheckout.git.branch ?? "detached HEAD"}
          files={dialogCheckout.git.dirty}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            notify("Committed.");
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** A bold count beside a section heading. */
function CountPill({ count }: { count: number }) {
  return (
    <span className="inline-grid h-6 min-w-6 place-items-center rounded-full bg-muted px-2 text-sm leading-none font-bold tabular-nums">
      {count}
    </span>
  );
}

/** The path as one button: pressing it copies it. */
function CopyablePath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`${path} (click to copy)`}
      aria-label={`Copy path ${path}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(path);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable (non-secure context); ignore */
        }
      }}
      className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 text-left font-mono text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="truncate">{path}</span>
      {copied && (
        <span className="flex shrink-0 items-center gap-0.5 font-sans text-success">
          <CheckIcon className="size-3" /> Copied
        </span>
      )}
    </button>
  );
}

/**
 * One checkout: its path, branch and latest commit, whether everything is
 * committed, and what needs pushing or pulling.
 */
function CheckoutCard({
  entry,
  here,
  remoteBranchExists,
  hasRemote,
  canOpenInEditor,
  busy,
  onOpenEditor,
  onAction,
  onDialog,
}: {
  entry: WorktreeInfo;
  here: BranchInfo | undefined;
  remoteBranchExists: boolean;
  hasRemote: boolean;
  canOpenInEditor: boolean;
  busy: boolean;
  onOpenEditor: () => void;
  onAction: (label: string, action: string, done?: string) => void;
  onDialog: (kind: "commits" | "graph" | "commit" | "diff") => void;
}) {
  const git = entry.git;
  const upstream = here?.upstream ?? null;
  const behind = upstream ? (git.behind ?? 0) : 0;
  const ahead = upstream ? (git.ahead ?? 0) : 0;
  const needsPublish = Boolean(git.branch) && !upstream;
  const pushable = needsPublish || ahead > 0;
  return (
    <article
      aria-label={`Checkout ${git.branch ?? "detached HEAD"}`}
      className="space-y-3 rounded-lg border p-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <CopyablePath path={entry.path} />
        {canOpenInEditor && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            className="ml-auto shrink-0 text-primary"
            onClick={onOpenEditor}
          >
            <CodeIcon /> VS Code
          </Button>
        )}
      </div>
      <div className="space-y-0.5 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-base font-semibold break-all">
            {git.branch ?? git.head ?? "Detached HEAD"}
          </span>
          {!git.branch && git.head && (
            <span className="text-xs font-medium text-warning">
              Detached HEAD
            </span>
          )}
        </p>
        <p className="flex min-w-0 items-baseline gap-2 text-muted-foreground">
          {git.head ? (
            <>
              <span className="min-w-0 truncate text-foreground/90">
                {git.subject}
              </span>
              <span className="shrink-0 text-xs">
                {timeAgo(git.committedAt)}
              </span>
            </>
          ) : (
            <span>No commits yet</span>
          )}
        </p>
      </div>

      <div
        aria-label="Checkout status"
        className="flex flex-wrap items-center gap-2"
      >
        {git.dirty === 0 ? (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <CheckIcon className="size-4" /> All changes committed
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-sm font-medium text-warning">
              <AlertTriangleIcon className="size-4" />
              {plural(git.dirty, "file")} not committed
            </span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onDialog("commit")}
            >
              <GitCommitHorizontalIcon /> Commit all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDialog("diff")}
            >
              <FileDiffIcon /> View changes
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {hasRemote && (
          <>
            <Button
              size="sm"
              variant={pushable ? "default" : "outline"}
              disabled={busy || !git.branch || !pushable}
              title={
                !git.branch
                  ? "Switch to a branch to push"
                  : needsPublish
                    ? `Push ${git.branch} to origin and track it`
                    : ahead === 0
                      ? `Nothing to push to ${upstream}`
                      : `Push ${plural(ahead, "commit")} to ${upstream}`
              }
              onClick={() => onAction("Push", "push", "Pushed.")}
              className={cn(!pushable && "text-muted-foreground")}
            >
              <ArrowUpFromLineIcon />
              {needsPublish
                ? "Publish branch"
                : ahead > 0
                  ? `Push ${ahead}`
                  : "Push"}
            </Button>
            <Button
              size="sm"
              variant={behind > 0 ? "default" : "outline"}
              disabled={busy || !git.branch || behind === 0}
              title={
                !git.branch
                  ? "Switch to a branch to pull"
                  : !upstream
                    ? `${git.branch} has no upstream branch`
                    : behind === 0
                      ? `Up to date with ${upstream}`
                      : `Fast-forward ${plural(behind, "commit")} from ${upstream}`
              }
              onClick={() => onAction("Pull", "pull", "Pulled.")}
              className={cn(behind === 0 && "text-muted-foreground")}
            >
              <ArrowDownToLineIcon />
              {behind > 0 ? `Pull ${behind}` : "Pull"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title="Fetch every remote's branches"
              onClick={() => onAction("Fetch", "fetch", "Fetched.")}
            >
              <RefreshCwIcon /> Fetch
            </Button>
          </>
        )}
        {!hasRemote && (
          <span className="text-xs text-muted-foreground">
            No remote configured
          </span>
        )}
        {hasRemote && git.branch && !remoteBranchExists && !upstream && (
          <span className="text-xs text-muted-foreground">Not on remote</span>
        )}
        <span className="ml-auto flex flex-wrap gap-1">
          <Button
            size="xs"
            variant="ghost"
            disabled={!git.head}
            onClick={() => onDialog("commits")}
          >
            <HistoryIcon /> View all commits
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!git.head}
            onClick={() => onDialog("graph")}
          >
            <GitForkIcon /> View graph
          </Button>
        </span>
      </div>
    </article>
  );
}

type BranchActions = {
  dirty: number;
  busy: boolean;
  onSwitch: (branch: string) => void;
  onGoTo: (worktreePath: string) => void;
};

/** Default branch first (its remote counterpart first among remotes), the rest as listed. */
function defaultFirst(list: BranchInfo[], defaultBranch: string | null) {
  const isDefault = (branch: BranchInfo) =>
    defaultBranch !== null && localNameOf(branch) === defaultBranch;
  return [...list].sort((a, b) => Number(isDefault(b)) - Number(isDefault(a)));
}

function GroupHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <h3 className="text-base font-semibold">{title}</h3>
      <CountPill count={count} />
    </div>
  );
}

function BranchesSection({
  branches,
  checkouts,
  hasRemote,
  currentPath,
  ...actions
}: {
  branches: BranchList;
  checkouts: WorktreeInfo[];
  hasRemote: boolean;
  currentPath: string;
} & BranchActions) {
  const local = defaultFirst(
    branches.branches.filter((branch) => !branch.remote),
    branches.defaultBranch,
  );
  const remote = defaultFirst(
    branches.branches.filter((branch) => branch.remote),
    branches.defaultBranch,
  );
  const row = (branch: BranchInfo) => (
    <BranchRow
      key={branch.name}
      branch={branch}
      branches={branches}
      checkouts={checkouts}
      hasRemote={hasRemote}
      currentPath={currentPath}
      {...actions}
    />
  );
  return (
    <section
      aria-label="Branches"
      className="overflow-hidden rounded-xl border bg-card"
    >
      <GroupHeading title="Local branches" count={local.length} />
      {actions.dirty > 0 && local.length + remote.length > 1 && (
        <p className="flex items-center gap-1.5 border-t px-4 py-1.5 text-xs text-muted-foreground">
          <AlertTriangleIcon className="size-3.5 shrink-0" />
          Commit your changes before switching branches.
        </p>
      )}
      <ul aria-label="Local branches" className="divide-y border-t">
        {local.map(row)}
      </ul>
      {remote.length > 0 && (
        <>
          <div className="border-t">
            <GroupHeading title="Remote branches" count={remote.length} />
          </div>
          <ul aria-label="Remote branches" className="divide-y border-t">
            {remote.map(row)}
          </ul>
        </>
      )}
    </section>
  );
}

function BranchRow({
  branch,
  branches,
  checkouts,
  hasRemote,
  currentPath,
  dirty,
  busy,
  onSwitch,
  onGoTo,
}: {
  branch: BranchInfo;
  branches: BranchList;
  checkouts: WorktreeInfo[];
  hasRemote: boolean;
  currentPath: string;
} & BranchActions) {
  const state = branchState(branch, branches, currentPath);
  const isSelected = branch.checkedOutIn === currentPath;
  const matchingRemote = branches.branches.some(
    (candidate) => candidate.remote && localNameOf(candidate) === branch.name,
  );
  // Plain-text status: one segment per fact, no chips.
  const segments: { text: string; warn?: boolean }[] = [];
  if (!branch.remote) {
    if (branch.dirty !== null)
      segments.push(
        branch.dirty > 0
          ? { text: `${plural(branch.dirty, "file")} uncommitted`, warn: true }
          : { text: "All committed" },
      );
    const againstDefault = compareText(branch.defaultCompare);
    if (againstDefault) segments.push({ text: againstDefault });
    const againstUpstream = compareText(
      branch.upstreamCompare,
      branch.upstream ?? undefined,
    );
    if (againstUpstream) segments.push({ text: againstUpstream });
    else if (hasRemote && !branch.upstream)
      segments.push({
        text: matchingRemote ? "Not tracking its remote branch" : "Not pushed",
        warn: !matchingRemote,
      });
  } else {
    // A remote branch against the local default branch.
    const against = compareText(branch.defaultCompare);
    if (against) segments.push({ text: against });
  }
  return (
    <li
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-l-2 px-4 py-2.5",
        isSelected
          ? "border-l-sidebar-accent-foreground"
          : "border-l-transparent",
      )}
    >
      <div className="min-w-0 flex-1 basis-64 space-y-0.5">
        <p className="font-mono text-sm font-semibold break-all">
          {branch.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {branch.subject}
          <span> · {timeAgo(branch.committedAt)}</span>
        </p>
        {segments.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {segments.map((segment, index) => (
              <span key={index}>
                {index > 0 && " · "}
                <span className={cn(segment.warn && "text-warning")}>
                  {segment.text}
                </span>
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="flex min-w-24 shrink-0 justify-end">
        {state.kind === "elsewhere" ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onGoTo(state.path)}
            title={state.path}
          >
            Go to checkout
          </Button>
        ) : (
          state.kind === "available" && (
            <Button
              size="xs"
              variant="outline"
              disabled={busy || dirty > 0}
              title={
                dirty > 0
                  ? "Commit your changes before switching branches"
                  : branch.remote
                    ? "Creates or uses the matching local branch"
                    : undefined
              }
              onClick={() => onSwitch(branch.name)}
            >
              Switch
            </Button>
          )
        )}
      </div>
    </li>
  );
}
