import { describe, expect, it } from "vitest";
import { fixtureAnalysis, fixtureScore } from "@/lib/claude/fixtures";
import { normalizeReview } from "@/lib/claude/schemas";
import {
  ageBand,
  ageLine,
  parsePostedText,
  postingAge,
} from "@/lib/scoring/age";
import { classifyBlockers, fitBand } from "@/lib/scoring/fit";
import {
  buildRequirements,
  computeReview,
  upgradeScoreResult,
  type ReviewContext,
} from "@/lib/scoring/review";
import { verifyQuote } from "@/lib/scoring/verify";
import type {
  ClaudeBlocker,
  ClaudeRequirement,
  ClaudeReviewOutput,
  ScoreResult,
} from "@/lib/types";

const CAREER =
  "- **Backend services:** I built backend services in Python and FastAPI that power freight routing workflows.";
const TEX = String.raw`\begin{document}\resumeItem{Built backend \textbf{Python} and FastAPI services}\end{document}`;

const ctx = (o: Partial<ReviewContext> = {}): ReviewContext => ({
  runId: "run-1",
  today: "2026-10-07",
  jobPost:
    "Backend Engineer. Python FastAPI PostgreSQL GCP Rust. Posted 2 days ago.",
  careerMd: CAREER,
  resumeTex: TEX,
  resume: "tech",
  meta: { model: "m", durationMs: 0 },
  ...o,
});

const claudeReq = (o: Partial<ClaudeRequirement> = {}): ClaudeRequirement => ({
  id: "r1",
  text: "Strong backend fluency in Python with FastAPI",
  kind: "must",
  career: "strong",
  careerQuote:
    "Built backend services in Python and FastAPI that power freight routing workflows",
  careerSection: "Experience",
  resume: "bullet",
  resumeQuote: "Built backend Python and FastAPI services",
  placement: "prominent",
  fix: null,
  terms: ["Python", "FastAPI"],
  ...o,
});

const output = (o: Partial<ClaudeReviewOutput> = {}): ClaudeReviewOutput => ({
  ...fixtureAnalysis(),
  requirements: [claudeReq()],
  ...o,
});

describe("quote checks are forgiving and informational", () => {
  it("matches resume-style quotes against first-person career.md, ignoring case", () => {
    expect(
      verifyQuote(
        "Built backend services in Python and FastAPI that power freight routing workflows.",
        CAREER,
      ),
    ).toBe(true);
    expect(verifyQuote("BACKEND SERVICES in python", CAREER)).toBe(true);
    expect(verifyQuote("", CAREER)).toBe(false);
    expect(verifyQuote("Led a team of 20", CAREER)).toBe(false);
  });

  it("a paraphrased career quote keeps Claude's credit (the paraphrase bug)", () => {
    const [r] = buildRequirements(
      [
        claudeReq({
          careerQuote: "Shipped FastAPI services for freight dispatch",
        }),
      ],
      CAREER,
      TEX,
    );
    expect(r).toMatchObject({
      careerVerified: false,
      effectiveCredit: "strong",
      bucket: 1,
    });
  });

  it("buckets: 1 = bullet on the resume, 2 = career only, 3 = not in career.md", () => {
    const reqs = buildRequirements(
      [
        claudeReq({ id: "a" }),
        claudeReq({
          id: "b",
          resume: "absent",
          resumeQuote: "",
          placement: null,
        }),
        claudeReq({
          id: "c",
          career: "none",
          careerQuote: "",
          resume: "absent",
          resumeQuote: "",
          placement: null,
        }),
      ],
      CAREER,
      TEX,
    );
    expect(reqs.map((r) => r.bucket)).toEqual([1, 2, 3]);
  });
});

