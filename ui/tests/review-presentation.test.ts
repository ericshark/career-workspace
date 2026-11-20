import { describe, expect, it } from "vitest";
import { fixtureScore } from "@/lib/claude/fixtures";
import {
  evidenceLabel,
  filterHistory,
  needsDecision,
  reviewReasons,
  reviewJudgment,
  reviewTailoring,
  reviewDecisionActions,
  reviewDecisionBrief,
} from "@/lib/reviewPresentation";
import type { HistoryItem } from "@/lib/types";
const base: HistoryItem = {
  kind: "review",
  id: "review-1",
  slug: "review-1",
  jsonPath: "",
  mdPath: "",
  company: "Example",
  role: "Engineer",
  link: "",
  jobId: "",
  reviewedAt: "2026-10-30",
  savedAt: "2026-10-30T12:00:00Z",
  decision: "undecided",
  status: "not decided",
  fit: 80,
  match: 60,
};
describe("History decisions and filters", () => {
  it("keeps opened and unopened reviews pending, excludes decisions and logged jobs", () => {
    expect(needsDecision({ ...base, viewedAt: null })).toBe(true);
    expect(needsDecision({ ...base, viewedAt: "2026-10-30T12:05:00Z" })).toBe(
      true,
    );
    expect(needsDecision(base)).toBe(true);
    for (const status of [
      "applied",
      "to apply",
      "in progress",
      "rejected",
      "no response",
      "skipped",
    ])
      expect(needsDecision({ ...base, status })).toBe(false);
    for (const decision of ["skip", "applied", "later"] as const)
      expect(needsDecision({ ...base, decision })).toBe(false);
    expect(needsDecision({ ...base, kind: "quick" })).toBe(false);
  });
  it("returns exactly the requested saved entries, newest first without mutating its input", () => {
    const quick = {
      ...base,
      id: "quick-1",
      kind: "quick" as const,
      savedAt: "2026-10-30T14:00:00Z",
    };
    const decided = {
      ...base,
      id: "decided-1",
      status: "applied",
      savedAt: "2026-10-30T13:00:00Z",
    };
    const items = [base, quick, decided];
    expect(filterHistory(items, "all").map((i) => i.id)).toEqual([
      decided.id,
      base.id,
    ]);
    expect(filterHistory(items, "reviews").map((i) => i.id)).toEqual([
      decided.id,
    ]);
    expect(filterHistory(items, "undecided")).toEqual([base]);
    expect(filterHistory(items, "summaries")).toEqual([decided]);
    expect(items).toEqual([base, quick, decided]);
  });
});
it("labels qualification depth independently of quote verification and resume placement", () => {
  const { result } = fixtureScore("2026-10-30");
  for (const careerVerified of [true, false])
    for (const resumeVerified of [true, false])
      for (const [effectiveCredit, label] of [
        ["strong", "Supported"],
        ["partial", "Partial"],
        ["none", "Not documented"],
      ] as const)
        expect(
          evidenceLabel({
            ...result.requirements[0],
            effectiveCredit,
            careerVerified,
            resumeVerified,
          }),
        ).toBe(label);
});
it("keeps ordered reasons, removes duplicates and falls back without changing analysis", () => {
  const { result } = fixtureScore("2026-10-30");
  result.why = ["Strong API work.", "strong API work", "Database evidence"];
  result.fit.summary = "Practical testing";
  const before = structuredClone(result);
  expect(reviewReasons(result)).toEqual([
    "Strong API work.",
    "Database evidence",
    "Practical testing",
  ]);
  expect(result).toEqual(before);
  result.why = [];
  result.fit.summary = "";
  result.match.summary = "";
  expect(reviewReasons(result)).toEqual(result.gaps.slice(0, 3));
});

it("derives opportunity priority at every threshold without changing stored scores", () => {
  const { result } = fixtureScore("2026-11-02");
  result.recommendation.kind = "use-master";
  for (const [fit, label] of [
    [0, "Skip"],
    [29, "Skip"],
    [30, "Low priority"],
    [44, "Low priority"],
    [45, "Possible fit"],
    [59, "Possible fit"],
    [60, "Apply"],
    [79, "Apply"],
    [80, "Strong fit — apply as-is"],
    [100, "Strong fit — apply as-is"],
  ] as const) {
    result.fit.total = fit;
    expect(reviewJudgment(result)).toBe(label);
  }
});
it("requires useful edits for tailoring, including a substantive exception above Match 80", () => {
  const { result } = fixtureScore("2026-11-02");
  result.fit.total = 85;
  result.recommendation.kind = "tailor";
  result.recommendedChanges = [
    {
      action: "surface",
      requirementId: "r3",
      text: "Surface documented OAuth2 work",
    },
  ];
  result.match.total = null;
  expect(reviewTailoring(result)).toBe(false);
  for (const match of [45, 79, 80, 100]) {
    result.match.total = match;
    expect(reviewTailoring(result)).toBe(true);
    expect(reviewJudgment(result)).toBe("Strong fit — tailor first");
  }
  result.recommendedChanges[0].action = "reword";
  expect(reviewTailoring(result)).toBe(false);
  result.match.total = 60;
  expect(reviewTailoring(result)).toBe(false);
  result.recommendedChanges[0].action = "surface";
  expect(reviewTailoring(result)).toBe(true);
  result.fit.total = 59;
  expect(reviewTailoring(result)).toBe(false);
  result.fit.total = 80;
  result.recommendedChanges = [];
  expect(reviewTailoring(result)).toBe(false);
});
it("shows only decisions appropriate to current application status", () => {
  expect(reviewDecisionActions("not decided")).toEqual({
    skip: true,
    later: true,
    applied: true,
  });
  expect(reviewDecisionActions("to apply")).toEqual({
    skip: true,
    later: false,
    applied: true,
  });
  for (const status of [
    "applied",
    "in progress",
    "no response",
    "rejected",
    "ambiguous",
    "loading",
  ])
    expect(reviewDecisionActions(status)).toEqual({
      skip: false,
      later: false,
      applied: false,
    });
});
it("renders a legacy brief without a model call and filters pending reviewed jobs only", () => {
  const { result } = fixtureScore("2026-11-02");
  delete result.decisionBrief;
  expect(reviewDecisionBrief(result).strengths).toBeTruthy();
  expect(reviewDecisionBrief(result).gaps).toBeTruthy();
  const saved = { ...base, status: "to apply", decision: "later" as const };
  expect(
    filterHistory([base, saved, { ...saved, kind: "quick" }], "to-apply"),
  ).toEqual([base, saved]);
});
