// zod schemas for Claude's structured output (→ JSON Schema draft-07 for outputFormat).
// Spec: docs/02-claude-integration.md. Claude judges scores; code derives bands and verifies text.
import { z } from "zod";
import { JobBriefSchema } from "../jobBrief";
import { BLOCKER_TYPES } from "../types";
import type {
  ClaudeReviewOutput,
  ClaudeTailorReport,
  CoverLetterResult,
  QuestionsResult,
  QuickExtract,
  QuickJob,
} from "../types";

const Presence = z.enum(["bullet", "skills", "absent"]);
const Placement = z.enum(["prominent", "buried"]).nullable();
const Score = z.number().min(0).max(100);

export const RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(["eligibility", "must", "nice"]),
  career: z.enum(["strong", "partial", "none"]),
  careerQuote: z.string(), // verbatim from career.md (verified server-side)
  careerSection: z.string(),
  resume: Presence,
  resumeQuote: z.string(), // verbatim visible text from the master (verified server-side)
  placement: Placement,
  fix: z.enum(["light", "heavy"]).nullable(),
  terms: z.array(z.string()),
});

const DecisionBriefSchema = z.object({
  strengths: z.string().trim().min(1).max(220),
  gaps: z.string().trim().min(1).max(220),
  resumeAction: z.string().trim().min(1).max(220),
});

export const ReviewSchema = z.object({
  decisionBrief: DecisionBriefSchema.optional(),
  company: z.string(),
  role: z.string(),
  location: z.string(),
  workMode: z.enum(["onsite", "hybrid", "remote", "flexible", "unknown"]),
  level: z.string(),
  postedDate: z.string(),
  postedText: z.string(),
  jobId: z.string(),
  requirements: z.array(RequirementSchema).min(1).max(30),
  fit: z.object({ score: Score, summary: z.string() }),
  match: z.object({ score: Score, summary: z.string() }),
  recommendation: z.object({
    kind: z.enum(["use-master", "light-tailor", "tailor", "dont-tailor"]),
    reason: z.string(),
  }),
  keywords: z.array(z.string()),
  gaps: z.array(z.string()).max(6),
  blockers: z.array(
    z.object({
      type: z.enum(BLOCKER_TYPES),
      quote: z.string(),
      mandatory: z.boolean(),
      unmet: z.boolean(),
      why: z.string(),
    }),
  ),
  why: z.array(z.string()).max(6),
  recommendedChanges: z.array(
    z.object({
      action: z.enum([
        "surface",
        "emphasize",
        "reorder",
        "reword",
        "swap",
        "keep",
      ]),
      requirementId: z.string(),
      text: z.string(),
    }),
  ),
  suggestedResume: z.enum(["tech", "general", "datacenter"]), // never hourly
  suggestedSlug: z.string(),
}) satisfies z.ZodType<ClaudeReviewOutput>;

export const ReviewModelSchema = ReviewSchema.omit({
  suggestedSlug: true,
}).extend({
  jobBrief: JobBriefSchema,
  decisionBrief: DecisionBriefSchema,
  recommendation: ReviewSchema.shape.recommendation.extend({
    kind: z.enum(["use-master", "tailor"]),
  }),
  // Historical records keep "eligibility"; new reviews assess work requirements only.
  requirements: z
    .array(RequirementSchema.extend({ kind: z.enum(["must", "nice"]) }))
    .min(1)
    .max(30),
  // Retain the stored/CLI field while preventing new model reviews from screening eligibility.
  blockers: ReviewSchema.shape.blockers.max(0),
});

/** z.toJSONSchema(ReviewSchema, { target: "draft-7" }): the SDK rejects newer drafts. */
export function reviewJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(
    ReviewModelSchema.extend({
      why: z.array(z.string()).max(4),
      recommendedChanges: ReviewSchema.shape.recommendedChanges.max(5),
      keywords: z.array(z.string()),
      gaps: z.array(z.string()).max(4),
    }),
    { target: "draft-7" },
  ) as Record<string, unknown>;
}

export const TailorReportSchema = z.object({
  changes: z.array(
    z.object({
      requirementId: z.string(),
      after: z.string(), // verbatim visible text from the tailored resume
      careerQuote: z.string(), // verbatim from career.md
    }),
  ),
  requirements: z.array(
    z.object({
      id: z.string(),
      presence: Presence,
      placement: Placement,
      quote: z.string(),
    }),
  ),
  notes: z.string(),
}) satisfies z.ZodType<ClaudeTailorReport>;

export function tailorReportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(TailorReportSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}

