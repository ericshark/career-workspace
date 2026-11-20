// Turns Claude's review into the saved result. Claude judges Fit, Match and the tailoring call; code
// only does the mechanical parts: score bands + verdict, legacy blocker notes, keyword grep on the
// resume, posting age and duplicates. Quote checks are informational and never change a score.
// Pure (inputs injected), shared by the UI (lib/claude/score.ts) and the CLI (ui/scripts/apps.ts).
import { postingAge } from "./age";
import { classifyBlockers, fitBand, verdictFor } from "./fit";
import { matchBand } from "./match";
import { currentRecommendation } from "../resumeRecommendation";
import {
  termFound,
  termVariants,
  texToPlain,
  verifyQuote,
  verifyResumeQuote,
} from "./verify";
import type {
  Bucket,
  ClaudeRequirement,
  ClaudeReviewOutput,
  DuplicateReport,
  ResumeCategory,
  ResumeRecommendation,
  ReviewRequirement,
  ScoreResult,
  Verdict,
} from "../types";

/** Attach informational quote checks and the evidence bucket (used by the tailor brief). */
export function buildRequirements(
  reqs: ClaudeRequirement[],
  careerMd: string,
  resumeTex: string,
): ReviewRequirement[] {
  return reqs.map((r) => {
    const bucket: Bucket =
      r.career === "none" ? 3 : r.resume === "bullet" ? 1 : 2;
    return {
      ...r,
      careerVerified:
        r.career !== "none" && verifyQuote(r.careerQuote, careerMd),
      resumeVerified:
        r.resume !== "absent" && verifyResumeQuote(r.resumeQuote, resumeTex),
      effectiveCredit: r.career,
      effectivePresence: r.resume,
      bucket,
    };
  });
}

/** Claude's call, except that a job not worth applying to is never worth tailoring. */
function recommendationFor(
  out: ClaudeReviewOutput,
  verdict: Verdict,
): ResumeRecommendation {
  if (verdict.kind === "skip" || verdict.kind === "blocked")
    return {
      kind: "use-master",
      text: "Use Master",
      reason:
        "Tailoring is not worthwhile for this fit; use the master if applying.",
    };
  return currentRecommendation(out.recommendation);
}

export interface ReviewContext {
  runId: string;
  today: string; // review date, YYYY-MM-DD
  jobPost: string;
  careerMd: string;
  resumeTex: string; // the selected master
  resume: ResumeCategory;
  link?: string;
  duplicates?: DuplicateReport;
  postedOverride?: string | null;
  meta: ScoreResult["meta"];
}

export function computeReview(
  out: ClaudeReviewOutput,
  ctx: ReviewContext,
): ScoreResult {
  const reqs = buildRequirements(out.requirements, ctx.careerMd, ctx.resumeTex);
  const blockers = classifyBlockers(out.blockers, ctx.jobPost);

  const fitTotal = Math.round(out.fit.score);
  const fit = {
    total: fitTotal,
    band: fitBand(fitTotal),
    summary: out.fit.summary,
  };
  const verdict = verdictFor(fit);

  const plain = texToPlain(ctx.resumeTex);
  const keywords = [
    ...new Set(
      out.keywords
        .map((k) => k.trim())
        .filter((k) => k && termFound(k, ctx.jobPost)),
    ),
  ];
  const distinctKeywords = keywords.filter(
    (k, i) =>
      !keywords
        .slice(0, i)
        .some((previous) => termVariants(previous).includes(k.toLowerCase())),
  );
  const matchTotal = Math.round(out.match.score);
  const match = {
    total: matchTotal,
    band: matchBand(matchTotal),
    summary: out.match.summary,
    termsFound: distinctKeywords.filter((k) => termFound(k, plain)),
    termsMissing: distinctKeywords.filter((k) => !termFound(k, plain)),
  };

  const warnings = reqs
    .filter((r) => r.career !== "none" && !r.careerVerified)
    .map(
      (r) =>
        `"${r.text}": career.md quote not matched to source; check its support (score unchanged)`,
    );

  return {
    decisionBrief: out.decisionBrief,
    runId: ctx.runId,
    reviewedAt: ctx.today,
    company: out.company,
    role: out.role,
    location: out.location,
    workMode: out.workMode,
    level: out.level,
    jobId: out.jobId,
    link: ctx.link ?? "",
    resume: ctx.resume,
    age: postingAge(
      out.postedText,
      out.postedDate,
      ctx.jobPost,
      ctx.today,
      ctx.postedOverride,
    ),
    fit,
    match,
    verdict,
    recommendation: recommendationFor(out, verdict),
    estimate: null,
    requirements: reqs,
    blockers,
    why: out.why.slice(0, 4),
    recommendedChanges: out.recommendedChanges.slice(0, 5),
    gaps: out.gaps.slice(0, 4),
    duplicates: ctx.duplicates ?? { exact: [], possible: [] },
    suggestedResume: out.suggestedResume,
    suggestedSlug: out.suggestedSlug,
    warnings,
    meta: ctx.meta,
  };
}

/**
 * Reviews saved before the LLM-scored review carry rubric parts and `doNotAdd` instead of
 * summaries and `gaps`. Fill the new fields in place so History still opens them.
 */
export function upgradeScoreResult(r: ScoreResult): ScoreResult {
  const legacy = r as ScoreResult & { doNotAdd?: string[] };
  r.gaps ??= legacy.doNotAdd ?? [];
  r.fit.summary ??= "";
  r.match.summary ??= "";
  r.recommendedChanges ??= [];
  return r;
}