describe("computeReview", () => {
  it("uses Claude's scores; bands and verdict follow the Fit score", () => {
    for (const [score, band, verdict] of [
      [92, "strong", "apply"],
      [64, "reasonable", "apply"],
      [50, "stretch", "optional"],
      [30, "weak", "skip"],
    ] as const) {
      const r = computeReview(output({ fit: { score, summary: "s" } }), ctx());
      expect(r.fit).toEqual({ total: score, band, summary: "s" });
      expect(r.verdict.kind).toBe(verdict);
      expect(fitBand(score)).toBe(band);
    }
  });

  it("a skip or blocked job is never worth tailoring", () => {
    const r = computeReview(
      output({
        fit: { score: 30, summary: "" },
        recommendation: { kind: "tailor", reason: "x" },
      }),
      ctx(),
    );
    expect(r.recommendation.kind).toBe("use-master");
    const ok = computeReview(output(), ctx());
    expect(ok.recommendation).toMatchObject({
      kind: "tailor",
      text: "Tailor",
    });
  });

  it("a legacy blocker cannot override the Fit verdict or tailoring recommendation", () => {
    const r = computeReview(
      output({
        blockers: [
          {
            type: "existing_clearance",
            quote: "active TS/SCI clearance",
            mandatory: true,
            unmet: true,
            why: "none on record",
          },
        ],
      }),
      ctx({ jobPost: "Requires an active TS/SCI clearance." }),
    );
    expect(r.verdict.kind).toBe("apply");
    expect(r.blockers.confirmed).toEqual([]);
    expect(r.blockers.check).toHaveLength(1);
    expect(r.recommendation.kind).toBe("tailor");
  });

  it("greps keywords on the resume, with aliases", () => {
    const r = computeReview(
      output({ keywords: ["python", "FastAPI", "Postgres", "GCP", "GCP"] }),
      ctx({
        resumeTex: String.raw`\begin{document}Python, FastAPI, PostgreSQL\end{document}`,
      }),
    );
    expect(r.match.termsFound).toEqual(["python", "FastAPI", "Postgres"]);
    expect(r.match.termsMissing).toEqual(["GCP"]);
    expect(r.match.total).toBe(68);
    expect(r.match.band).toBe("moderate");
  });

  it("gaps come from Claude, and paraphrased quotes only warn", () => {
    const r = computeReview(
      output({
        requirements: [claudeReq({ careerQuote: "Wrote some APIs" })],
        gaps: ["Production GCP experience"],
      }),
      ctx(),
    );
    expect(r.gaps).toEqual(["Production GCP experience"]);
    expect(r.requirements[0].effectiveCredit).toBe("strong");
    expect(r.warnings[0]).toContain("quote not matched to source");
    expect(r.warnings[0]).toContain("score unchanged");
  });

  it("posting age never changes Candidate Fit", () => {
    const a = fixtureScore("2026-10-07").result.fit;
    const b = fixtureScore("2027-06-01").result.fit; // same post, now stale
    expect(b).toEqual(a);
    expect(fixtureScore("2026-10-07").result.age).toMatchObject({
      days: 2,
      band: "fresh",
    });
  });
});

describe("normalizeReview never fails a review", () => {
  it("renames duplicate IDs and clears contradictions", () => {
    const out = output({
      requirements: [
        claudeReq(),
        claudeReq({ career: "none", fix: "light" }),
        claudeReq({ resume: "skills", placement: null }),
      ],
      recommendedChanges: [
        { action: "surface", requirementId: "r9", text: "x" },
      ],
      fit: { score: 71.6, summary: "" },
    });
    normalizeReview(out);
    expect(out.requirements.map((r) => r.id)).toEqual(["r1", "r1-2", "r1-3"]);
    expect(out.requirements[1]).toMatchObject({ careerQuote: "", fix: null });
    expect(out.requirements[2].placement).toBe("buried");
    expect(out.recommendedChanges[0].requirementId).toBe("");
    expect(out.fit.score).toBe(72);
  });
});

