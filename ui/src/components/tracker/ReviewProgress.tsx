"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BellIcon, ChevronLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Modal } from "@/components/Modal";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { ReviewJobFacts } from "@/components/ReviewCard";
import { JobSummary } from "@/components/JobSummary";
import { JobHeading, JobLink } from "@/components/JobHeader";
import { showToast } from "@/components/notify";
import { PROGRESS_CHANGED, useFetchJson } from "@/components/useFetchJson";
import type { ReviewContext } from "@/lib/reviewContext";
import type { Preferences } from "@/lib/preferences";
import type {
  ModelId,
  ReviewJobStatus,
  SavedReviewSummary,
  ScoreResult,
} from "@/lib/types";

type OpenedReview = {
  result: ScoreResult;
  context: ReviewContext;
  extrasModel: ModelId;
  tailorModel: ModelId;
};
/** The count comes from durable viewed metadata, including reviews made on Apply. */
const NO_ITEMS: SavedReviewSummary[] = [];
const NO_JOBS: ReviewJobStatus[] = [];
export function ReviewProgress({ onChange }: { onChange: () => void }) {
  // Shared with the Tracker list and Apply history: one request per endpoint however many
  // components read it. Reviews refresh when files change; the running-job list is polled.
  const reviews = useFetchJson<{ items: SavedReviewSummary[] }>("/api/reviews");
  const status = useFetchJson<{ jobs: ReviewJobStatus[] }>(
    "/api/score/status",
    { intervalMs: 2000 },
  );
  const items = reviews.data?.items ?? NO_ITEMS;
  const jobs = status.data?.jobs ?? NO_JOBS;
  const [opening, setOpening] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [opened, setOpened] = useState<OpenedReview | null>(null);
  const [summary, setSummary] = useState(false);
  const dialogContent = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    dialogContent.current?.parentElement?.scrollTo({ top: 0 });
  }, [summary, opened?.result.runId]);
  function changed() {
    onChange();
    if (opened)
      void fetch(`/api/runs/${encodeURIComponent(opened.result.runId)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) return;
          const run = await response.json();
          setOpened((current) =>
            current?.result.runId === opened.result.runId
              ? { ...current, context: run.context }
              : current,
          );
        })
        .catch(() => {});
  }
  const refreshReviews = reviews.reload;
  const refreshStatus = status.reload;
  useEffect(() => {
    const refresh = () => {
      void refreshReviews();
      void refreshStatus();
    };
    for (const event of ["review-viewed", "tracker-review-started"])
      window.addEventListener(event, refresh);
    return () => {
      for (const event of ["review-viewed", "tracker-review-started"])
        window.removeEventListener(event, refresh);
    };
  }, [refreshReviews, refreshStatus]);
  const unread = items
    .filter(
      (item) =>
        item.kind === "review" &&
        item.viewedAt === null &&
        !hidden.includes(item.id),
    )
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const pending = jobs.filter(
    (job) => job.sourceRecordId && job.status !== "done",
  );
  async function open(item: SavedReviewSummary) {
    if (opening) return;
    setOpening(item.id);
    setHidden((ids) => [...ids, item.id]);
    setError(null);
    try {
      const [runResponse, prefsResponse] = await Promise.all([
        fetch(`/api/runs/${encodeURIComponent(item.id)}`, {
          cache: "no-store",
        }),
        fetch("/api/preferences", { cache: "no-store" }),
      ]);
      if (!runResponse.ok || !prefsResponse.ok)
        throw new Error("Could not open review; try again");
      const run = await runResponse.json();
      const prefs: Preferences = await prefsResponse.json();
      setOpened({
        result: run.result,
        context: run.context,
        extrasModel: prefs.selections[prefs.provider].extras,
        tailorModel: prefs.selections[prefs.provider].tailor,
      });
      setSummary(false);
      setPopoverOpen(false);
    } catch (e) {
      setHidden((ids) => ids.filter((id) => id !== item.id));
      setError((e as Error).message);
    } finally {
      setOpening(null);
    }
  }
  async function control(job: ReviewJobStatus, action: "cancel" | "resume") {
    try {
      const response = await fetch(`/api/score/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: job.runId }),
      });
      if (!response.ok) throw new Error("Could not update review; try again");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-label={`Review notifications, ${unread.length} unviewed`}
          >
            <BellIcon />
            <Badge variant="secondary" className="tabular-nums">
              {unread.length}
            </Badge>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 max-w-[calc(100vw-2rem)]"
          aria-label="Review notifications"
        >
          <h2 className="font-semibold">Unviewed reviews</h2>
          {(error ?? reviews.error ?? status.error) && (
            <p role="alert" className="text-xs text-destructive">
              {error ?? reviews.error ?? status.error}
            </p>
          )}
          {!unread.length && (
            <p className="text-sm text-muted-foreground">All caught up.</p>
          )}
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {unread.map((item) => (
              <li key={item.id}>
                <button
                  className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={!!opening}
                  onClick={() => void open(item)}
                >
                  <span className="block font-medium">{item.company}</span>
                  <span className="block text-xs text-muted-foreground">
                    {item.role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!!pending.length && (
            <section
              className="space-y-2 border-t pt-2"
              aria-label="Review progress"
            >
              {pending.map((job) => (
                <div key={job.runId} className="space-y-1 text-xs">
                  <p className="font-medium">
                    {job.company || job.preview || "Job review"}
                  </p>
                  <p className="text-muted-foreground">
                    {job.status === "running"
                      ? `${job.step || "Working"} · ${Math.floor(job.elapsedMs / 1000)}s`
                      : job.status}
                  </p>
                  {job.error && <p className="text-destructive">{job.error}</p>}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void control(
                        job,
                        ["running", "queued"].includes(job.status)
                          ? "cancel"
                          : "resume",
                      )
                    }
                  >
                    {["running", "queued"].includes(job.status)
                      ? "Cancel review"
                      : "Resume / retry"}
                  </Button>
                </div>
              ))}
            </section>
          )}
        </PopoverContent>
      </Popover>
      {opened && (
        <Modal
          open
          width={820}
          onClose={() => setOpened(null)}
          title={
            <JobHeading
              large={summary}
              company={opened.result.company}
              role={opened.result.role}
            />
          }
          headerAction={<JobLink link={opened.result.link} large={summary} />}
        >
          <div ref={dialogContent}>
            {summary ? (
              <div className="space-y-4 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSummary(false)}
                >
                  <ChevronLeftIcon />
                  View Review
                </Button>
                <ReviewJobFacts
                  result={opened.result}
                  context={opened.context}
                  large
                />
                <JobSummary brief={opened.context.brief} />
              </div>
            ) : (
              <ReviewWorkspace
                key={opened.result.runId}
                result={opened.result}
                extrasModel={opened.extrasModel}
                tailorModel={opened.tailorModel}
                onViewSummary={() => setSummary(true)}
                onClose={() => setOpened(null)}
                onChange={changed}
                onIdentityChanged={(result) =>
                  setOpened((current) =>
                    current?.result.runId === result.runId
                      ? { ...current, result }
                      : current,
                  )
                }
                offerUndo={(message, undoId) =>
                  showToast(message, {
                    label: "Undo",
                    onClick: () => {
                      void fetch("/api/applications/undo", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(
                          Array.isArray(undoId)
                            ? { undoIds: undoId }
                            : { undoId },
                        ),
                      })
                        .then((response) => {
                          if (!response.ok)
                            throw new Error(
                              "Could not undo application change",
                            );
                          onChange();
                          window.dispatchEvent(new Event(PROGRESS_CHANGED));
                          showToast("Undone.");
                        })
                        .catch((e) => showToast(e.message));
                    },
                  })
                }
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
