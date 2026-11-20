"use client";
import { ReviewDecisionSummary } from "./ReviewDecisionSummary";
import type { ScoreResult, Status } from "@/lib/types";
import type { ReviewContext } from "@/lib/reviewContext";
import {
  reviewDecisionActions,
  reviewDecisionBrief,
  reviewTailoring,
} from "@/lib/reviewPresentation";
import { jobLocation, JobFacts, JobHeading, JobLink } from "./JobHeader";
import { DuplicateMatches } from "./DuplicateMatches";
import { ReviewSaveNotice } from "./ReviewSaveNotice";
import { ReviewIdentityField } from "./ReviewIdentityField";
import type { JobIdentityField } from "@/lib/jobIdentity";
import { ReviewViewedNotice } from "./ReviewViewedNotice";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { StatusPill } from "./tracker/StatusPill";
import { TintBadge } from "./TintBadge";
import { MessageCircleIcon, FileTextIcon, EyeIcon } from "lucide-react";
import { SegmentedControl } from "./SegmentedControl";
export { duplicateLine } from "./DuplicateMatches";

export interface ReviewCardProps {
  readOnly?: boolean;
  result: ScoreResult;
  context?: ReviewContext | null;
  tailorOpen: boolean;
  tailoredResume: string | null;
  resume: string;
  saving?: boolean;
  questionsOpen: boolean;
  onResume: (resume: string) => void;
  onUseMaster: () => void;
  onTailor: () => void;
  onApplied: () => void;
  onLater: () => void;
  onSkip: () => void;
  onQuestions: () => void;
  onFollowUp: () => void;
  onViewSummary: () => void;
  onStatusChange: (status: Status) => void;
  onSaveIdentity: (field: JobIdentityField, value: string) => Promise<boolean>;
}
export default function ReviewCard({
  result: r,
  readOnly = false,
  context,
  tailorOpen,
  tailoredResume,
  resume,
  saving,
  questionsOpen,
  onResume,
  onUseMaster,
  onTailor,
  onApplied,
  onLater,
  onSkip,
  onQuestions,
  onFollowUp,
  onViewSummary,
  onStatusChange,
  onSaveIdentity,
}: ReviewCardProps) {
  const own = context?.application;
  const otherMatch = (m: (typeof r.duplicates.exact)[number]) =>
    !(
      own &&
      m.kind === "application" &&
      (m.recordId && own.recordId
        ? m.recordId === own.recordId
        : m.key === own.key &&
          (m.lineIndex === undefined || m.lineIndex === own.lineIndex))
    );
  const duplicates = {
    exact: r.duplicates.exact.filter(otherMatch),
    possible: r.duplicates.possible.filter(otherMatch),
  };
  const recommended = reviewTailoring(r);
  const brief = reviewDecisionBrief(r);
  const actions = reviewDecisionActions(context ? context.status : "loading");
  return (
    <Card
      id="completed-review"
      data-review-id={r.runId}
      className="animate-rise scroll-mt-16"
      aria-label="Completed review"
    >
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 flex-1 basis-40 break-words text-lg font-semibold tracking-tight">
            {readOnly ? (
              <JobHeading company={r.company} role={r.role} />
            ) : (
              <>
                <ReviewIdentityField
                  field="company"
                  value={r.company}
                  disabled={saving}
                  onSave={onSaveIdentity}
                />
                <span className="block text-sm font-normal text-muted-foreground">
                  <ReviewIdentityField
                    field="role"
                    value={r.role}
                    disabled={saving}
                    onSave={onSaveIdentity}
                  />
                </span>
              </>
            )}
          </h2>
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="Review controls"
          >
            <Button size="sm" variant="outline" onClick={onViewSummary}>
              <EyeIcon />
              View Summary
            </Button>
            {context?.application && !readOnly ? (
              <StatusPill
                status={context.application.status}
                disabled={saving}
                onChange={onStatusChange}
              />
            ) : (
              <TintBadge color="var(--muted-foreground)" className="h-7 px-3">
                {context?.status === "not decided"
                  ? "Needs decision"
                  : context?.status || "Loading status…"}
              </TintBadge>
            )}
            <JobLink link={r.link} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Review · {r.meta.model} · {(r.meta.durationMs / 1000).toFixed(1)}s
        </p>
        <ReviewJobFacts result={r} context={context} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ReviewViewedNotice key={r.runId} runId={r.runId} />
        <ReviewSaveNotice
          key={`save-${r.runId}`}
          runId={r.runId}
          warning={r.meta.persistenceWarning}
        />
        <ReviewDecisionSummary result={r} resume={resume} />
        <dl
          className="space-y-2 text-sm leading-relaxed"
          aria-label="Review reasoning"
        >
          {[
            { label: "Why you fit", text: brief.strengths },
            { label: "Main gaps", text: brief.gaps },
            { label: "Resume action", text: brief.resumeAction },
          ].map((line) => (
            <div key={line.label}>
              <dt className="font-semibold">{line.label}</dt>
              <dd className="text-muted-foreground">{line.text}</dd>
            </div>
          ))}
        </dl>
        <section aria-label="Keywords" className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-semibold">Keywords</h3>
          {[
            { label: "On your resume", terms: r.match.termsFound, found: true },
            {
              label: "Missing from your resume",
              terms: r.match.termsMissing,
              found: false,
            },
          ].map((group) => (
            <section key={group.label} className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">
                {group.label} · {group.terms.length}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {group.terms.length ? (
                  group.terms.map((term) => (
                    <Badge
                      key={term}
                      variant={group.found ? "success" : "outline"}
                    >
                      {term}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    None recorded
                  </span>
                )}
              </div>
            </section>
          ))}
          <p className="text-xs text-muted-foreground">
            Missing wording is not necessarily missing experience.
          </p>
        </section>
        {!!(duplicates.exact.length + duplicates.possible.length) && (
          <details className="text-xs text-warning">
            <summary className="cursor-pointer">
              Related records · compare matches
            </summary>
            <DuplicateMatches duplicates={duplicates} />
          </details>
        )}
        {!readOnly && tailoredResume && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>Send with</span>
            <SegmentedControl
              size="sm"
              ariaLabel="Resume to send"
              value={resume === tailoredResume ? tailoredResume : r.resume}
              onChange={onResume}
              options={[
                { value: r.resume, label: `${r.resume} master` },
                { value: tailoredResume, label: "Tailored" },
              ]}
            />
          </div>
        )}
      </CardContent>
      {!readOnly && (
        <CardFooter className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            size="default"
            variant="outline"
            className="h-9 px-3 text-primary"
            onClick={onFollowUp}
          >
            <MessageCircleIcon />
            Ask about this review
          </Button>
          <Button
            size="default"
            className="h-9 px-3 text-primary"
            variant={questionsOpen ? "secondary" : "outline"}
            onClick={onQuestions}
            aria-expanded={questionsOpen}
          >
            <FileTextIcon />
            Questions &amp; cover letter
          </Button>
          {!tailoredResume && (
            <Button
              size="default"
              className="h-9 px-4"
              variant={recommended ? "success" : "caution"}
              onClick={onTailor}
              disabled={tailorOpen}
            >
              {recommended ? "Tailor" : "Tailor anyway"}
            </Button>
          )}
          {(tailorOpen || resume.startsWith("tailored/")) && (
            <Button size="sm" variant="ghost" onClick={onUseMaster}>
              Use Master
            </Button>
          )}
          {actions.skip && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onSkip}
              disabled={saving}
            >
              Skip
            </Button>
          )}
          {actions.later && (
            <Button
              size="sm"
              variant="outline"
              onClick={onLater}
              disabled={saving}
            >
              To apply
            </Button>
          )}
          {actions.applied && (
            <Button size="sm" onClick={onApplied} disabled={saving}>
              {saving && <Spinner />}Mark applied
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

export function ReviewJobFacts({
  result: r,
  context,
  large = false,
}: {
  large?: boolean;
  result: ScoreResult;
  context?: ReviewContext | null;
}) {
  const date = (value: string) =>
    value.replace(/^\d{2}(\d{2})-(\d{2})-(\d{2})$/, "$2/$3/$1");
  return (
    <JobFacts
      large={large}
      source={context?.source || r.source || "Unknown"}
      facts={[
        {
          label: "Location",
          value: jobLocation(
            context?.brief.location || r.location,
            context?.brief.workMode || r.workMode,
          ),
        },
        {
          label: "Salary",
          value: context?.brief.compensation || "",
        },
        { label: "Resume", value: context?.resume || r.resume },
        {
          label: context?.dateLabel || "Saved",
          value: context ? date(context.date) : "",
        },
        { label: "Posted", value: r.age.date ? date(r.age.date) : "" },
      ]}
    />
  );
}
