import { describe, expect, it } from "vitest";
import {
  buildNewApplication,
  bumpSlug,
  confirmDefaults,
  fitColor,
  formatElapsed,
  matchColor,
  initialTailorState,
  isFinished,
  laneForResume,
  sanitizeSlugInput,
  baseCategory,
  tailorPassed,
  tailorValidated,
  tailorRecommended,
  tailorReducer,
} from "@/components/applyHelpers";
import type { BuildResult, ScoreResult, TailorResult } from "@/lib/types";
import { currentRecommendation } from "@/lib/resumeRecommendation";

const build = (o: Partial<BuildResult> = {}): BuildResult => ({
  ok: true,
  pages: 1,
  fillPct: 97,
  ats: "PASS",
  warnings: [],
  failures: [],
  pdfPath: "resumes/tailored/acme/Resume.pdf",
  pngPath: null,
  raw: "",
  ...o,
});
const tailor = (o: Partial<TailorResult> = {}): TailorResult => ({
  validationMethod: "controlled",
  evidenceValidation: "passed",
  hashes: { source: "a".repeat(64), pdf: "b", career: "c" },
  manualApproval: {
    hashes: { source: "a".repeat(64), pdf: "b", career: "c" },
    at: "2026-10-08",
  },
  slug: "acme-swe",
  texPath: "source/tailored/acme-swe/resume.tex",
  pdfPath: "resumes/tailored/acme-swe/Resume.pdf",
  pngUrl: "/api/files?path=ui/.cache/png/acme.png",
  build: build(),
  mastersUnchanged: true,
  candidateHash: "a".repeat(64),
  verification: {
    report: true,
    evidence: true,
    visual: true,
    readingOrder: true,
  },
  deniedToolCalls: [],
  changes: [],
  estimate: null,
  actualMatch: null,
  meta: { model: "m", durationMs: 1 },
  ...o,
});
const score = (o: Partial<ScoreResult> = {}): ScoreResult =>
  ({
    runId: "r1",
    company: "Acme",
    role: "SWE",
    location: "NYC",
    fit: { total: 78, band: "reasonable" },
    match: { total: 66, band: "moderate" },
    suggestedResume: "tech",
    suggestedSlug: "acme-swe",
    verdict: { kind: "apply", text: "Apply" },
    recommendation: { kind: "tailor", text: "Tailor", reason: "" },
    ...o,
  }) as ScoreResult;

describe("score colors and tailoring", () => {
  it("colors Candidate Fit by band (80 / 60 / 45)", () => {
    expect(fitColor(80)).toBe("green");
    expect(fitColor(79)).toBe("blue");
    expect(fitColor(60)).toBe("blue");
    expect(fitColor(59)).toBe("orange");
    expect(fitColor(45)).toBe("orange");
    expect(fitColor(44)).toBe("grey");
  });
  it("colors Resume Match by band (80 / 60)", () => {
    expect(matchColor(80)).toBe("green");
    expect(matchColor(60)).toBe("blue");
    expect(matchColor(59)).toBe("orange");
  });
  it("recommends a single Tailor action and supports historical recommendations", () => {
    expect(tailorRecommended(score())).toBe(true);
    for (const kind of ["use-master", "dont-tailor"] as const)
      expect(
        tailorRecommended(
          score({ recommendation: { kind, text: "", reason: "" } }),
        ),
      ).toBe(false);
  });
  it.each(["light-tailor", "tailor", "dont-tailor", "use-master"] as const)(
    "presents legacy %s without changing the stored recommendation",
    (kind) => {
      const recommendation = {
        kind,
        text: "old label",
        reason: "original reasoning",
      };
      const before = JSON.stringify(recommendation);
      const current = currentRecommendation(recommendation);
      expect(current.kind).toBe(
        kind === "light-tailor" || kind === "tailor" ? "tailor" : "use-master",
      );
      expect(current.text).toBe(
        current.kind === "tailor" ? "Tailor" : "Use Master",
      );
      expect(current.reason).toBe("original reasoning");
      expect(JSON.stringify(recommendation)).toBe(before);
      expect(tailorRecommended({ recommendation })).toBe(
        current.kind === "tailor",
      );
    },
  );
});

