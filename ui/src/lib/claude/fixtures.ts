// Canned data for UI_FIXTURES=1 (no plan usage). The fixture classification runs through the real
// lib/scoring pipeline, so the screens show realistic, internally consistent numbers.
import { randomUUID } from "node:crypto";
import { computeReview } from "../scoring/review";
import type {
  BuildResult,
  ClaudeReviewOutput,
  DuplicateReport,
  ScoreResult,
  TailorResult,
} from "../types";

const CAREER = `Built a FastAPI backend with PostgreSQL and Alembic migrations.
Implemented OAuth2 login with refresh-token rotation and Redis-backed lockout.
Wrote 130+ pytest tests and ran them in GitHub Actions CI.
Built a React and TypeScript dashboard streaming traces over SSE.`;

const RESUME = `\\begin{document}
\\resumeItem{Built a \\textbf{FastAPI} backend with \\textbf{PostgreSQL} and Alembic migrations}
\\resumeItem{Built a React and TypeScript dashboard streaming traces over SSE}
\\textbf{Skills}{: Python, TypeScript, Redis, GitHub Actions}
\\end{document}`;

export const FIXTURE_POST = `Fixture Co — Backend Engineer (New Grad). Posted 2 days ago.
Requirements: Python, PostgreSQL, OAuth2, Redis, CI/CD. Nice: AWS.`;

export function fixtureAnalysis(): ClaudeReviewOutput {
  return {
    decisionBrief: {
      strengths:
        "FastAPI, PostgreSQL and tested authentication projects support the core backend work.",
      gaps: "Production AWS operations are not documented at the requested depth.",
      resumeAction:
        "Surface supported OAuth2 and testing evidence in the existing backend project bullets.",
    },
    company: "Fixture Co",
    role: "Backend Engineer (New Grad)",
    location: "New York, NY",
    workMode: "hybrid",
    level: "New grad",
    postedDate: "",
    postedText: "Posted 2 days ago",
    jobId: "",
    requirements: [
      {
        id: "r1",
        text: "Python / FastAPI backend",
        kind: "must",
        career: "strong",
        careerQuote: "Built a FastAPI backend with PostgreSQL",
        careerSection: "Projects → Example Auth Service",
        resume: "bullet",
        resumeQuote: "Built a FastAPI backend with PostgreSQL",
        placement: "prominent",
        fix: null,
        terms: ["Python", "FastAPI"],
      },
      {
        id: "r2",
        text: "PostgreSQL",
        kind: "must",
        career: "strong",
        careerQuote: "PostgreSQL and Alembic migrations",
        careerSection: "Projects → Example Auth Service",
        resume: "bullet",
        resumeQuote: "PostgreSQL and Alembic migrations",
        placement: "buried",
        fix: "light",
        terms: ["PostgreSQL"],
      },
      {
        id: "r3",
        text: "OAuth2 / auth",
        kind: "must",
        career: "strong",
        careerQuote: "Implemented OAuth2 login with refresh-token rotation",
        careerSection: "Projects → Example Auth Service",
        resume: "absent",
        resumeQuote: "",
        placement: null,
        fix: "light",
        terms: ["OAuth2"],
      },
      {
        id: "r4",
        text: "Redis",
        kind: "must",
        career: "strong",
        careerQuote: "Redis-backed lockout",
        careerSection: "Projects → Example Auth Service",
        resume: "skills",
        resumeQuote: "Redis",
        placement: "buried",
        fix: "light",
        terms: ["Redis"],
      },
      {
        id: "r5",
        text: "CI/CD",
        kind: "must",
        career: "partial",
        careerQuote: "ran them in GitHub Actions CI",
        careerSection: "Projects → Example Auth Service",
        resume: "skills",
        resumeQuote: "GitHub Actions",
        placement: "buried",
        fix: "heavy",
        terms: ["CI/CD"],
      },
      {
        id: "r6",
        text: "AWS",
        kind: "nice",
        career: "none",
        careerQuote: "",
        careerSection: "",
        resume: "absent",
        resumeQuote: "",
        placement: null,
        fix: null,
        terms: ["AWS"],
      },
    ],
    fit: {
      score: 82,
      summary:
        "FIXTURE DATA: new-grad backend role on the workspace owner's main Python/FastAPI stack.",
    },
    match: {
      score: 68,
      summary:
        "FIXTURE DATA: the stack is on the page, but OAuth2 and Redis are underplayed.",
    },
    recommendation: {
      kind: "tailor",
      reason: "A few targeted changes surface experience you already have.",
    },
    keywords: ["Python", "FastAPI", "PostgreSQL", "OAuth2", "Redis", "AWS"],
    gaps: ["Production AWS experience is not documented in career.md."],
    blockers: [],
    why: [
      "FIXTURE DATA: strong Python/FastAPI/PostgreSQL match",
      "OAuth2 and Redis experience supported by career.md",
      "Completed API projects support the core backend responsibilities",
      "Preferred AWS experience is not documented",
    ],
    recommendedChanges: [
      { action: "surface", requirementId: "r3", text: "Surface OAuth2" },
      { action: "emphasize", requirementId: "r4", text: "Emphasize Redis" },
      {
        action: "reorder",
        requirementId: "",
        text: "Move backend/API experience higher",
      },
      { action: "keep", requirementId: "", text: "Keep current projects" },
    ],
    suggestedResume: "tech",
    suggestedSlug: "fixture-co-backend-engineer",
  };
}

export function fixtureScore(
  today: string,
  link?: string,
  duplicates?: DuplicateReport,
  runId: string = randomUUID(),
): { result: ScoreResult; analysis: ClaudeReviewOutput } {
  const analysis = fixtureAnalysis();
  const result = computeReview(structuredClone(analysis), {
    runId,
    today,
    jobPost: FIXTURE_POST,
    careerMd: CAREER,
    resumeTex: RESUME,
    resume: "tech",
    link,
    duplicates,
    meta: { model: "fixture", durationMs: 1 },
  });
  return { result, analysis };
}

export function fixtureBuild(slug: string): BuildResult {
  return {
    ok: true,
    pages: 1,
    fillPct: 97,
    ats: "PASS",
    warnings: [],
    failures: [],
    pdfPath: `resumes/tailored/${slug}/Resume.pdf`,
    pngPath: null,
    raw: "(fixture build output)",
  };
}

export function fixtureTailor(
  slug: string,
  estimate: ScoreResult["estimate"] = null,
): TailorResult {
  return {
    slug,
    texPath: `source/tailored/${slug}/resume.tex`,
    pdfPath: `resumes/tailored/${slug}/Resume.pdf`,
    pngUrl: null,
    build: fixtureBuild(slug),
    mastersUnchanged: true,
    candidateHash: "a".repeat(64),
    repairCount: 0,
    verification: {
      report: true,
      evidence: true,
      visual: true,
      readingOrder: true,
    },
    deniedToolCalls: [],
    changes: [
      {
        requirementId: "r3",
        after: "Implemented OAuth2 login with refresh-token rotation",
        careerQuote: "Implemented OAuth2 login with refresh-token rotation",
        afterVerified: true,
        careerVerified: true,
      },
    ],
    estimate,
    actualMatch: estimate
      ? Math.round((estimate.low + estimate.high) / 2)
      : null,
    meta: { model: "fixture", durationMs: 1200 },
  };
}
