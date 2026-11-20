"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, FolderGit2Icon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import {
  assignBranches,
  branchColors,
  layoutGraph,
  type GraphEdge,
} from "@/lib/dev/graph";
import type { BranchInfo, CommitInfo, GraphData } from "@/lib/dev/types";
import { cn } from "@/lib/utils";
import { branchState, devGet, localNameOf, plural, timeAgo } from "./api";
import type { GitContext } from "./context";

const ROW = 36;
const LANE = 22;
const PAD = 16;
const laneX = (lane: number) => PAD + lane * LANE;
const rowY = (row: number) => row * ROW + ROW / 2;
/** A branch's color slot as a CSS color; commits no branch reaches are neutral grey. */
const slotColor = (slot: number | undefined) =>
  slot === undefined ? "var(--muted-foreground)" : `var(--branch-${slot + 1})`;

/** Runs straight down `viaLane`, bending at the child's or parent's row when lanes differ. */
function edgePath({
  fromRow,
  fromLane,
  viaLane,
  toRow,
  toLane,
}: GraphEdge): string {
  const x1 = laneX(fromLane);
  const y1 = rowY(fromRow);
  const xv = laneX(viaLane);
  const x2 = laneX(toLane);
  const y2 = rowY(toRow);
  const bend = ROW * 0.8;
  let path = `M${x1},${y1}`;
  if (toRow - fromRow === 1)
    return `${path} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`;
  if (xv !== x1)
    path += ` C${x1},${y1 + bend} ${xv},${y1 + ROW - bend} ${xv},${y1 + ROW}`;
  if (xv !== x2)
    path += ` L${xv},${y2 - ROW} C${xv},${y2 - ROW + bend} ${x2},${y2 - bend} ${x2},${y2}`;
  else path += ` L${x2},${y2}`;
  return path;
}

type Pending =
  | { kind: "commit"; commit: CommitInfo }
  | { kind: "branch"; branch: BranchInfo };

