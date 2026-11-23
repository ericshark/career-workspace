"use client";
import { useEffect, useState } from "react";
import {
  BellIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { DuplicateMatches } from "@/components/DuplicateMatches";
import type { QuickSummaryTarget } from "@/components/QuickSummaryModal";
import { SourceDot } from "@/components/SourceDot";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { QuickBatchListItem } from "@/lib/quickState";
import { cn } from "@/lib/utils";

function canUndoBatch(batch: QuickBatchListItem, now: number): boolean {
  return (
    !batch.undone &&
    batch.added.length > 0 &&
    (!batch.undoExpiresAt || now < batch.undoExpiresAt)
  );
}

function BatchJobList({
  batch,
  onOpenSummary,
}: {
  batch: QuickBatchListItem;
  onOpenSummary: (target: QuickSummaryTarget) => void;
}) {
  if (!batch.added.length && !batch.skipped.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {batch.added.length > 0 && (
        <ul className="flex flex-col divide-y divide-border/60 text-sm">
          {batch.added.map((a) => {
            const hasDup =
              !!a.duplicates &&
              (a.duplicates.exact.length > 0 ||
                a.duplicates.possible.length > 0);
            return (
              <li key={a.undoId} className="flex flex-col gap-1 py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <SourceDot source={a.source} />
                  <button
                    type="button"
                    onClick={() =>
                      onOpenSummary({
                        id: a.quickId,
                        company: a.company,
                        role: a.role,
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
                  >
                    <span className="truncate font-medium">{a.company}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="truncate">{a.role}</span>
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {a.source}
                    {a.action === "updated" ? " · updated" : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-6 px-2 text-xs"
                    onClick={() =>
                      onOpenSummary({
                        id: a.quickId,
                        company: a.company,
                        role: a.role,
                      })
                    }
                  >
                    <FileTextIcon className="size-3" />
                    Summary
                  </Button>
                </div>
                {a.note && (
                  <span className="pl-5 text-xs text-warning">{a.note}</span>
                )}
                {hasDup && a.duplicates && (
                  <details className="pl-5 text-xs text-warning">
                    <summary className="cursor-pointer">
                      Possible duplicate — compare postings
                    </summary>
                    <DuplicateMatches duplicates={a.duplicates} />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {batch.skipped.length > 0 && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>Skipped</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 text-xs">
              {batch.skipped.map((s, i) => (
                <li key={i}>
                  {s.company}
                  {s.role ? ` — ${s.role}` : ""}: {s.reason}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * Top inline bar in Quick Add:
 * - Shows running/queued batches ("Adding N jobs… (X/N)")
 * - Shows the latest completed batch as a compact collapsible bar ("Added N jobs") that auto-clears on next Quick Add or navigation
 * - Keeps any error/interrupted batch visible in the main area with Retry remaining & Restore to editor
 */
export function QuickTopStatusBar({
  batches,
  onOpenSummary,
  onUndo,
  onRestore,
  onRetry,
  onCancel,
  onDismissTop,
}: {
  batches: QuickBatchListItem[];
  onOpenSummary: (target: QuickSummaryTarget) => void;
  onUndo: (batch: QuickBatchListItem) => void;
  onRestore: (batch: QuickBatchListItem, mode: "all" | "remaining") => void;
  onRetry: (batchId: string) => void;
  onCancel: (batchId: string) => void;
  onDismissTop: (batchId: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const toggleExpand = (batchId: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });

  const activeBatches = batches.filter(
    (b) => b.status === "running" || b.status === "queued",
  );
  const errorBatches = batches.filter(
    (b) =>
      (b.status === "error" ||
        b.status === "interrupted" ||
        (b.status === "cancelled" && b.remaining.length > 0)) &&
      !b.dismissedFromTop,
  );
  const latestDone = batches.find(
    (b) => b.status === "done" && !b.dismissedFromTop,
  );

  if (!activeBatches.length && !errorBatches.length && !latestDone) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {activeBatches.map((batch) => {
        const doneCount = batch.added.length + batch.skipped.length;
        const isQueued = batch.status === "queued";
        return (
          <div
            key={batch.batchId}
            role="status"
            className="rounded-xl border bg-card px-3 py-2.5 text-xs shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <Spinner className="size-4 text-primary" aria-hidden />
                <span>
                  {isQueued
                    ? `Queued ${batch.totalCount} job${batch.totalCount === 1 ? "" : "s"}…`
                    : `Adding jobs · ${doneCount} of ${batch.totalCount}`}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={() => onCancel(batch.batchId)}
              >
                Cancel
              </Button>
            </div>
            <div
              role="progressbar"
              aria-label="Quick Add progress"
              aria-valuemin={0}
              aria-valuemax={batch.totalCount}
              aria-valuenow={doneCount}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{
                  width: `${batch.totalCount ? Math.min(100, (doneCount / batch.totalCount) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        );
      })}

      {latestDone && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <button
              type="button"
              onClick={() => toggleExpand(latestDone.batchId)}
              aria-expanded={expandedIds.has(latestDone.batchId)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
            >
              <CheckCircle2Icon className="size-4 shrink-0 text-success" />
              <span>
                {latestDone.undone
                  ? `Undone ${latestDone.added.length} job${latestDone.added.length === 1 ? "" : "s"}`
                  : `Added ${latestDone.added.length} job${latestDone.added.length === 1 ? "" : "s"}${latestDone.skipped.length ? ` · ${latestDone.skipped.length} skipped` : ""}`}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform",
                  expandedIds.has(latestDone.batchId) && "rotate-180",
                )}
              />
            </button>
            <div className="flex items-center gap-1.5">
              {latestDone.undone && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="h-7 px-2 text-xs"
                  onClick={() => onRestore(latestDone, "all")}
                >
                  <RotateCcwIcon className="size-3" />
                  Restore to editor
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss batch summary"
                onClick={() => onDismissTop(latestDone.batchId)}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          </div>
          {expandedIds.has(latestDone.batchId) && (
            <div className="flex flex-col gap-2 border-t bg-card px-3 py-2.5">
              <BatchJobList batch={latestDone} onOpenSummary={onOpenSummary} />
              {canUndoBatch(latestDone, now) && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="h-7 px-2 text-xs"
                    onClick={() => onUndo(latestDone)}
                  >
                    <Undo2Icon className="size-3" />
                    Undo
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {errorBatches.map((batch) => {
        const expanded = expandedIds.has(batch.batchId);
        return (
          <div
            key={batch.batchId}
            role="alert"
            className="overflow-hidden rounded-xl border border-destructive/40 bg-destructive/5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-destructive">
                <TriangleAlertIcon className="size-4 shrink-0" />
                <span className="truncate">
                  {batch.status === "cancelled"
                    ? `Cancelled (${batch.added.length}/${batch.totalCount} added)`
                    : `Quick Add failed (${batch.added.length}/${batch.totalCount} added): ${batch.error || "Save incomplete"}`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {batch.remaining.length > 0 && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-7 px-2 text-xs"
                      onClick={() => onRetry(batch.batchId)}
                    >
                      Retry remaining ({batch.remaining.length})
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-7 px-2 text-xs"
                      onClick={() => onRestore(batch, "remaining")}
                    >
                      <RotateCcwIcon className="size-3" />
                      Restore to editor
                    </Button>
                  </>
                )}
                {batch.added.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-7 px-2 text-xs"
                    onClick={() => toggleExpand(batch.batchId)}
                  >
                    {expanded
                      ? "Hide added"
                      : `Show added (${batch.added.length})`}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Dismiss batch error"
                  onClick={() => onDismissTop(batch.batchId)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            </div>
            {expanded && batch.added.length > 0 && (
              <div className="border-t bg-card px-3 py-2.5">
                <BatchJobList batch={batch} onOpenSummary={onOpenSummary} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function batchOutcome(batch: QuickBatchListItem): string {
  const logged = batch.added.length;
  const progress = `${logged}/${batch.totalCount} logged`;

  if (batch.undone) return "Undone";
  switch (batch.status) {
    case "queued":
      return "Queued";
    case "running":
      return `Logging applications · ${progress}`;
    case "cancelled":
      return `Cancelled · ${progress}`;
    case "interrupted":
      return `Interrupted · ${progress}`;
    case "error":
      return `Failed · ${progress}`;
    case "done":
      if (logged === 0)
        return batch.totalCount > 1
          ? `${batch.skipped.length} applications skipped`
          : "Skipped";
      if (batch.totalCount === 1)
        return batch.added[0].action === "updated"
          ? "Application updated"
          : "Application logged";
      return `${logged} application${logged === 1 ? "" : "s"} logged`;
  }
}

export function QuickBellPopover({
  batches,
  onOpenSummary,
  onMarkViewed,
  missingCount = 0,
}: {
  batches: QuickBatchListItem[];
  onOpenSummary: (target: QuickSummaryTarget) => void;
  onMarkViewed: () => void;
  /** Jobs still missing a company or role: shown red here until fixed. */
  missingCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const recent = batches.slice(0, 5);
  const running = recent.some(
    (b) => b.status === "running" || b.status === "queued",
  );
  const unviewed = recent.filter(
    (b) =>
      b.viewedAt === null && b.status !== "running" && b.status !== "queued",
  );
  const hasError = recent.some(
    (b) =>
      (b.status === "error" || b.status === "interrupted") &&
      (b.viewedAt === null || !b.dismissedFromTop),
  );
  const badgeCount = unviewed.length || (hasError ? 1 : 0) || missingCount;

  const toggleBatch = (batchId: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setExpandedIds(new Set());
          if (unviewed.length > 0) {
            onMarkViewed();
          }
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={
            badgeCount > 0
              ? `Quick Add activity (${badgeCount} new)`
              : "Quick Add activity"
          }
          title="Quick Add activity"
          className={cn(
            "relative",
            (hasError || missingCount > 0) &&
              "border-destructive/50 text-destructive",
          )}
        >
          {running ? (
            <Spinner className="size-4" aria-hidden />
          ) : missingCount > 0 ? (
            <CircleAlertIcon className="size-4" />
          ) : hasError ? (
            <TriangleAlertIcon className="size-4" />
          ) : (
            <BellIcon className="size-4" />
          )}
          {badgeCount > 0 && (
            <span
              aria-hidden
              className={cn(
                "absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white",
                hasError || missingCount > 0
                  ? "bg-destructive"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {badgeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Quick Add activity"
        className="w-80 max-w-[calc(100vw-1rem)] gap-1 p-2"
      >
        <h2 className="px-2 py-1 text-sm font-semibold">Quick Add activity</h2>
        {missingCount > 0 && (
          <p className="mx-2 mb-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {missingCount} job{missingCount === 1 ? "" : "s"} still need a
            company or role. Fix them on the Quick Add page.
          </p>
        )}
        {recent.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            No Quick Add activity yet.
          </p>
        ) : (
          <div className="max-h-[65vh] divide-y divide-border/70 overflow-y-auto">
            {recent.map((batch) => {
              const expanded = expandedIds.has(batch.batchId);
              const jobs = batch.undone ? [] : batch.added;
              const singleJob = batch.totalCount === 1 ? jobs[0] : undefined;
              const issues = [
                batch.error,
                batch.skipped.length > 0 && `${batch.skipped.length} skipped`,
              ].filter(Boolean);
              const openJob = (job: QuickBatchListItem["added"][number]) => {
                setOpen(false);
                onOpenSummary({
                  id: job.quickId,
                  company: job.company,
                  role: job.role,
                });
              };
              const outcome = batchOutcome(batch);
              const label =
                jobs.length === 1 ? "1 job added" : `${jobs.length} jobs added`;
              const rowClass =
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

              return (
                <div key={batch.batchId} className="py-1">
                  {singleJob ? (
                    <button
                      type="button"
                      className={rowClass}
                      onClick={() => openJob(singleJob)}
                    >
                      <CheckCircle2Icon
                        aria-label="Added"
                        className="size-5 shrink-0 rounded-full bg-success/10 p-0.5 text-success"
                      />
                      <span className="truncate">{singleJob.company}</span>
                      <ChevronRightIcon
                        aria-hidden
                        className="ml-auto size-4 shrink-0 text-muted-foreground"
                      />
                    </button>
                  ) : jobs.length > 0 ? (
                    <button
                      type="button"
                      className={rowClass}
                      aria-expanded={expanded}
                      onClick={() => toggleBatch(batch.batchId)}
                    >
                      <CheckCircle2Icon
                        aria-label="Added"
                        className="size-5 shrink-0 rounded-full bg-success/10 p-0.5 text-success"
                      />
                      {label}
                      <ChevronDownIcon
                        aria-hidden
                        className={cn(
                          "ml-auto size-4 text-muted-foreground",
                          expanded && "rotate-180",
                        )}
                      />
                    </button>
                  ) : (
                    <p className="px-2 py-2 text-sm">{outcome}</p>
                  )}
                  {expanded && (
                    <ul className="ml-5 border-l border-border/70 pl-2">
                      {jobs.map((job) => (
                        <li key={job.undoId}>
                          <button
                            type="button"
                            className={rowClass}
                            onClick={() => openJob(job)}
                          >
                            <CheckCircle2Icon
                              aria-label="Added"
                              className="size-5 shrink-0 rounded-full bg-success/10 p-0.5 text-success"
                            />
                            <span className="truncate">{job.company}</span>
                            <ChevronRightIcon
                              aria-hidden
                              className="ml-auto size-4 shrink-0 text-muted-foreground"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <ul className="empty:hidden">
                    {jobs.length > 0 && batch.status !== "done" && (
                      <li className="px-2 py-1 text-xs text-muted-foreground">
                        {outcome}
                      </li>
                    )}
                    {issues.map((issue, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-2 px-2 py-1 text-xs text-muted-foreground"
                      >
                        <TriangleAlertIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-warning"
                        />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
