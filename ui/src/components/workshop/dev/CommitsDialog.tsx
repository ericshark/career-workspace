"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon, GitBranchIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import type { CommitInfo } from "@/lib/dev/types";
import { cn } from "@/lib/utils";
import { commitTime, devGet, fullDate } from "./api";
import type { GitContext } from "./context";

const PAGE_SIZE = 100;

export function CommitsDialog({
  context,
  onClose,
}: {
  context: GitContext;
  onClose: () => void;
}) {
  const { itemId, worktree, branches } = context;
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState<CommitInfo | null>(null);
  const [list, setList] = useState<CommitInfo[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const viewed = picked ?? branches.current ?? "HEAD";

  async function load(skip: number) {
    setLoading(true);
    try {
      const { commits } = await devGet<{ commits: CommitInfo[] }>(
        itemId,
        "commits",
        { worktree: worktree.path, ref: viewed, skip },
      );
      setList((previous) => (skip === 0 ? commits : [...previous, ...commits]));
      setMore(commits.length === PAGE_SIZE);
      setError("");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(0);
    // Reload when another branch is picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed]);

  const tabs = [
    ...(branches.current ? [] : ["HEAD"]),
    ...branches.branches.map((branch) => branch.name),
  ];
  const dirty = worktree.git.dirty;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Commits · ${context.projectName}`}
      width={760}
      footer={
        pending && context.onCheckout ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <p className="mr-auto min-w-0 flex-1 basis-64 text-xs">
              {dirty > 0 ? (
                <span className="flex items-center gap-1.5 text-destructive">
                  <AlertTriangleIcon className="size-3.5 shrink-0" />
                  Commit your changes before checking out another commit.
                </span>
              ) : (
                <>
                  Check out <span className="font-mono">{pending.short}</span>{" "}
                  <span className="text-muted-foreground">
                    “{pending.subject}”
                  </span>
                  ?{" "}
                  <span className="text-muted-foreground">
                    This detaches HEAD; create a branch there before committing.
                  </span>
                </>
              )}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            {dirty === 0 && (
              <Button
                size="sm"
                disabled={context.switching}
                onClick={() => {
                  context.onCheckout?.({ commit: pending.hash });
                  setPending(null);
                }}
              >
                Check out
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {tabs.length <= 1 ? (
          <span className="flex items-center gap-1.5 font-mono text-xs font-medium">
            <GitBranchIcon className="size-3.5 text-muted-foreground" />
            {tabs[0] === "HEAD" ? "detached HEAD" : tabs[0]}
          </span>
        ) : (
          <div
            role="tablist"
            aria-label="Branch"
            className="flex gap-1 overflow-x-auto pb-1"
          >
            {tabs.map((name) => (
              <button
                key={name}
                role="tab"
                type="button"
                aria-selected={name === viewed}
                onClick={() => {
                  setPicked(name);
                  setPending(null);
                }}
                className={cn(
                  "shrink-0 rounded-md border px-2 py-1 font-mono text-xs transition-colors",
                  name === viewed
                    ? "border-foreground/60 bg-muted"
                    : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {name === "HEAD" ? "detached HEAD" : name}
                {name === branches.current && (
                  <span className="ml-1 text-success">●</span>
                )}
              </button>
            ))}
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : loading && list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading commits…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No commits.</p>
        ) : (
          <ul aria-label="Commits" className="divide-y rounded-lg border">
            {list.map((commit) => (
              <li
                key={commit.hash}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2",
                  pending?.hash === commit.hash && "bg-muted",
                )}
              >
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {commit.short}
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm">{commit.subject}</p>
                  <p
                    className="text-xs text-muted-foreground"
                    title={fullDate(commit.committedAt)}
                  >
                    {commit.author} · {commitTime(commit.committedAt)}
                  </p>
                </div>
                {commit.hash === branches.head ? (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                    Checked out
                  </span>
                ) : (
                  context.onCheckout && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPending(commit)}
                    >
                      Check out
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {more && (
          <div className="text-center">
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void load(list.length)}
            >
              {loading ? "Loading…" : "Load older commits"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
