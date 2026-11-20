import { jobContext } from "./jobContext";
// The tailoring brief: the data contract between job review and resume construction.
// It is derived from a score run, never stored separately. Documented in
// prompts/README.md → "Tailor".
import type { BriefItem, ReviewRequirement, TailoringBrief } from "./types";
import type { RunRecord } from "./runs";
import { currentRecommendation } from "./resumeRecommendation";

function item(r: ReviewRequirement): BriefItem {
  return {
    id: r.id,
    text: r.text,
    kind: r.kind,
    career: r.effectiveCredit,
    careerQuote: r.careerQuote,
    careerSection: r.careerSection,
    resumeQuote: r.resumeQuote,
    presence: r.effectivePresence,
    fix: r.fix,
    terms: r.terms,
  };
}

/** Derive the evidence for one dynamically scoped tailoring operation. */
export function buildBrief(run: RunRecord, slug: string): TailoringBrief {
  const r = run.result;
  const reqs = r.requirements;
  return {
    company: r.company,
    role: r.role,
    master: `source/${r.resume}/resume.tex`,
    slug,
    outputTex: `source/tailored/${slug}/resume.tex`,
    outputPdf: `resumes/tailored/${slug}/Resume.pdf`,
    fit: { total: r.fit.total, band: r.fit.band, summary: r.fit.summary },
    match: { total: r.match.total, summary: r.match.summary },
    recommendation: currentRecommendation(r.recommendation),
    estimate: r.estimate,
    recommendedChanges: r.recommendedChanges,
    onResume: reqs.filter((q) => q.bucket === 1).map(item),
    underrepresented: reqs.filter((q) => q.bucket === 2).map(item),
    unsupported: reqs
      .filter((q) => q.bucket === 3)
      .map((q) => ({ id: q.id, text: q.text })),
    missingTerms: r.match.termsMissing,
    jobDescription: jobContext(run.request, run.request.postFormat),
  };
}
