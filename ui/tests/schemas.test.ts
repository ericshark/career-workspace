import { describe, expect, it } from "vitest";
import { fixtureAnalysis } from "@/lib/claude/fixtures";
import {
  ReviewSchema,
  ReviewModelSchema,
  TailorReportSchema,
  reviewJsonSchema,
  tailorReportJsonSchema,
} from "@/lib/claude/schemas";

const valid = fixtureAnalysis();

describe("ReviewSchema", () => {
  it("parses valid output", () => {
    expect(ReviewSchema.safeParse(valid).success).toBe(true);
  });

  const req = valid.requirements[0];
  it.each([
    ["hourly resume", { suggestedResume: "hourly" }],
    ["no requirements", { requirements: [] }],
    ["bad requirement kind", { requirements: [{ ...req, kind: "required" }] }],
    ["bad credit", { requirements: [{ ...req, career: "full" }] }],
    ["bad presence", { requirements: [{ ...req, resume: "header" }] }],
    ["bad fix", { requirements: [{ ...req, fix: "medium" }] }],
    ["fit above 100", { fit: { score: 120, summary: "" } }],
    ["negative match", { match: { score: -1, summary: "" } }],
    ["bad recommendation", { recommendation: { kind: "rewrite", reason: "" } }],
    [
      "bad blocker type",
      {
        blockers: [
          { type: "visa", quote: "", mandatory: true, unmet: true, why: "" },
        ],
      },
    ],
  ])("rejects %s", (_name, patch) => {
    expect(ReviewSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("rejects missing fields", () => {
    const { why: _w, ...rest } = valid;
    expect(ReviewSchema.safeParse(rest).success).toBe(false);
  });

  it("keeps legacy stored blockers readable while new model output requires none", () => {
    expect(
      ReviewSchema.safeParse({
        ...valid,
        blockers: [
          {
            type: "existing_clearance",
            quote: "Active clearance required",
            mandatory: true,
            unmet: true,
            why: "Legacy claim",
          },
        ],
      }).success,
    ).toBe(true);
    const schema = reviewJsonSchema() as Record<string, any>;
    expect(schema.properties.blockers.maxItems).toBe(0);
  });

  it("offers only Use Master or Tailor in new reviews while keeping old recommendation records readable", () => {
    for (const kind of ["light-tailor", "dont-tailor"] as const)
      expect(
        ReviewSchema.safeParse({
          ...valid,
          recommendation: { kind, reason: "Legacy" },
        }).success,
      ).toBe(true);
    const schema = reviewJsonSchema() as Record<string, any>;
    expect(schema.properties.recommendation.properties.kind.enum).toEqual([
      "use-master",
      "tailor",
    ]);
  });

  it("excludes eligibility requirements from new model reviews while preserving historical records", () => {
    const legacy = {
      ...valid,
      requirements: [{ ...req, kind: "eligibility" }],
    };
    expect(ReviewSchema.safeParse(legacy).success).toBe(true);
    const jobBrief = {
      overview: "Develop backend APIs and database services.",
      experience: "",
      responsibilities: ["Build APIs"],
      qualifications: [],
      location: "",
      compensation: "",
    };
    expect(ReviewModelSchema.safeParse({ ...valid, jobBrief }).success).toBe(
      true,
    );
    expect(ReviewModelSchema.safeParse({ ...legacy, jobBrief }).success).toBe(
      false,
    );
    const schema = reviewJsonSchema() as Record<string, any>;
    expect(schema.properties.requirements.items.properties.kind.enum).toEqual([
      "must",
      "nice",
    ]);
  });
});

describe("JSON schemas for the SDK", () => {
  for (const [name, schema] of [
    ["review", reviewJsonSchema()],
    ["tailor report", tailorReportJsonSchema()],
  ] as const) {
    it(`${name} is draft-07 compatible`, () => {
      const s = schema as Record<string, unknown>;
      // Newer drafts (2019-09 / 2020-12) are rejected by the SDK.
      if (s.$schema !== undefined)
        expect(s.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(JSON.stringify(s)).not.toMatch(/2019-09|2020-12|\$defs/);
      expect(s.type).toBe("object");
    });
  }

  it("review schema has no score fields: Claude only classifies", () => {
    const s = reviewJsonSchema() as Record<string, any>;
    expect(Object.keys(s.properties)).not.toContain("total");
    expect(Object.keys(s.properties)).not.toContain("parts");
    expect(s.properties.suggestedResume.enum).toEqual([
      "tech",
      "general",
      "datacenter",
    ]);
  });

  it("tailor report parses", () => {
    expect(
      TailorReportSchema.safeParse({
        changes: [{ requirementId: "r1", after: "x", careerQuote: "y" }],
        requirements: [
          { id: "r1", presence: "bullet", placement: "prominent", quote: "x" },
        ],
        notes: "",
      }).success,
    ).toBe(true);
  });
});
