"use client";
import { toast } from "sonner";
import {
  savedHistoryFilter,
  type HistoryFilter,
} from "@/lib/reviewPresentation";
import type { Preferences } from "@/lib/preferences";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ModelSettings, PREFERENCES_CHANGED } from "@/components/ModelSettings";
import { useSubmissionConfirmation } from "@/components/apply/useSubmissionConfirmation";
import {
  QuickBellPopover,
  QuickTopStatusBar,
} from "@/components/apply/QuickBatchComponents";
import { useQuickAdd } from "@/components/apply/useQuickAdd";
import {
  QuickMissingInfo,
  useMissingJobs,
} from "@/components/apply/QuickMissingInfo";
import {
  MIN_QUICK,
  draftLabel,
  hasContent,
  useQuickDrafts,
  type QuickDraft,
} from "@/components/apply/useQuickDrafts";
import { QuickAddTab } from "@/components/apply/QuickAddTab";
import type { ExistingQuickLink } from "@/components/apply/QuickJobList";
import { QuestionsTab } from "@/components/apply/QuestionsTab";
import { ReviewQueue } from "@/components/apply/ReviewQueue";
import { ReviewTab } from "@/components/apply/ReviewTab";
import {
  useApplyHistory,
  useApplyRestoration,
  lsGet,
  lsSet,
} from "@/components/apply/useApplyHistory";
import { useReviewJobs } from "@/components/apply/useReviewJobs";
import { useWorkflow } from "@/components/apply/useWorkflow";
import { useCallback, useEffect, useRef, useState } from "react";
import { duplicateLine } from "@/components/ReviewCard";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { QuickBatchSummary, QuickView } from "@/components/QuickAddCard";
import ExtrasPanel, {
  NO_EXTRAS,
  wantsExtras,
  type ExtrasAsk,
} from "@/components/ExtrasPanel";
import ReviewHistory from "@/components/ReviewHistory";
import {
  QuickSummaryModal,
  type QuickSummaryTarget,
} from "@/components/QuickSummaryModal";
import { PanelRightCloseIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Modal } from "@/components/Modal";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SubmitShortcut } from "@/components/SubmitShortcut";
import { showToast } from "@/components/notify";
import { PROGRESS_CHANGED, useFetchJson } from "@/components/useFetchJson";
import { AppliedStats } from "@/components/AppliedStats";
import type { UndoRestore } from "@/components/apply/undo";
import { SOURCES, readApiError } from "@/components/applyHelpers";
import {
  MAX_QUICK,
  MAX_QUICK_BATCH_CHARS,
  MAX_QUICK_JOB_CHARS,
  type Provider,
} from "@/lib/config";
import {
  DEFAULT_EXTRAS_MODEL,
  DEFAULT_REVIEW_MODEL,
  DEFAULT_TAILOR_MODEL,
} from "@/lib/types";
import type {
  ApplicationRow,
  DuplicateReport,
  HistoryItem,
  ModelId,
  Progress,
  ScoreResult,
} from "@/lib/types";
import type { QuickBatchListItem } from "@/lib/quickState";

// Both Quick add and Review share the last source picked (a pasted link never overrides it).
const SOURCE_KEY = "career-ui.apply.source";
function lastSource(): string {
  const s = lsGet<string>(SOURCE_KEY);
  return s && (SOURCES as readonly string[]).includes(s) ? s : "Other";
}
const OPEN_KEY = "career-ui.apply.open"; // the item on screen, reopened after a refresh
const HISTORY_FILTER_KEY = "career-ui.apply.history-filter";
const MIN_POST = 200; // matches the review API's jobPost minimum

type Tab = "quick" | "review" | "questions";
const TAB_INTRO: Record<Tab, string> = {
  quick:
    "Paste each job's URL and description. Quick add logs them all as applied today.",
  review:
    "Paste the job description (and its URL, if you have it) to check fit before you apply.",
  questions:
    "Answer application questions or write a cover letter for a job you already logged.",
};