export function GraphDialog({
  context,
  onClose,
}: {
  context: GitContext;
  onClose: () => void;
}) {
  const { itemId, worktree } = context;
  const [pending, setPending] = useState<Pending | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    devGet<GraphData>(itemId, "graph", { worktree: worktree.path })
      .then(setGraph)
      .catch((failure: Error) => setError(failure.message));
  }, [itemId, worktree.path]);

  const commits = useMemo(() => graph?.commits ?? [], [graph]);
  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const tips = useMemo(() => {
    const byHash = new Map<string, BranchInfo[]>();
    for (const branch of graph?.branches ?? [])
      byHash.set(branch.head, [...(byHash.get(branch.head) ?? []), branch]);
    return byHash;
  }, [graph]);
  const { current, defaultBranch } = context.branches;
  const { rowColors, colorOfBranch } = useMemo(() => {
    const branches = graph?.branches ?? [];
    const tipList = branches.map((b) => ({
      key: localNameOf(b),
      head: b.head,
      remote: b.remote,
    }));
    const owners = assignBranches(commits, tipList, { current, defaultBranch });
    const slots = branchColors(
      tipList.map((tip) => tip.key),
      defaultBranch,
    );
    return {
      rowColors: owners.map((owner) =>
        slotColor(owner ? slots.get(owner) : undefined),
      ),
      colorOfBranch: (branch: BranchInfo) =>
        slotColor(slots.get(localNameOf(branch))),
    };
  }, [graph, commits, current, defaultBranch]);
  const graphWidth = PAD * 2 + (layout.laneCount - 1) * LANE;
  const canSwitch = Boolean(context.onCheckout);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Graph · ${context.projectName}`}
      width={960}
      footer={
        pending && canSwitch ? (
          pending.kind === "commit" ? (
            <ConfirmBar
              context={context}
              message={
                worktree.git.dirty > 0 ? (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangleIcon className="size-3.5 shrink-0" />
                    Commit your changes before checking out another commit.
                  </span>
                ) : (
                  <>
                    Check out{" "}
                    <span className="font-mono">{pending.commit.short}</span>{" "}
                    <span className="text-muted-foreground">
                      “{pending.commit.subject}”
                    </span>
                    ?{" "}
                    <span className="text-muted-foreground">
                      This detaches HEAD.
                    </span>
                  </>
                )
              }
              action={
                worktree.git.dirty === 0
                  ? {
                      label: "Check out",
                      run: () =>
                        context.onCheckout?.({ commit: pending.commit.hash }),
                    }
                  : undefined
              }
              onCancel={() => setPending(null)}
            />
          ) : (
            <BranchConfirm
              branch={pending.branch}
              context={context}
              onCancel={() => setPending(null)}
            />
          )
        ) : undefined
      }
    >
      <div className="space-y-3">
        <Legend canSwitch={canSwitch} />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : !graph ? (
          <p className="text-sm text-muted-foreground">Loading graph…</p>
        ) : commits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No commits.</p>
        ) : (
          <div
            className="relative overflow-x-auto rounded-lg border py-1"
            style={{ minHeight: commits.length * ROW }}
          >
            <svg
              aria-hidden
              width={graphWidth}
              height={commits.length * ROW}
              className="absolute top-1 left-0"
            >
              {layout.edges.map((edge, index) => (
                <path
                  key={index}
                  d={edgePath(edge)}
                  fill="none"
                  stroke={
                    // A merge's second parent line takes the merged branch's color.
                    edge.parentIndex > 0 && edge.toRow < commits.length
                      ? rowColors[edge.toRow]
                      : rowColors[edge.fromRow]
                  }
                  strokeWidth={2.5}
                />
              ))}
              {commits.map((commit, row) => {
                const isHead = commit.hash === graph.head;
                return (
                  <circle
                    key={commit.hash}
                    cx={laneX(layout.lanes[row])}
                    cy={rowY(row)}
                    r={isHead ? 7 : 5}
                    fill={isHead ? "var(--card)" : rowColors[row]}
                    stroke={rowColors[row]}
                    strokeWidth={isHead ? 3 : 0}
                  />
                );
              })}
            </svg>
            <ul aria-label="Commit graph">
              {commits.map((commit) => (
                <li
                  key={commit.hash}
                  style={{ height: ROW, paddingLeft: graphWidth }}
                  className={cn(
                    "flex items-center gap-2 pr-3 text-sm hover:bg-muted/50",
                    pending?.kind === "commit" &&
                      pending.commit.hash === commit.hash &&
                      "bg-muted/50",
                  )}
                >
                  {(tips.get(commit.hash) ?? []).map((branch) => (
                    <BranchChip
                      key={branch.name}
                      branch={branch}
                      color={colorOfBranch(branch)}
                      context={context}
                      onClick={
                        canSwitch
                          ? () => setPending({ kind: "branch", branch })
                          : undefined
                      }
                    />
                  ))}
                  {commit.hash === graph.head && !context.branches.current && (
                    <span className="shrink-0 rounded-md bg-foreground px-1.5 py-px font-mono text-[11px] text-background">
                      HEAD
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={!canSwitch}
                    onClick={() => setPending({ kind: "commit", commit })}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                    title={canSwitch ? `Check out ${commit.short}` : undefined}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {commit.subject}
                    </span>
                    <span
                      className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground md:inline"
                      title={commit.author}
                    >
                      {commit.author}
                    </span>
                    <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                      {commit.short}
                    </span>
                    <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:inline">
                      {timeAgo(commit.committedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Legend({ canSwitch }: { canSwitch: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-success" /> checked out, clean
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-destructive" /> checked out,
        uncommitted changes
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full border" /> not checked out
      </span>
      <span className="flex items-center gap-1.5">
        <FolderGit2Icon className="size-3" /> in another worktree
      </span>
      {canSwitch && (
        <span>Click a branch to switch, or a commit to check it out.</span>
      )}
    </div>
  );
}

function BranchChip({
  branch,
  color,
  context,
  onClick,
}: {
  branch: BranchInfo;
  /** Identity color of the branch; unrelated to the status dot. */
  color: string;
  context: GitContext;
  onClick?: () => void;
}) {
  const checkedOut = !branch.remote && branch.checkedOutIn !== null;
  const dirty = checkedOut && (branch.dirty ?? 0) > 0;
  const here = branch.checkedOutIn === context.worktree.path;
  const elsewhere = checkedOut && !here;
  const where = branch.checkedOutIn
    ? here
      ? "this checkout"
      : branch.checkedOutIn
    : null;
  const status = dirty
    ? plural(branch.dirty ?? 0, "uncommitted file")
    : checkedOut
      ? "clean"
      : null;
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      title={
        where
          ? `Checked out in ${where}${status ? ` · ${status}` : ""}`
          : branch.remote
            ? "Remote branch"
            : "Not checked out"
      }
      style={{
        borderColor: color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
      className={cn(
        "inline-flex max-w-56 shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-px font-mono text-xs transition hover:brightness-95 disabled:cursor-default",
        branch.remote && "border-dashed",
        here && "font-semibold",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          dirty ? "bg-destructive" : checkedOut ? "bg-success" : "border",
        )}
      />
      {elsewhere && (
        <FolderGit2Icon
          aria-label="Checked out in another worktree"
          className="size-3 shrink-0"
        />
      )}
      <span className="truncate">{branch.name}</span>
      {dirty && (
        <span className="shrink-0 text-destructive">· {branch.dirty}</span>
      )}
    </button>
  );
}

function ConfirmBar({
  message,
  action,
  onCancel,
}: {
  context: GitContext;
  message: React.ReactNode;
  action?: { label: string; run: () => void };
  onCancel: () => void;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <p className="mr-auto min-w-0 flex-1 basis-64 text-xs">{message}</p>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {action ? "Cancel" : "OK"}
      </Button>
      {action && (
        <Button
          size="sm"
          onClick={() => {
            action.run();
            onCancel();
          }}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

function BranchConfirm({
  branch,
  context,
  onCancel,
}: {
  branch: BranchInfo;
  context: GitContext;
  onCancel: () => void;
}) {
  const state = branchState(branch, context.branches, context.worktree.path);
  const dirty = context.worktree.git.dirty;
  if (state.kind === "current")
    return (
      <ConfirmBar
        context={context}
        onCancel={onCancel}
        message={
          <>
            <span className="font-mono">{branch.name}</span> is already checked
            out here.
          </>
        }
      />
    );
  if (state.kind === "elsewhere")
    return (
      <ConfirmBar
        context={context}
        onCancel={onCancel}
        message={
          <span className="flex items-center gap-1.5 text-warning">
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            <span>
              <span className="font-mono">{branch.name}</span> is checked out in{" "}
              {state.path}
              {state.dirty
                ? ` (${plural(state.dirty, "uncommitted file")})`
                : ""}
              .
            </span>
          </span>
        }
        action={
          context.onGoTo
            ? {
                label: "Go to that checkout",
                run: () => context.onGoTo?.(state.path),
              }
            : undefined
        }
      />
    );
  if (dirty > 0)
    return (
      <ConfirmBar
        context={context}
        onCancel={onCancel}
        message={
          <span className="flex items-center gap-1.5 text-destructive">
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            Commit your changes before switching to {branch.name}.
          </span>
        }
      />
    );
  return (
    <ConfirmBar
      context={context}
      onCancel={onCancel}
      message={
        <>
          Switch this checkout to{" "}
          <span className="font-mono">{branch.name}</span>?
          {branch.remote && (
            <span className="text-muted-foreground">
              {" "}
              Creates or uses the matching local branch.
            </span>
          )}
        </>
      }
      action={{
        label: "Switch",
        run: () => context.onCheckout?.({ branch: branch.name }),
      }}
    />
  );
}
