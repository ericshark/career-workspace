"use client";
import { useEffect, useState } from "react";
import { CheckIcon, CircleAlertIcon, ClockIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatElapsed } from "../applyHelpers";
import type { ReviewJobStatus } from "@/lib/types";

export function ReviewQueue({
  jobs,
  onView,
  onControl,
}: {
  jobs: ReviewJobStatus[];
  onView: (id: string) => void;
  onControl: (id: string, action: "cancel" | "resume") => Promise<void>;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      setHidden(
        JSON.parse(sessionStorage.getItem("apply.dismissedReviews") ?? "[]"),
      );
    } catch {}
  }, []);
  function dismiss(id: string) {
    setHidden((previous) => {
      const next = [...new Set([...previous, id])];
      try {
        sessionStorage.setItem("apply.dismissedReviews", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const visible = jobs.filter(
    (j) => j.runId && (j.status !== "cancelled" || !hidden.includes(j.runId)),
  );
  const complete = visible
    .filter((j) => j.status === "done")
    .sort(
      (a, b) =>
        (b.finishedAt ?? b.startedAt ?? 0) - (a.finishedAt ?? a.startedAt ?? 0),
    );
  const shown = [
    ...visible.filter((j) => j.status !== "done"),
    ...complete.slice(0, expanded ? undefined : 3),
  ];
  if (!shown.length) return null;
  async function control(id: string, action: "cancel" | "resume") {
    setBusy((ids) => [...ids, id]);
    setError(null);
    try {
      await onControl(id, action);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update review");
    } finally {
      setBusy((ids) => ids.filter((value) => value !== id));
    }
  }
  return (
    <section aria-label="Review progress" className="space-y-1 border-t pt-2">
      <ul className="divide-y divide-border/60">
        {shown.map((j) => {
          const active = j.status === "running" || j.status === "queued";
          const label =
            j.status === "running"
              ? "Processing"
              : j.status === "done"
                ? "Completed"
                : j.status === "error"
                  ? "Failed"
                  : j.status[0].toUpperCase() + j.status.slice(1);
          const Icon =
            j.status === "done"
              ? CheckIcon
              : j.status === "queued"
                ? ClockIcon
                : CircleAlertIcon;
          return (
            <li
              key={j.runId}
              data-testid="review-progress-row"
              data-run-id={j.runId}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-xs"
            >
              {j.status === "running" ? (
                <Spinner aria-hidden className="size-3.5 text-primary" />
              ) : (
                <Icon
                  className={`size-3.5 shrink-0 ${j.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
                />
              )}
              <span
                className="min-w-0 basis-[calc(100%_-_1.5rem)] truncate sm:basis-0 sm:grow"
                title={j.preview}
              >
                {j.company
                  ? `${j.company}${j.role ? ` · ${j.role}` : ""}`
                  : j.preview || "Job review"}
              </span>
              <span
                className="ml-5 text-muted-foreground sm:ml-0"
                role="status"
              >
                {label}
                {j.status === "running"
                  ? ` · ${formatElapsed(j.elapsedMs)}`
                  : ""}
              </span>
              {j.status === "done" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onView(j.runId!);
                  }}
                >
                  View review
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy.includes(j.runId!)}
                  onClick={() =>
                    void control(j.runId!, active ? "cancel" : "resume")
                  }
                >
                  {active
                    ? "Cancel"
                    : j.status === "error" || j.status === "cancelled"
                      ? "Retry"
                      : "Resume"}
                </Button>
              )}
              {j.status === "cancelled" && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Dismiss review progress"
                  onClick={() => dismiss(j.runId!)}
                >
                  <XIcon />
                </Button>
              )}
              {j.error && (
                <p className="basis-full pl-5 text-destructive">{j.error}</p>
              )}
            </li>
          );
        })}
      </ul>
      {complete.length > 3 && (
        <button
          className="text-xs text-muted-foreground underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show fewer" : `Show all ${complete.length} completed`}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
