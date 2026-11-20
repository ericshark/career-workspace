import type { ReactNode } from "react";
import type { BranchCompare } from "@/lib/dev/types";
import { cn } from "@/lib/utils";
import { plural } from "./api";

export type Tone = "good" | "warn" | "info" | "neutral";

const toneClass: Record<Tone, string> = {
  good: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  info: "bg-sidebar-accent/50 text-sidebar-accent-foreground",
  neutral: "bg-muted/60 text-muted-foreground",
};

/** One short status word. Exact counts live in the tooltip, not the label. */
export function Chip({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Uncommitted / All committed. `dirty` null means the branch is not checked out. */
export function WorkingChip({ dirty }: { dirty: number | null }) {
  if (dirty === null) return null;
  return dirty > 0 ? (
    <Chip tone="warn" title={plural(dirty, "uncommitted file")}>
      Uncommitted
    </Chip>
  ) : (
    <Chip tone="good">All committed</Chip>
  );
}

/** Position against the configured upstream, plus whether the branch exists on a remote. */
export function RemoteChips({
  upstream,
  compare,
  hasRemoteBranch,
  hasRemote = true,
  showLocalFallback = false,
}: {
  upstream: string | null;
  compare: BranchCompare | null;
  hasRemoteBranch: boolean;
  hasRemote?: boolean;
  showLocalFallback?: boolean;
}) {
  if (!hasRemote) {
    return showLocalFallback ? (
      <Chip tone="neutral" title="This repository has no remote configured">
        Local only
      </Chip>
    ) : null;
  }
  if (!upstream) {
    return hasRemoteBranch ? (
      <>
        <Chip tone="warn" title="A remote branch exists but is not tracked">
          No upstream
        </Chip>
        <Chip tone="neutral" title="A matching branch exists on the remote">
          On remote
        </Chip>
      </>
    ) : (
      <>
        <Chip tone="warn" title="No upstream configured">
          Not pushed
        </Chip>
        <Chip tone="neutral" title="No matching branch on remote">
          Local only
        </Chip>
      </>
    );
  }
  if (!compare) {
    return hasRemoteBranch ? (
      <Chip tone="neutral" title={`Tracking ${upstream}`}>
        On remote
      </Chip>
    ) : (
      <>
        <Chip tone="warn" title={`Tracked remote branch ${upstream} is gone`}>
          Not pushed
        </Chip>
        <Chip tone="neutral" title="No matching branch on remote">
          Local only
        </Chip>
      </>
    );
  }
  return (
    <>
      {compare.ahead === 0 && compare.behind === 0 && (
        <Chip tone="good" title={`Matches ${upstream} as of the last fetch`}>
          In sync
        </Chip>
      )}
      {compare.ahead > 0 && (
        <Chip tone="info" title={plural(compare.ahead, "commit")}>
          Ahead of {upstream}
        </Chip>
      )}
      {compare.behind > 0 && (
        <Chip tone="warn" title={plural(compare.behind, "commit")}>
          Behind {upstream}
        </Chip>
      )}
      <Chip tone="neutral" title={`Tracking ${upstream}`}>
        On remote
      </Chip>
    </>
  );
}

/** Position against the default branch. */
export function DefaultChips({ compare }: { compare: BranchCompare | null }) {
  if (!compare) return null;
  const { ahead, behind, against } = compare;
  if (ahead === 0 && behind === 0) return <Chip>Same as {against}</Chip>;
  return (
    <>
      {ahead > 0 && (
        <Chip tone="info" title={plural(ahead, "commit")}>
          Ahead of {against}
        </Chip>
      )}
      {behind > 0 && (
        <Chip tone="warn" title={plural(behind, "commit")}>
          Behind {against}
        </Chip>
      )}
    </>
  );
}

/** A number with a small label, for the overview strip and hover card. */
export function Stat({
  value,
  label,
  className,
}: {
  value: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg bg-muted/40 px-3 py-2", className)}>
      <div className="text-lg leading-tight font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