/** Live candidate/report contracts are stricter than legacy saved reports. */
export const CandidateSubmissionSchema = z.object({
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
  edits: z
    .array(z.object({ before: z.string().min(1), after: z.string() }))
    .max(40),
  changes: z
    .array(
      z.object({
        requirementId: z.string(),
        after: z.string().min(1),
        careerQuote: z.string().min(1),
      }),
    )
    .max(60),
});
export const VerifiedTailorReportSchema = TailorReportSchema.extend({
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
  visualPassed: z.boolean(),
  readingOrderPassed: z.boolean(),
  support: z.array(
    z.object({
      after: z.string().min(1),
      supported: z.boolean(),
      reason: z.string().min(1),
    }),
  ),
});
export function verifiedTailorReportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(VerifiedTailorReportSchema, {
    target: "draft-7",
  }) as Record<string, unknown>;
}

/**
 * The tailor agent's final answer: verdicts only. Code re-attaches the evidence it already accepted
 * for that candidate hash (expandAssessment), so the model never re-emits change text or quotes.
 */
export const TailorAssessmentSchema = z.object({
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
  visualPassed: z.boolean(),
  readingOrderPassed: z.boolean(),
  support: z.array(
    z.object({
      change: z.number().int().min(0),
      supported: z.boolean(),
      reason: z.string().min(1),
    }),
  ),
  requirements: TailorReportSchema.shape.requirements,
  notes: z.string(),
});
export type TailorAssessment = z.infer<typeof TailorAssessmentSchema>;
export function tailorAssessmentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(TailorAssessmentSchema, {
    target: "draft-7",
  }) as Record<string, unknown>;
}

/**
 * Repair cross-field slips in place so one stray field never fails a review: clear fields that
 * contradict their credit/presence, rename duplicate requirement IDs, and drop change links to
 * unknown IDs. Quotes are checked afterwards, for display only.
 */
export function normalizeReview(out: ClaudeReviewOutput): void {
  const ids = new Set<string>();
  for (const r of out.requirements) {
    let id = r.id;
    for (let n = 2; ids.has(id); n++) id = `${r.id}-${n}`;
    r.id = id;
    ids.add(id);
    if (r.career === "none") {
      r.careerQuote = "";
      r.fix = null;
    }
    if (r.resume === "absent") {
      r.resumeQuote = "";
      r.placement = null;
    } else if (!r.placement) r.placement = "buried";
    if (r.resume === "bullet" && r.placement === "prominent") r.fix = null;
  }
  for (const c of out.recommendedChanges)
    if (c.requirementId && !ids.has(c.requirementId)) c.requirementId = "";
  out.fit.score = Math.round(out.fit.score);
  out.match.score = Math.round(out.match.score);
}

/** Quick add (no review): just the tracker fields, extracted by one small model call. */
export const QuickSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  location: z.string(),
  workMode: z.enum(["onsite", "hybrid", "remote", "flexible", "unknown"]),
  level: z.string(),
  postedText: z.string(),
  postedDate: z.string(),
  jobId: z.string(),
  suggestedResume: z.enum(["tech", "general", "datacenter"]),
}) satisfies z.ZodType<QuickExtract>;

export function quickJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(QuickSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}

/** Batch quick add: one entry per numbered job block, from one small model call. */
// Quick Add also logs incomplete pastes. Review still requires a substantive work brief.
const QuickJobBriefSchema = z.object({
  ...JobBriefSchema.shape,
  overview: z.string().trim().min(1).max(400),
});

export const QuickJobSchema = QuickSchema.omit({
  suggestedResume: true,
}).extend({
  job: z.number().int().min(1),
  link: z.string(),
  jobBrief: QuickJobBriefSchema,
}) satisfies z.ZodType<QuickJob>;

export const QuickBatchSchema = z.object({
  jobs: z.array(QuickJobSchema).min(1).max(20),
});

export function quickBatchJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(QuickBatchSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}

/** Application questions: paste-ready options per question (Extras). */
export const QuestionsSchema = z.object({
  company: z.object({ name: z.string(), whatTheyDo: z.string() }),
  answers: z
    .array(
      z.object({
        question: z.string().min(1),
        options: z.array(z.string().min(1)).length(3),
        needsUser: z.string(),
      }),
    )
    .min(1)
    .max(30),
}) satisfies z.ZodType<QuestionsResult>;

export function questionsJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(QuestionsSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}

/** One cover letter in plain text, plus the facts it names (Extras). */
export const CoverLetterSchema = z.object({
  letter: z.string().min(200).max(6000),
  namedFacts: z.array(z.string()),
}) satisfies z.ZodType<CoverLetterResult>;

export function coverLetterJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(CoverLetterSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}

/** One answer to a review follow-up question (not saved). */
export const FollowupSchema = z.object({
  answer: z.string().min(1).max(8000),
});

export function followupJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(FollowupSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}

// v1 names, kept so older imports keep compiling.
export const ScoreSchema = ReviewSchema;
export const scoreJsonSchema = reviewJsonSchema;