export default function ApplyPage() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("chatgpt");
    if (!result) return;
    url.searchParams.delete("chatgpt");
    window.history.replaceState(null, "", url);
    if (result === "connected")
      toast.success(
        "ChatGPT plan connected. Open Models to check your connection.",
      );
    else
      toast.error(
        result === "permission"
          ? "ChatGPT signed in without plan access."
          : "ChatGPT connection could not be completed. Try again from Models.",
      );
  }, []);

  const [tab, setActiveTab] = useState<Tab>("quick");
  const tabRevision = useRef(0);
  function setTab(next: Tab) {
    tabRevision.current++;
    setActiveTab(next);
  }
  // Record id from the Tracker's "Answer application questions" link (/apply?questions=<id>).
  // New must also clear a job picked locally inside QuestionsTab, without a deep-link ID.
  const [questionsReset, setQuestionsReset] = useState(0);
  const [questionsFor, setQuestionsFor] = useState<string | null>(null);
  const [jobPost, setJobPost] = useState("");
  const [link, setLink] = useState("");
  const [source, setSource] = useState<string>("Other");
  useEffect(() => setSource(lastSource()), []);
  // Applied totals above the form; refreshed by PROGRESS_CHANGED after every log or undo.
  const progress = useFetchJson<Progress>("/api/progress", { events: true });
  const applications = useFetchJson<{ rows: ApplicationRow[] }>(
    "/api/applications",
    { events: true },
  );
  // Provider and models are chosen in Settings; re-read them whenever it saves.
  useEffect(() => {
    const load = () =>
      void fetch("/api/preferences", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error("Could not load preferences");
          return r.json();
        })
        .then((p: Preferences) => {
          setProvider(p.provider);
          setModel(p.selections[p.provider].review);
          setTailorModel(p.selections[p.provider].tailor);
          setExtrasModel(p.selections[p.provider].extras);
        })
        .catch((e) => setError(String(e)));
    load();
    window.addEventListener(PREFERENCES_CHANGED, load);
    return () => window.removeEventListener(PREFERENCES_CHANGED, load);
  }, []);
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<ModelId>(DEFAULT_REVIEW_MODEL);

  const [tailorModel, setTailorModel] = useState<ModelId>(DEFAULT_TAILOR_MODEL);
  const [extrasModel, setExtrasModel] = useState<ModelId>(DEFAULT_EXTRAS_MODEL);
  // The queued Quick add jobs (one card each), kept until they are added.
  const quickDrafts = useQuickDrafts();
  const quickDraftsRef = useRef(quickDrafts.drafts);
  quickDraftsRef.current = quickDrafts.drafts;
  // Quick add's optional questions: typed before adding, answered for the chosen job once it's logged.
  const [quickQuestionsOpen, setQuickQuestionsOpen] = useState(false);
  const [quickAsk, setQuickAsk] = useState<ExtrasAsk>(NO_EXTRAS);
  const [extrasDraftId, setExtrasDraftId] = useState<string | null>(null);
  const [quickExtras, setQuickExtras] = useState<{
    id: string;
    ask: ExtrasAsk;
  } | null>(null);
  const [quickExtrasNote, setQuickExtrasNote] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  // Status from the history when an earlier review is reopened ("applied", "skipped", …).
  const [openStatus, setOpenStatus] = useState<string | null>(null);
  // Exact duplicate found before scoring (no Claude call was made).
  const [dupStop, setDupStop] = useState<DuplicateReport | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [summaryItem, setSummaryItem] = useState<QuickSummaryTarget | null>(
    null,
  );
  const [historyFilter, setHistoryFilter] =
    useState<HistoryFilter>("summaries");
  useEffect(
    () => setHistoryFilter(savedHistoryFilter(lsGet(HISTORY_FILTER_KEY))),
    [],
  );
  const [historyKey, setHistoryKey] = useState(0);
  const [wide, setWide] = useState(true);
  const refreshHistory = useCallback(() => setHistoryKey((k) => k + 1), []);
  const setToast = (message: string | null) => showToast(message);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const workflow = useWorkflow();
  const {
    quickBatches,
    quickSummary,
    setQuickSummary,
    quickBusy,
    quickView,
    setQuickView,
    quickAdd,
    cancelBatch,
    retryBatch,
    markBatchesViewed,
    markBatchUndone,
    dismissBatchTop,
  } = useQuickAdd({
    removeDrafts: quickDrafts.removeIds,
    restoreDrafts: (back) => quickDrafts.restore(back, true),
    source,
    provider,
    setError,
    setResult,
    setDupStop,
    refreshHistory,
    resetForm,
    setToast,
    offerUndo,
    workflow,
  });
  // Jobs whose post did not name the company or role, until the workspace owner fixes or confirms them.
  const missing = useMissingJobs(quickBatches, applications.data?.rows);

  useEffect(() => {
    return () => {
      void fetch("/api/quick/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss-top" }),
      }).catch(() => {});
    };
  }, []);

  // Remembered model choices, the desktop/phone layout switch, and the
  // Tracker's deep link into the Questions tab.
  useEffect(() => {
    const t = setTimeout(() => {
      // Each desktop visit opens History. On phones the sheet starts closed.
      setSource(lastSource());
      setHistoryOpen(window.matchMedia("(min-width: 1024px)").matches);
      const params = new URLSearchParams(window.location.search);
      const target = params.get("questions");
      if (target && /^[A-Za-z0-9-]{8,64}$/.test(target)) {
        setQuestionsFor(target);
        setTab("questions");
      }
      if (params.has("questions"))
        window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = () => {
      setWide(mq.matches);
      if (!mq.matches) setHistoryOpen(false);
    };
    onMq();
    mq.addEventListener("change", onMq);
    return () => {
      clearTimeout(t);
      mq.removeEventListener("change", onMq);
    };
  }, []);
  function changeSource(s: string) {
    setSource(s);
    lsSet(SOURCE_KEY, s);
  }
  function toggleHistory() {
    setHistoryOpen((open) => !open);
  }

  const { pendingFrom, markPendingApplied } = useSubmissionConfirmation({
    result,
    resume: "tech",
    source,
    link,
    tailored: null,
    refreshHistory,
    resetForm,
    setError,
    setToast,
    offerUndo,
    workflow,
  });
  const { openItem, isOpening } = useApplyHistory({
    workflow,
    setDupStop,
    setQuickSummary,
    setError,
    setResult,
    setQuickView,
    setOpenStatus,
    setJobPost,
    setLink,
  });
  /** Open a saved item and show it on its tab. */
  async function showItem(
    id: string,
    status: string | null = null,
    canOpen?: () => boolean,
  ) {
    const kind = await openItem(id, status, canOpen);
    if (kind) {
      setTab(kind);
      if (kind === "review")
        requestAnimationFrame(() =>
          document
            .getElementById("completed-review")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
    }
  }

  const {
    jobs: reviewJobs,
    submitting: reviewSubmitting,
    score,
    control: controlReview,
  } = useReviewJobs({
    onCompleted: (id) => {
      if (tab !== "review" || result || dupStop || isOpening()) return;
      const revision = tabRevision.current;
      void showItem(id, null, () => tabRevision.current === revision).catch(
        () => {
          // The completed result stays available through View review.
        },
      );
    },
    onAccepted: () => {
      setJobPost((current) => (current === jobPost ? "" : current));
      setLink((current) => (current === link ? "" : current));
    },
    jobPost,
    model,
    link,
    source,
    refreshHistory,
    setError,
    setDupStop,
  });

  useApplyRestoration({
    openItem,
    workflow,
    onRestored: setTab,
  });

  /** Show the "Logged" toast with an Undo that reverses the log and puts the job back on screen. */
  function offerUndo(
    message: string,
    undoId: string | string[],
    restore: UndoRestore,
  ) {
    showToast(message, {
      label: "Undo",
      onClick: () => void undoLast(undoId, restore),
    });
  }
  async function undoLast(undoId: string | string[], restore: UndoRestore) {
    const res = await fetch("/api/applications/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Array.isArray(undoId) ? { undoIds: undoId } : { undoId },
      ),
    }).catch((e: unknown) => e as Error);
    if (res instanceof Error) return setToast(`Couldn't undo: ${res.message}`);
    if (!res.ok)
      return setToast(`Couldn't undo: ${(await readApiError(res)).message}`);
    const { failed = 0 } = (await res.json().catch(() => ({}))) as {
      failed?: number;
    };
    window.dispatchEvent(new Event(PROGRESS_CHANGED));
    refreshHistory();
    if (restore.batchId) markBatchUndone(restore.batchId);
    if (restore.runId) void showItem(restore.runId);
    else if (restore.jobPost) setJobPost(restore.jobPost);
    const hasActiveDraft = quickDraftsRef.current.some(hasContent);
    if (restore.quickDrafts?.length && !hasActiveDraft) {
      quickDrafts.restore(restore.quickDrafts);
      setTab("quick");
    }
    if (!restore.runId) {
      if (restore.link) setLink(restore.link);
      if (restore.source) setSource(restore.source);
    }
    setQuickSummary(null);
    setToast(
      failed
        ? `Undone, except ${failed} edited or expired (change those in the Tracker).`
        : restore.quickDrafts?.length && hasActiveDraft
          ? "Undone · click Restore to editor when ready."
          : "Undone.",
    );
  }

  // Status lists leave out the pasted job text; restoring or undoing reads this one batch in full.
  async function batchJobs(batchId: string) {
    const response = await fetch(
      `/api/quick/status?batchId=${encodeURIComponent(batchId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("Could not load the batch's jobs.");
    return ((await response.json()).batch.jobs ?? []) as {
      link?: string;
      description: string;
    }[];
  }

  async function restoreBatchToEditor(
    batch: QuickBatchListItem,
    mode: "all" | "remaining",
  ) {
    let jobs;
    try {
      jobs = await batchJobs(batch.batchId);
    } catch (e) {
      setToast((e as Error).message);
      return;
    }
    const remSet = new Set(batch.remaining);
    const selected =
      mode === "remaining" ? jobs.filter((_, i) => remSet.has(i + 1)) : jobs;
    if (!selected.length) return;
    quickDrafts.restore(
      selected.map((j) => ({
        id: Math.random().toString(36).slice(2, 10),
        submissionId: crypto.randomUUID(),
        url: j.link ?? "",
        description: j.description,
      })),
    );
    dismissBatchTop(batch.batchId);
    setTab("quick");
    setToast("Restored to editor.");
  }

  async function undoBatchFromUi(batch: QuickBatchListItem) {
    if (!batch.added.length) return;
    let jobs;
    try {
      jobs = await batchJobs(batch.batchId);
    } catch (e) {
      setToast((e as Error).message);
      return;
    }
    const addedNumbers = new Set(batch.added.map((a) => a.job));
    void undoLast(
      batch.added.map((a) => a.undoId),
      {
        batchId: batch.batchId,
        quickDrafts: jobs
          .filter((_, i) => addedNumbers.has(i + 1))
          .map((j) => ({
            id: Math.random().toString(36).slice(2, 10),
            submissionId: crypto.randomUUID(),
            url: j.link ?? "",
            description: j.description,
          })),
      },
    );
  }

  function resetForm() {
    setQuestionsFor(null);
    setQuestionsReset((value) => value + 1);
    workflow.begin("idle");
    setQuickExtras(null);
    setQuickExtrasNote(null);
    dismissBatchTop();

    setResult(null);
    setOpenStatus(null);
    setQuickSummary(null);
    setQuickView(null);
    setDupStop(null);
    lsSet(OPEN_KEY, null);
    setError(null);
    setTimeout(() => textarea.current?.focus(), 0);
  }

  // Quick add sends every card with something in it; each needs a real description.
  const queued = quickDrafts.drafts.filter(hasContent);
  const shortCard = quickDrafts.drafts.findIndex(
    (d) => hasContent(d) && d.description.trim().length < MIN_QUICK,
  );
  const longCard = quickDrafts.drafts.findIndex(
    (d) => d.description.trim().length > MAX_QUICK_JOB_CHARS,
  );
  const quickChars = queued.reduce(
    (n, d) => n + d.description.trim().length,
    0,
  );
  const quickBlocked = !queued.length
    ? "Add a job description first"
    : queued.length > MAX_QUICK
      ? `Up to ${MAX_QUICK} jobs per batch; remove ${queued.length - MAX_QUICK}`
      : shortCard >= 0
        ? `Job ${shortCard + 1} needs at least ${MIN_QUICK} characters of description`
        : longCard >= 0
          ? `Job ${longCard + 1} is over ${MAX_QUICK_JOB_CHARS.toLocaleString("en-US")} characters; shorten or split it`
          : quickChars > MAX_QUICK_BATCH_CHARS
            ? `Split into batches of up to ${MAX_QUICK_BATCH_CHARS.toLocaleString("en-US")} description characters`
            : null;
  const reviewBlocked =
    jobPost.trim().length < MIN_POST
      ? `Paste at least ${MIN_POST} characters of the job description`
      : null;
  // The job the questions / cover letter are for: the only card, else the one picked (default: last).
  const extrasDraft =
    queued.find((d) => d.id === extrasDraftId) ?? queued[queued.length - 1];
  // The job on screen was already applied to: the button stays clickable but looks secondary.
  const APPLIED = [
    "applied",
    "in progress",
    "no response",
    "rejected",
    "unsuccessful",
  ];
  const alreadyApplied = APPLIED.includes(openStatus ?? "");

  /**
   * Quick add every queued card. If questions or a letter were asked for, write them for the
   * chosen job once it's logged (the Extras panel under the summary makes that call).
   */
  async function quickAddWithExtras(sent: QuickDraft[]) {
    const ask = quickAsk;
    const target =
      quickQuestionsOpen && wantsExtras(ask) ? extrasDraft : undefined;
    const label = target
      ? draftLabel(target, quickDrafts.drafts.indexOf(target) + 1)
      : "";
    const summary = await quickAdd(sent);
    if (!summary || !target) return;
    const number = sent.indexOf(target) + 1;
    if (!number) return;
    const added = summary.added.find((a) => a.job === number);
    if (added) {
      setQuickExtras({ id: added.quickId, ask });
      setQuickAsk(NO_EXTRAS);
      setQuickQuestionsOpen(false);
      setExtrasDraftId(null);
    } else if (!summary.remaining.includes(number))
      setQuickExtrasNote(
        `Questions not answered: ${label} wasn't added (see Skipped). If it's already in the tracker, answer them from the Questions tab.`,
      );
  }

  const submitQuick = () => {
    if (!quickBlocked && !quickBusy) void quickAddWithExtras(queued);
  };
  const submitReview = () => {
    if (!reviewBlocked) void score(false);
  };

  const quickButton = (
    <Button
      size="lg"
      onClick={submitQuick}
      disabled={quickBusy || !!quickBlocked}
      title={quickBlocked ?? ""}
    >
      {quickBusy ? (
        <>
          <Spinner data-icon="inline-start" aria-hidden />
          Adding…
        </>
      ) : (
        <>
          Quick add{queued.length > 1 ? ` (${queued.length})` : ""}
          <SubmitShortcut />
        </>
      )}
    </Button>
  );
  const reviewButton = (
    <Button
      size="lg"
      variant={alreadyApplied ? "outline" : "default"}
      onClick={submitReview}
      disabled={reviewSubmitting || !!reviewBlocked}
      title={
        reviewBlocked ??
        (alreadyApplied
          ? "Already applied to this job (you can still run it again)"
          : "")
      }
    >
      {reviewSubmitting ? "Queuing…" : "Review job"}
      <SubmitShortcut />
    </Button>
  );

  const history = (
    <ReviewHistory
      filter={historyFilter}
      onFilter={(filter) => {
        setHistoryFilter(filter);
        lsSet(HISTORY_FILTER_KEY, filter);
      }}
      refreshKey={historyKey}
      activeId={result?.runId ?? quickView?.record.id ?? null}
      onOpen={(item: HistoryItem) => {
        if (!wide) setHistoryOpen(false);
        if (historyFilter === "summaries" || item.kind === "quick") {
          setSummaryItem(item);
          return;
        }
        setTab("review");
        void showItem(item.id, item.status);
      }}
    />
  );

  return (
    <div
      className={
        historyOpen && wide
          ? "grid grid-cols-[minmax(0,1fr)_280px] items-start gap-7"
          : ""
      }
    >
      {summaryItem && (
        <QuickSummaryModal
          key={summaryItem.id}
          item={summaryItem}
          onClose={() => setSummaryItem(null)}
        />
      )}
      {historyOpen && wide && (
        <aside className="sticky top-20 col-start-2 row-start-1 flex h-[calc(100vh-7rem)] flex-col rounded-xl border bg-card p-2.5">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold">History</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleHistory}
              aria-label="Hide history"
              title="Hide history"
            >
              <PanelRightCloseIcon />
            </Button>
          </div>
          {history}
        </aside>
      )}
      {!wide && (
        <Modal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          title="History"
          width={360}
        >
          <div className="h-[70vh]">{history}</div>
        </Modal>
      )}
      <div className="col-start-1 row-start-1 mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Apply</h1>
            <p className="text-sm text-muted-foreground">{TAB_INTRO[tab]}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <QuickBellPopover
              batches={quickBatches}
              onOpenSummary={(target) => setSummaryItem(target)}
              onMarkViewed={() => markBatchesViewed()}
              missingCount={missing.jobs.length}
            />
            {!(historyOpen && wide) && (
              <Button variant="outline" onClick={toggleHistory}>
                History
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setTab("quick");
                setSource(lastSource());
              }}
              title="Clear the page for a new job post"
            >
              New
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Model settings">
                Models
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-[75vh] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto"
            >
              <ModelSettings />
            </PopoverContent>
          </Popover>
          <SegmentedControl
            ariaLabel="Mode"
            value={tab}
            onChange={(t) => {
              if (tab === "quick" && t !== "quick") dismissBatchTop();
              setTab(t as Tab);
            }}
            options={[
              { value: "quick", label: "Quick add" },
              { value: "review", label: "Review" },
              { value: "questions", label: "Questions" },
            ]}
          />
        </div>

        {progress.data ? (
          <Card size="sm">
            <CardContent>
              <AppliedStats progress={progress.data} compact />
            </CardContent>
          </Card>
        ) : null}

        {/* Quick Add progress and result sit directly under the All time / This week / Today stats. */}
        <QuickMissingInfo jobs={missing.jobs} onResolved={missing.resolve} />
        <QuickTopStatusBar
          batches={quickBatches}
          onOpenSummary={(target) => setSummaryItem(target)}
          onUndo={undoBatchFromUi}
          onRestore={restoreBatchToEditor}
          onRetry={retryBatch}
          onCancel={cancelBatch}
          onDismissTop={(id) => dismissBatchTop(id)}
        />

        {tab === "questions" ? (
          <QuestionsTab
            key={questionsReset}
            model={extrasModel}
            preselectId={questionsFor}
            onClear={() => setQuestionsFor(null)}
          />
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-4">
              {tab === "quick" ? (
                <QuickAddTab
                  drafts={quickDrafts.drafts}
                  queued={queued}
                  busy={quickBusy}
                  existingLinks={[
                    ...(applications.data?.rows
                      .filter((r) => !!r.link)
                      .map((r): ExistingQuickLink => ({
                        link: r.link,
                        label: `${r.company} — ${r.role} (${r.status})`,
                      })) ?? []),
                    ...quickBatches
                      .filter(
                        (b) => b.status === "running" || b.status === "queued",
                      )
                      .flatMap((b) =>
                        (b.jobLinks ?? []).map((link): ExistingQuickLink => ({
                          link,
                          label: "In active Quick Add batch",
                        })),
                      ),
                  ]}
                  onUpdate={quickDrafts.update}
                  onAdd={quickDrafts.add}
                  onRemove={(id) => quickDrafts.removeIds([id])}
                  onSubmit={submitQuick}
                  source={source}
                  onSource={changeSource}
                  questionsOpen={quickQuestionsOpen}
                  onQuestionsOpen={setQuickQuestionsOpen}
                  ask={quickAsk}
                  onAsk={setQuickAsk}
                  extrasDraft={extrasDraft}
                  onExtrasDraft={setExtrasDraftId}
                  submitButton={quickButton}
                />
              ) : (
                <ReviewTab
                  textareaRef={textarea}
                  jobPost={jobPost}
                  onJobPost={setJobPost}
                  link={link}
                  onLink={setLink}
                  source={source}
                  onSource={changeSource}
                  minChars={MIN_POST}
                  onSubmit={submitReview}
                  submitButton={reviewButton}
                  progress={
                    <ReviewQueue
                      jobs={reviewJobs}
                      onView={(id) => void showItem(id)}
                      onControl={controlReview}
                    />
                  }
                />
              )}
              {error && (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertDescription>
                    {error}
                    {error !== "Cancelled." && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={tab === "quick" ? submitQuick : submitReview}
                      >
                        Retry
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "review" && dupStop && (
          <Card className="animate-rise">
            <CardHeader>
              <CardTitle asChild className="text-lg font-semibold">
                <h2>Matching saved records</h2>
              </CardTitle>
              <CardDescription>
                This link matches an existing application or saved review.
                Nothing was scored (no Claude call).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {[...dupStop.exact, ...dupStop.possible].map((m, i) => (
                  <li key={i}>
                    {duplicateLine(m)}
                    {m.reviewPath ? (
                      <a
                        className="ml-2 text-primary underline-offset-4 hover:underline"
                        href={`/guide/${m.reviewPath}`}
                      >
                        open review
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={resetForm}>
                Stop here
              </Button>
              {pendingFrom(dupStop) && (
                <Button
                  onClick={() => markPendingApplied(pendingFrom(dupStop)!.key)}
                >
                  Mark applied today
                </Button>
              )}
              <Button variant="outline" onClick={() => score(true)}>
                Review anyway
              </Button>
            </CardFooter>
          </Card>
        )}
        {tab === "review" && result && (
          <ReviewWorkspace
            key={result.runId}
            result={result}
            extrasModel={extrasModel}
            tailorModel={tailorModel}
            offerUndo={offerUndo}
            onClose={resetForm}
            onChange={refreshHistory}
            onIdentityChanged={setResult}
          />
        )}

        {tab === "quick" && quickSummary && (
          <QuickBatchSummary
            summary={quickSummary}
            onClose={() => {
              setQuickSummary(null);
              setQuickExtras(null);
              setQuickExtrasNote(null);
            }}
          />
        )}

        {tab === "quick" && quickExtrasNote && (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>{quickExtrasNote}</AlertDescription>
          </Alert>
        )}

        {tab === "quick" && quickExtras && (
          <ExtrasPanel
            key={quickExtras.id}
            target={{ kind: "quick", id: quickExtras.id }}
            model={extrasModel}
            autoStart={quickExtras.ask}
          />
        )}

        {tab === "quick" && quickView && (
          <>
            <QuickView
              record={quickView.record}
              status={quickView.status}
              onClose={() => {
                setQuickView(null);
                lsSet(OPEN_KEY, null);
              }}
            />
            <ExtrasPanel
              key={quickView.record.id}
              target={{ kind: "quick", id: quickView.record.id }}
              model={extrasModel}
            />
          </>
        )}
      </div>
    </div>
  );
}
