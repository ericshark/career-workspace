"use client";
import { ActivityPanel, useRecruiting } from "@/components/Recruiting";
import { hasActionHistory } from "@/lib/recruitingTypes";
import { useHideQuestions } from "@/components/Settings";
import Link from "next/link";
import { useFetchJson } from "@/components/useFetchJson";
import type { OpportunityReport } from "@/lib/opportunities";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  FileTextIcon,
  SparklesIcon,
  CheckIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  PencilIcon,
} from "lucide-react";
import { ApplicationEditor } from "./ApplicationEditor";
import { applicationDate } from "@/lib/config";
import { localDate } from "@/components/applyHelpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/Modal";
import { JobSummary } from "@/components/JobSummary";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import {
  JobHeading,
  JobLink,
  JobFacts,
  jobLocation,
} from "@/components/JobHeader";
import { showToast } from "@/components/notify";
import { PROGRESS_CHANGED } from "@/components/useFetchJson";
import { Markdown } from "@/components/Markdown";
import { savedRecordForRow } from "@/lib/applicationRecord";
import { STATUS_LABEL, statusColumn } from "@/lib/status";
import { longDate } from "@/lib/calendar";
import {
  STATUSES,
  type ApplicationRow,
  type SavedReviewSummary,
  type Status,
} from "@/lib/types";
import type { TrackerDetails } from "@/lib/trackerDetails";