describe("older saved reviews", () => {
  it("map doNotAdd → gaps and get empty summaries", () => {
    const old = {
      ...fixtureScore("2026-10-07").result,
      fit: { total: 55, band: "stretch", parts: { mustHaves: 25 } },
      match: {
        total: 72,
        band: "moderate",
        termsFound: [],
        termsMissing: [],
      },
      doNotAdd: ["AWS"],
    } as unknown as ScoreResult;
    delete (old as Partial<ScoreResult>).gaps;
    const r = upgradeScoreResult(old);
    expect(r.gaps).toEqual(["AWS"]);
    expect(r.fit.summary).toBe("");
    expect(r.match.summary).toBe("");
  });
});

describe("legacy eligibility notes", () => {
  const post =
    "You must hold an active TS/SCI clearance. Able to obtain a Secret clearance. Must be a US citizen.";
  const b = (o: Partial<ClaudeBlocker>): ClaudeBlocker => ({
    type: "existing_clearance",
    quote: "You must hold an active TS/SCI clearance",
    mandatory: true,
    unmet: true,
    why: "",
    ...o,
  });

  it("keeps incoming notes for manual checking without confirming blockers", () => {
    const r = classifyBlockers(
      [
        b({}),
        b({ quote: "Must have 10 years at Google" }), // not in the post
        b({ quote: "Able to obtain a Secret clearance", mandatory: false }),
        b({ type: "citizenship", quote: "Must be a US citizen", unmet: false }), // the workspace owner is a citizen
        b({ type: "other", quote: "Must be a US citizen" }),
      ],
      post,
    );
    expect(r.confirmed).toHaveLength(0);
    expect(r.check).toHaveLength(5);
    expect(
      r.check.every((c) => c.reason.includes("checked by the workspace owner")),
    ).toBe(true);
  });
});

describe("posting age", () => {
  const today = "2026-10-07";
  it.each([
    ["Posted today", "2026-10-07"],
    ["Posted 5 hours ago", "2026-10-07"],
    ["Posted yesterday", "2026-10-06"],
    ["Posted 3 days ago", "2026-10-04"],
    ["2 weeks ago", "2026-09-23"],
    ["Posted 30+ days ago", "2026-09-06"],
    ["Date posted: 2026-10-01", "2026-10-01"],
    ["Posted on Oct 2, 2026", "2026-10-02"],
    ["Posted 2 October 2026", "2026-10-02"],
    ["Posted 10/02/2026", "2026-10-02"],
    ["Apply now", null],
  ])("%s → %s", (text, date) => {
    expect(parsePostedText(text, today)).toBe(date);
  });

  it.each([
    [0, "fresh"],
    [3, "fresh"],
    [4, "recent"],
    [7, "recent"],
    [8, "older"],
    [30, "older"],
    [31, "stale"],
    [null, "unknown"],
    [-2, "unknown"],
  ] as const)("%s days → %s", (days, band) => {
    expect(ageBand(days)).toBe(band);
  });

  it("requires the quote to be in the post, and the workspace owner's override wins", () => {
    const post = "Backend Engineer. Posted 2 days ago.";
    expect(postingAge("Posted 2 days ago", "", post, today)).toMatchObject({
      days: 2,
      band: "fresh",
      source: "post",
    });
    expect(postingAge("Posted 9 days ago", "", post, today).band).toBe(
      "unknown",
    );
    expect(postingAge("", "", post, today, "2026-09-01")).toMatchObject({
      days: 36,
      band: "stale",
      source: "override",
    });
    // Claude's normalized date is only a fallback for a verified quote that doesn't parse.
    expect(
      postingAge("Posted", "2026-10-01", "Posted: early October", today).days,
    ).toBe(6);
    // A future date is unreliable.
    expect(postingAge("Posted", "2026-12-01", "Posted x", today).band).toBe(
      "unknown",
    );
  });

  it("formats the line", () => {
    expect(
      ageLine({
        date: "2026-10-05",
        days: 2,
        band: "fresh",
        source: "post",
        quote: "",
        reposted: false,
      }),
    ).toBe("2 days ago — Fresh");
    expect(
      ageLine({
        date: null,
        days: null,
        band: "unknown",
        source: null,
        quote: "",
        reposted: false,
      }),
    ).toBe("Unknown");
  });
});