describe("formatting", () => {
  it("formats elapsed time", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_900)).toBe("1:05");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("NewApplication payload", () => {
  it("lane follows the resume", () => {
    expect(laneForResume("datacenter")).toBe("bridge");
    expect(laneForResume("hourly")).toBe("bridge");
    expect(laneForResume("tech")).toBe("tech");
    expect(laneForResume("tailored/acme")).toBe("tech");
  });
  it("master selected: that master, both scores, lane from the resume, today's date", () => {
    const v = confirmDefaults(
      score(),
      "datacenter",
      "LinkedIn",
      "",
      null,
      new Date(2026, 9, 7),
    );
    expect(v).toMatchObject({
      resume: "datacenter",
      lane: "bridge",
      fit: 78,
      match: 66,
      date: "2026-10-06",
    });
  });
  it("tailored selected: Match is the tailored resume's own (or blank)", () => {
    expect(
      confirmDefaults(score(), "tailored/acme-swe", "LinkedIn", "", 85),
    ).toMatchObject({ resume: "tailored/acme-swe", lane: "tech", match: 85 });
    expect(
      confirmDefaults(score(), "tailored/acme-swe", "LinkedIn", "").match,
    ).toBeNull();
  });
  it("a tailor run only passes with a clean build, ATS and untouched masters", () => {
    expect(tailorPassed(tailor())).toBe(true);
    expect(tailorPassed(tailor({ verification: undefined }))).toBe(false);
    expect(tailorPassed(tailor({ candidateHash: undefined }))).toBe(false);
    expect(
      tailorPassed(
        tailor({
          verification: {
            report: true,
            evidence: true,
            visual: false,
            readingOrder: true,
          },
        }),
      ),
    ).toBe(false);
    expect(tailorPassed(tailor({ build: build({ ats: "FAIL" }) }))).toBe(false);
    expect(tailorPassed(tailor({ mastersUnchanged: false }))).toBe(false);
  });
  it("rejects a done event that advertises success without passing verification", () => {
    const result = tailor({
      verification: {
        report: true,
        evidence: true,
        visual: false,
        readingOrder: true,
      },
    });
    const state = tailorReducer(initialTailorState, {
      type: "done",
      ok: true,
      result,
    });
    expect(state.ok).toBe(false);
  });
  it("selects a validated draft without a manual approval step", () => {
    const draft = tailor({ manualApproval: undefined });
    expect(tailorValidated(draft)).toBe(true);
    expect(tailorPassed(draft)).toBe(true);
    expect(
      tailorReducer(initialTailorState, {
        type: "done",
        ok: true,
        result: draft,
      }).ok,
    ).toBe(true);
    expect(tailorPassed(tailor({ validationMethod: undefined }))).toBe(false);
    expect(
      tailorPassed(
        tailor({ hashes: { source: "changed", pdf: "b", career: "c" } }),
      ),
    ).toBe(false);
  });
  it("maps a resume option to the master it is based on", () => {
    expect(baseCategory("general", {})).toBe("general");
    expect(
      baseCategory("tailored/acme", { "tailored/acme": "datacenter" }),
    ).toBe("datacenter");
    expect(baseCategory("tailored/unknown", {})).toBe("tech");
  });
  it("omits blank optional fields and clamps scores", () => {
    const v = confirmDefaults(
      score(),
      "tech",
      "Referral",
      "  ",
      null,
      new Date(2026, 9, 6),
    );
    expect(buildNewApplication("h", "later", v)).toEqual({
      fileHash: "h",
      decision: "later",
      date: "2026-10-05",
      row: {
        company: "Acme",
        role: "SWE",
        lane: "tech",
        resume: "tech",
        fit: 78,
        match: 66,
        source: "Referral",
      },
    });
    const b = buildNewApplication("h", "submitted", {
      ...v,
      fit: 104.6,
      match: null,
      link: " https://x.io ",
    });
    expect(b.row).toMatchObject({
      fit: 100,
      match: null,
      link: "https://x.io",
    });
  });
});

describe("slug input", () => {
  it("sanitizes typing", () => {
    expect(sanitizeSlugInput("Acme Corp_SWE!")).toBe("acme-corp-swe");
    expect(sanitizeSlugInput("--a---b")).toBe("a-b");
    expect(sanitizeSlugInput("x".repeat(80))).toHaveLength(60);
  });
  it("bumps to -2, -3 and stays within 60 chars", () => {
    expect(bumpSlug("acme")).toBe("acme-2");
    expect(bumpSlug("acme-2")).toBe("acme-3");
    const long = "a".repeat(60);
    const b = bumpSlug(long);
    expect(b.endsWith("-2")).toBe(true);
    expect(b.length).toBeLessThanOrEqual(60);
  });
});

describe("tailor SSE reducer", () => {
  it("accumulates steps and finishes on done", () => {
    let s = initialTailorState;
    s = tailorReducer(s, { type: "step", text: "a", at: 1 });
    s = tailorReducer(s, { type: "log", text: "hi", at: 2 });
    expect(isFinished(s)).toBe(false);
    s = tailorReducer(s, { type: "build", result: build() });
    s = tailorReducer(s, { type: "done", ok: true, result: tailor() });
    expect(s.steps).toHaveLength(1);
    expect(s.logs).toEqual(["hi"]);
    expect(s.ok).toBe(true);
    expect(isFinished(s)).toBe(true);
  });
  it("marks errors as finished and not ok", () => {
    const s = tailorReducer(initialTailorState, {
      type: "error",
      kind: "cancelled",
      message: "Cancelled",
    });
    expect(s.ok).toBe(false);
    expect(s.error?.kind).toBe("cancelled");
    expect(isFinished(s)).toBe(true);
  });
});
