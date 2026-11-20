"use client";
import { useEffect, useRef, useState } from "react";
import type {
  ModelId,
  ResumeCategory,
  ScoreResult,
  TailorResult,
  Status,
  ApplicationsPayload,
} from "@/lib/types";
import type { ReviewContext } from "@/lib/reviewContext";
import type { OfferUndo } from "./apply/undo";
import { useWorkflow } from "./apply/useWorkflow";
import { useTailoring } from "./apply/useTailoring";
import { useSubmissionConfirmation } from "./apply/useSubmissionConfirmation";
import { lsSet } from "./apply/useApplyHistory";
import { PROGRESS_CHANGED } from "./useFetchJson";
import type { JobIdentityField } from "@/lib/jobIdentity";
import { readApiError, tailorPassed } from "./applyHelpers";
import { showToast } from "./notify";
import ReviewCard, { ReviewJobFacts } from "./ReviewCard";
import { JobSummary } from "./JobSummary";
import { JobHeading, JobLink } from "./JobHeader";
import { Modal } from "./Modal";
import ReviewFollowUp from "./ReviewFollowUp";
import TailorPanel from "./TailorPanel";
import ExtrasPanel from "./ExtrasPanel";
import { Button } from "./ui/button";

/** Shared review controller: both entry points keep the same actions, selected resume and panels. */
export function ReviewWorkspace({
  result: initialResult,
  readOnly = false,
  extrasModel,
  tailorModel,
  offerUndo,
  onClose,
  onChange,
  onViewSummary,
  onIdentityChanged,
}: {
  result: ScoreResult;
  readOnly?: boolean;
  extrasModel: ModelId;
  tailorModel: ModelId;
  offerUndo: OfferUndo;
  onClose: () => void;
  onChange: () => void;
  onViewSummary?: () => void;
  onIdentityChanged?: (result: ScoreResult) => void;
}) {
  const [correctedResult, setCorrectedResult] = useState<ScoreResult | null>(
    null,
  );
  const result = correctedResult ?? initialResult;
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<string>(result.resume);
  const [bases, setBases] = useState<Record<string, ResumeCategory>>({});
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const followUpRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (followUpOpen)
      followUpRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [followUpOpen]);
  useEffect(() => {
    if (questionsOpen)
      questionsRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [questionsOpen]);
  const initialized = useRef(false);
  const contextRevision = useRef(0);
  const workflow = useWorkflow();
  useEffect(
    () => () => {
      workflow.begin("idle");
    },
    [workflow],
  );
  const tailoring = useTailoring({
    resume,
    setResume,
    tailoredBases: bases,
    setTailoredBases: setBases,
    setToast: showToast,
  });
  const { setTailored, setTailorOpen, setTailorJob } = tailoring;
  useEffect(() => {
    let live = true;
    const load = async () => {
      const revision = contextRevision.current;
      const response = await fetch(
        `/api/runs/${encodeURIComponent(result.runId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Could not refresh review details");
      const payload = (await response.json()) as {
        context: ReviewContext;
        tailor?: { result?: TailorResult };
        result: ScoreResult;
      };
      if (!live || revision !== contextRevision.current) return;
      setContext(payload.context);
      if (!initialized.current) {
        initialized.current = true;
        const existing = payload.tailor?.result;
        if (existing) {
          setTailored(existing);
          setTailorOpen(true);
          if (tailorPassed(existing)) {
            setBases({ [`tailored/${existing.slug}`]: result.resume });
            setResume(`tailored/${existing.slug}`);
          }
        }
        // Reattach an unfinished tailor operation rather than starting another model call.
        try {
          const saved = JSON.parse(
            localStorage.getItem("career-ui.apply.tailor") || "null",
          );
          if (saved?.runId === result.runId) {
            const job = await fetch(
              `/api/jobs/${encodeURIComponent(saved.jobId)}`,
            ).then((r) => (r.ok ? r.json() : null));
            if (live && job && !job.done) {
              setTailorJob(saved);
              setTailorOpen(true);
            }
          }
        } catch {
          /* storage may be unavailable */
        }
      }
    };
    const refresh = () =>
      void load().catch((e) => {
        if (live) setError(e.message);
      });
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [result.runId, result.resume, setTailored, setTailorOpen, setTailorJob]);
  const submission = useSubmissionConfirmation({
    workflow,
    result,
    resume,
    source: context?.source || result.source || "Other",
    link: result.link,
    tailored: tailoring.tailored,
    refreshHistory: onChange,
    resetForm: onClose,
    setError,
    setToast: showToast,
    offerUndo,
  });
  const [changingStatus, setChangingStatus] = useState(false);
  async function changeStatus(status: Status) {
    if (!context?.application || changingStatus) return;
    const token = workflow.begin("submission");
    contextRevision.current++;
    setChangingStatus(true);
    setError(null);
    try {
      const response = await fetch("/api/applications", { cache: "no-store" });
      if (!response.ok)
        throw new Error("Could not load the current application status");
      const payload: ApplicationsPayload = await response.json();
      const application = context.application;
      const matches = payload.rows.filter((row) =>
        application.recordId
          ? row.recordId === application.recordId
          : row.key === application.key,
      );
      if (matches.length !== 1)
        throw new Error(
          "The application changed or its link is ambiguous. Reopen the review and try again.",
        );
      const row = matches[0];
      const updated = await fetch("/api/applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileHash: payload.fileHash,
          key: row.key,
          lineIndex: row.lineIndex,
          status,
        }),
      });
      if (!updated.ok) {
        const body = await updated.json();
        throw new Error(
          body.error?.message || "Could not change application status",
        );
      }
      const saved: ApplicationsPayload = await updated.json();
      if (!workflow.current(token)) return;
      const next = saved.rows.find((r) => r.lineIndex === row.lineIndex)!;
      // Ignore any poll that started before this status update completed.
      contextRevision.current++;
      setContext({
        ...context,
        status,
        date: next.date,
        dateLabel: status === "to apply" ? "Saved" : "Applied",
        application: {
          key: next.key,
          lineIndex: next.lineIndex,
          recordId: next.recordId,
          status: next.status,
        },
      });
      onChange();
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (e) {
      if (workflow.current(token)) setError((e as Error).message);
    } finally {
      setChangingStatus(false);
    }
  }
  const [savingIdentity, setSavingIdentity] = useState(false);
  async function saveIdentity(field: JobIdentityField, value: string) {
    if (savingIdentity) return false;
    const token = workflow.begin("submission");
    contextRevision.current++;
    setSavingIdentity(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/reviews/${encodeURIComponent(result.runId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, value }),
        },
      );
      if (!response.ok) throw new Error((await readApiError(response)).message);
      const payload = (await response.json()) as {
        result: ScoreResult;
        context: ReviewContext;
      };
      if (!workflow.current(token)) return false;
      contextRevision.current++;
      const next = {
        ...result,
        [field]: payload.result[field],
        meta: {
          ...result.meta,
          persistenceWarning: payload.result.meta.persistenceWarning,
        },
      };
      setCorrectedResult(next);
      setContext(payload.context);
      onIdentityChanged?.(next);
      onChange();
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
      return true;
    } catch (e) {
      if (workflow.current(token)) setError((e as Error).message);
      return false;
    } finally {
      setSavingIdentity(false);
    }
  }

  const [skipping, setSkipping] = useState(false);
  async function skip() {
    if (skipping) return;
    setSkipping(true);
    try {
      await submission.skip();
    } finally {
      setSkipping(false);
    }
  }
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </p>
      )}
      <ReviewCard
        readOnly={readOnly}
        result={result}
        context={context}
        tailorOpen={tailoring.tailorOpen}
        tailoredResume={
          tailoring.tailored && tailorPassed(tailoring.tailored)
            ? `tailored/${tailoring.tailored.slug}`
            : null
        }
        resume={resume}
        saving={
          submission.saving || skipping || changingStatus || savingIdentity
        }
        onSaveIdentity={saveIdentity}
        onStatusChange={changeStatus}
        questionsOpen={questionsOpen}
        onResume={setResume}
        onUseMaster={tailoring.useMaster}
        onTailor={() => tailoring.setTailorOpen(true)}
        onApplied={() => void submission.logApplied()}
        onLater={() => void submission.logApplied("later")}
        onSkip={() => void skip()}
        onQuestions={() => setQuestionsOpen((v) => !v)}
        onFollowUp={() => setFollowUpOpen((v) => !v)}
        onViewSummary={onViewSummary || (() => setSummaryOpen(true))}
      />
      {summaryOpen && (
        <Modal
          open
          onClose={() => setSummaryOpen(false)}
          width={820}
          title={
            <JobHeading company={result.company} role={result.role} large />
          }
          headerAction={<JobLink link={result.link} large />}
          footer={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSummaryOpen(false)}
            >
              View Review
            </Button>
          }
        >
          <div className="space-y-4 pt-1">
            <ReviewJobFacts result={result} context={context} large />
            <JobSummary brief={context?.brief} loading={!context} />
          </div>
        </Modal>
      )}
      {followUpOpen && (
        <div ref={followUpRef} className="scroll-mt-24">
          <ReviewFollowUp runId={result.runId} model={extrasModel} />
        </div>
      )}
      {questionsOpen && (
        <div ref={questionsRef} className="scroll-mt-24">
          <ExtrasPanel
            target={{ kind: "review", id: result.runId }}
            resume={resume}
            model={extrasModel}
          />
        </div>
      )}
      {!readOnly && tailoring.tailorOpen && (
        <TailorPanel
          baselineFit={result.fit.total}
          baselineMatch={result.match.total}
          runId={result.runId}
          suggestedSlug={tailoring.tailorJob?.slug || result.suggestedSlug}
          model={tailorModel}
          onFinished={tailoring.onTailorFinished}
          onSendMaster={tailoring.useMaster}
          existingResult={tailoring.tailored || undefined}
          autoStart={!tailoring.tailored && !tailoring.tailorJob}
          existingJobId={tailoring.tailorJob?.jobId}
          onJobStarted={(jobId, slug) => {
            const job = { jobId, slug, runId: result.runId };
            tailoring.setTailorJob(job);
            lsSet("career-ui.apply.tailor", job);
          }}
        />
      )}
    </div>
  );
}