export function AppSheet({
  row,
  disabled,
  onClose,
  onMove,
  onRemove,
  linkAction,
  initialView = "summary",
  readOnly = false,
  onEdited,
}: {
  readOnly?: boolean;
  /** Called with the saved row (its key changes when company, role, link or date is edited). */
  onEdited?: (row: ApplicationRow) => void;
  linkAction?: React.ReactNode;
  initialView?: "summary" | "review" | "activity";
  row: ApplicationRow | null;
  disabled: boolean;
  onClose: () => void;
  onMove: (s: Status, date?: string) => void;
  onRemove: () => void;
}) {
  const hideQuestions = useHideQuestions();
  const recruiting = useRecruiting();
  const opportunities = useFetchJson<OpportunityReport[]>(
    "/api/opportunities",
    { events: true },
  );
  const content = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<TrackerDetails | null>(null);
  const [view, setView] = useState<
    "summary" | "review" | "answers" | "letter" | "activity"
  >("summary");
  useEffect(() => {
    if (
      view === "activity" &&
      recruiting.data &&
      row &&
      !hasActionHistory(row, recruiting.data)
    )
      setView("summary");
  }, [view, recruiting.data, row]);
  useLayoutEffect(() => {
    // Each secondary view shares the modal scroll container; enter it at the top.
    content.current?.parentElement?.scrollTo({ top: 0 });
  }, [view]);
  const [originalOpen, setOriginalOpen] = useState(false);
  useEffect(() => {
    if (hideQuestions && (view === "answers" || view === "letter"))
      setView("summary");
  }, [hideQuestions, view]);
  const [confirm, setConfirm] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [editing, setEditing] = useState(false);
  const [appliedOn, setAppliedOn] = useState(applicationDate);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(true);
  useEffect(() => {
    if (view === "review" && !detailsLoading && !details?.review)
      setView("summary");
  }, [view, detailsLoading, details]);
  const [reviewJobs, setReviewJobs] = useState<
    import("@/lib/types").ReviewJobStatus[]
  >([]);
  useEffect(() => {
    setOriginalOpen(false);
    setDetails(null);
    setDetailsLoading(true);
    setView(initialView);
    setConfirm(false);
    setConfirmingRemove(false);
    setEditing(false);
    setError(null);
    if (!row) return;
    let live = true;
    const load = async () => {
      const progress = await fetch("/api/score/status", { cache: "no-store" });
      if (progress.ok) {
        const body = await progress.json();
        if (live) setReviewJobs(body.jobs ?? []);
      }
      const response = await fetch("/api/reviews", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load saved jobs");
      const { items } = (await response.json()) as {
        items: SavedReviewSummary[];
      };
      const saved = savedRecordForRow(row, items);
      if (!saved) {
        if (live) {
          setDetails(null);
          setDetailsLoading(false);
        }
        return;
      }
      const result = await fetch(
        `/api/tracker/details?id=${encodeURIComponent(saved.id)}`,
        { cache: "no-store" },
      );
      if (!result.ok) throw new Error("Could not load job details");
      const body = await result.json();
      if (live) {
        setDetails(body);
        setDetailsLoading(false);
      }
    };
    void load().catch((e) => live && setError(e.message));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => {});
    }, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [row?.key, row?.recordId, row?.lineIndex, initialView]);
  useEffect(() => {
    if (!row) return;
    const back = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.key !== "Backspace" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey ||
        target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      e.preventDefault();
      if (confirm) setConfirm(false);
      else if (view !== "summary") setView("summary");
      else onClose();
    };
    window.addEventListener("keydown", back);
    return () => window.removeEventListener("keydown", back);
  }, [row, view, confirm, onClose]);
  async function createReview() {
    if (
      !details ||
      starting ||
      !(details.original?.trim() || details.displayBrief)
    )
      return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRecordId: details.id }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? "Could not start review");
      }
      setConfirm(false);
      window.dispatchEvent(new Event("tracker-review-started"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start review");
    } finally {
      setStarting(false);
    }
  }
  if (!row) return null;
  const { column, legacy } = statusColumn(row.status);
  const research = opportunities.data?.filter(
    (r) =>
      r.applicationKey === row.key ||
      (!!r.recordId && r.recordId === row.recordId),
  );
  const sources = details?.contentSources ?? [];
  const hasAnswers =
    !hideQuestions &&
    sources.some((source) => source.extras?.questions?.length);
  const hasLetter =
    !hideQuestions && sources.some((source) => source.extras?.coverLetter);
  const canCreateReview = !!(
    details?.original?.trim() || details?.displayBrief
  );
  const brief = details?.displayBrief;
  const compensation = brief?.compensation?.replace(
    /^(?:salary|compensation|pay)(?:\s+range)?\s*:?\s*(?=[$€£\d])/i,
    "",
  );
  const displayDate = (date: string) =>
    date.replace(/^(\d{2})(\d{2})-(\d{2})-(\d{2})$/, "$3/$4/$2");
  const facts = [
    {
      label: "Location",
      value: jobLocation(brief?.location || "", brief?.workMode || ""),
    },
    { label: "Salary", value: compensation || "" },
    { label: "Resume", value: row.resume || "" },
    {
      label: column === "to apply" ? "Saved" : "Applied",
      value: displayDate(row.date),
    },
    ...(details?.postedAt
      ? [{ label: "Posted", value: displayDate(details.postedAt) }]
      : []),
  ];
  const link = details?.link || row.link;
  return (
    <Modal
      open
      onClose={onClose}
      width={820}
      title={
        <JobHeading
          company={row.company}
          role={row.role}
          large={view === "summary"}
        />
      }
      headerAction={
        view === "summary" && linkAction ? (
          linkAction
        ) : (
          <JobLink link={link} large={view === "summary"} />
        )
      }
    >
      <div ref={content} className="flex flex-col gap-3 pt-1">
        {hasActionHistory(row, recruiting.data) &&
          (view === "activity" || view === "summary") && (
            <nav
              aria-label="Job details views"
              className="flex gap-1 border-b pb-2"
            >
              {(
                [
                  ["summary", "Job Info"],
                  ["activity", "Timeline"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant="ghost"
                  aria-pressed={view === value}
                  className={
                    view === value
                      ? "bg-muted font-semibold"
                      : "text-muted-foreground"
                  }
                  onClick={() => setView(value)}
                >
                  {label}
                </Button>
              ))}
            </nav>
          )}
        {view === "activity" && (
          <ActivityPanel row={row} data={recruiting.data} />
        )}
        {recruiting.error && (
          <p role="alert" className="text-xs text-destructive">
            {recruiting.error}
          </p>
        )}
        {view !== "summary" && view !== "activity" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setView("summary")}
          >
            <ArrowLeftIcon /> Back to job
          </Button>
        )}
        {view === "summary" &&
          details &&
          reviewJobs
            .filter(
              (j) => j.sourceRecordId === details?.id && j.status !== "done",
            )
            .map((j) => (
              <div
                key={j.runId}
                role="status"
                className="text-sm border rounded p-3"
              >
                <p>
                  {j.status}
                  {j.step ? ` · ${j.step}` : ""}
                </p>
                {j.error && (
                  <p role="alert" className="text-destructive text-xs">
                    {j.error}
                  </p>
                )}
                {["error", "interrupted", "paused", "cancelled"].includes(
                  j.status,
                ) && (
                  <Button
                    size="xs"
                    onClick={() =>
                      void fetch("/api/score/resume", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ runId: j.runId }),
                      })
                        .then(async (r) => {
                          if (!r.ok) throw new Error("Could not retry review");
                        })
                        .catch((e) => setError(e.message))
                    }
                  >
                    Retry review
                  </Button>
                )}
              </div>
            ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {confirm && details && (
          <section
            className="rounded-xl border border-warning/40 p-4 space-y-3"
            role="region"
            aria-label="Confirm review"
          >
            <p>
              Create a review for {row.company || "Unknown"} ·{" "}
              {row.role || "Unknown"}?
            </p>
            <p className="text-sm">
              Model: {details.reviewModel} · Resume: {details.resume}
            </p>
            {!details.original && (
              <p className="text-sm text-warning">
                Only the saved summary is available. The review will use that
                summary.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={starting}
                onClick={() => void createReview()}
              >
                {starting ? "Starting…" : "Confirm review"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={starting}
                onClick={() => setConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </section>
        )}
        {view === "review" && details?.review && (
          <ReviewWorkspace
            readOnly={readOnly}
            key={details.review.runId}
            result={details.review}
            extrasModel={details.extrasModel}
            tailorModel={details.tailorModel}
            onClose={onClose}
            onIdentityChanged={(review) =>
              setDetails((current) =>
                current?.review?.runId === review.runId
                  ? { ...current, review }
                  : current,
              )
            }
            onViewSummary={() => setView("summary")}
            onChange={() => window.dispatchEvent(new Event(PROGRESS_CHANGED))}
            offerUndo={(message, undoId) =>
              showToast(message, {
                label: "Undo",
                onClick: () => {
                  void fetch("/api/applications/undo", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                      Array.isArray(undoId) ? { undoIds: undoId } : { undoId },
                    ),
                  })
                    .then(async (response) => {
                      if (!response.ok)
                        throw new Error("Could not undo application change");
                      window.dispatchEvent(new Event(PROGRESS_CHANGED));
                      showToast("Undone.");
                    })
                    .catch((error) => showToast(error.message));
                },
              })
            }
          />
        )}
        {!hideQuestions && (view === "answers" || view === "letter") && (
          <article className="space-y-6">
            {sources
              .filter((source) =>
                view === "answers"
                  ? source.extras?.questions?.length
                  : source.extras?.coverLetter,
              )
              .map((source) => (
                <section key={source.id} className="space-y-4">
                  {sources.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                      {source.label}
                    </p>
                  )}
                  {view === "answers" &&
                    [...(source.extras?.questions ?? [])]
                      .reverse()
                      .map((set, i) => (
                        <section key={i} className="space-y-3">
                          <h2 className="font-semibold">
                            Saved answers · {longDate(set.at.slice(0, 10))}
                          </h2>
                          {set.note && (
                            <p className="text-sm text-muted-foreground">
                              {set.note}
                            </p>
                          )}
                          {set.result.answers.map((answer, j) => (
                            <div key={j}>
                              <h3 className="font-medium">{answer.question}</h3>
                              <ol className="list-decimal pl-5 space-y-2">
                                {answer.options.map((option, k) => (
                                  <li key={k} className="whitespace-pre-wrap">
                                    {option}
                                  </li>
                                ))}
                              </ol>
                              {answer.needsUser && (
                                <p>Needs you: {answer.needsUser}</p>
                              )}
                            </div>
                          ))}
                        </section>
                      ))}
                  {view === "letter" && source.extras?.coverLetter && (
                    <section>
                      <h2 className="font-semibold">Saved cover letter</h2>
                      <p className="whitespace-pre-wrap leading-7">
                        {source.extras.coverLetter.result.letter}
                      </p>
                    </section>
                  )}
                </section>
              ))}
          </article>
        )}
        {view === "summary" && editing && (
          <ApplicationEditor
            row={row}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => {
              setEditing(false);
              onEdited?.(updated);
              showToast("Application updated");
            }}
          />
        )}
        {view === "summary" && !editing && (
          <>
            <JobFacts source={row.source} facts={facts} large />
            {details?.tailoredPdf && (
              <a
                className="text-xs text-primary hover:underline"
                href={`/api/files?path=${encodeURIComponent(details.tailoredPdf)}`}
                target="_blank"
                rel="noreferrer"
              >
                Resume PDF ↗
              </a>
            )}
            {details?.review && (
              <Button
                size="sm"
                variant="success"
                className="w-full"
                onClick={() => setView("review")}
              >
                <CheckIcon />
                View review
              </Button>
            )}
            {research?.map((r) => (
              <p key={r.id} className="text-sm">
                <Link
                  className="underline"
                  href={`/guide/records/opportunities/${r.id}.md`}
                >
                  Opportunity Check · {r.depth} · {r.researchedAt.slice(0, 10)}
                </Link>
              </p>
            ))}
            {!detailsLoading && !details && !error && (
              <p className="text-sm text-muted-foreground">
                No saved job summary is available for this application.
              </p>
            )}
            {!detailsLoading && !details?.review && !canCreateReview && (
              <p className="text-xs text-muted-foreground">
                A saved job description or summary is needed to create a review.
              </p>
            )}
            <JobSummary brief={brief} loading={detailsLoading && !error} />
            <nav
              className="flex flex-wrap items-center gap-1 border-t pt-3 [&_button]:h-7 [&_button]:px-2 [&_button]:text-xs"
              aria-label="Job actions"
            >
              {details && !details.review && canCreateReview && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirm(true)}
                >
                  <SparklesIcon />
                  Create review
                </Button>
              )}
              {!hideQuestions && (hasAnswers || hasLetter) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      <FileTextIcon />
                      Saved
                      <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {hasAnswers && (
                      <DropdownMenuItem onSelect={() => setView("answers")}>
                        View saved answers
                      </DropdownMenuItem>
                    )}
                    {hasLetter && (
                      <DropdownMenuItem onSelect={() => setView("letter")}>
                        View cover letter
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {!readOnly && details && !hideQuestions && (
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`/apply?questions=${encodeURIComponent(details.id)}`}
                  >
                    <SparklesIcon />
                    Questions
                  </a>
                </Button>
              )}
              {details?.original && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={originalOpen}
                  aria-controls="original-paste"
                  onClick={() => setOriginalOpen((value) => !value)}
                >
                  View pasted
                  <ChevronDownIcon />
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => setEditing(true)}
              >
                <PencilIcon />
                Edit
              </Button>
              {!readOnly && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        aria-label="Change status"
                      >
                        {STATUS_LABEL[column]}
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {column === "to apply" && (
                        <label className="block px-2 py-1 text-xs text-muted-foreground">
                          Submit date
                          <Input
                            type="date"
                            className="mt-1 h-7 text-xs"
                            value={appliedOn}
                            max={localDate()}
                            onChange={(e) =>
                              setAppliedOn(e.target.value || applicationDate())
                            }
                            onKeyDown={(e) => e.stopPropagation()}
                            aria-label="Submit date"
                          />
                        </label>
                      )}
                      <DropdownMenuRadioGroup
                        value={column}
                        onValueChange={(value) => {
                          const status = value as Status;
                          if (status !== row.status)
                            onMove(
                              status,
                              column === "to apply" && status === "applied"
                                ? appliedOn
                                : undefined,
                            );
                        }}
                      >
                        {STATUSES.map((status) => (
                          <DropdownMenuRadioItem key={status} value={status}>
                            {STATUS_LABEL[status]}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      {legacy !== null && (
                        <p className="px-2 py-1 text-xs text-muted-foreground">
                          Previously saved as {legacy || "empty"}
                        </p>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={disabled}
                    onClick={() => setConfirmingRemove(true)}
                  >
                    Remove entry
                  </Button>
                </>
              )}
            </nav>
            {details?.original && (
              <div
                id="original-paste"
                hidden={!originalOpen}
                className="border-t pt-3"
              >
                <h2 className="mb-2 text-sm font-semibold">
                  Original pasted description
                </h2>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                  {details.original}
                </p>
              </div>
            )}
            {row.next && (
              <p className="text-xs">
                <span className="font-medium text-muted-foreground">
                  Next ·{" "}
                </span>
                {row.next}
              </p>
            )}
            {confirmingRemove && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
                <span className="mr-auto">
                  Remove this application? Saved reviews are kept.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmingRemove(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={disabled}
                  onClick={onRemove}
                >
                  Remove
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
