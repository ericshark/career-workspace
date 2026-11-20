import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { savedRecordForRow } from "@/lib/applicationRecord";
import { migrateV2ToV3, parseApplications } from "@/lib/applications";
import { JobBriefSchema, formatJobBrief } from "@/lib/jobBrief";
import { ReviewModelSchema } from "@/lib/claude/schemas";
import { fixtureAnalysis } from "@/lib/claude/fixtures";
import { parseRow, splitTable } from "@/lib/markdown/table";
import { APPLICATIONS_HEADER, APPLICATIONS_HEADER_V2 } from "@/lib/types";
import type { SavedReviewSummary } from "@/lib/types";

const fixture = path.join(
  import.meta.dirname,
  "fixtures/applications.one-row.md",
);

function summary(id: string, link = ""): SavedReviewSummary {
  return {
    kind: "review",
    id,
    slug: id,
    jsonPath: `records/reviews/${id}.json`,
    mdPath: `records/reviews/${id}.md`,
    company: "Acme",
    role: "Software Engineer",
    link,
    jobId: "",
    reviewedAt: "2026-10-05",
    savedAt: "2026-10-05T12:00:00Z",
    decision: "applied",
    fit: 82,
    match: 71,
  };
}

describe("saved job briefs", () => {
  it("omits unstated facts and rejects a missing or empty brief", () => {
    const brief = {
      overview: "Build backend services for customer applications.",
      experience: "3 years required",
      responsibilities: ["Build APIs"],
      qualifications: ["Python"],
      location: "",
      compensation: "",
    };
    expect(JobBriefSchema.safeParse(brief).success).toBe(true);
    expect(formatJobBrief("Acme", "Engineer", brief)).toBe(
      "# Acme — Engineer\n\nBuild backend services for customer applications.\n\n- Experience: 3 years required\n\nResponsibilities:\n- Build APIs\n\nQualifications:\n- Python",
    );
    expect(JobBriefSchema.safeParse(undefined).success).toBe(false);
    expect(
      JobBriefSchema.safeParse({
        ...brief,
        responsibilities: [],
        qualifications: [],
      }).success,
    ).toBe(false);
  });

  it("requires a brief in Review's structured output", () => {
    const review = fixtureAnalysis();
    expect(ReviewModelSchema.safeParse(review).success).toBe(false);
    expect(
      ReviewModelSchema.safeParse({
        ...review,
        jobBrief: {
          overview: "Build backend services for customer applications.",
          experience: "",
          responsibilities: ["Build APIs"],
          qualifications: [],
          location: "",
          compensation: "",
        },
      }).success,
    ).toBe(true);
  });

  it("adds blank record IDs to old rows without changing their values", () => {
    const original = fs.readFileSync(fixture, "utf8");
    const migrated = migrateV2ToV3(original);
    const before = splitTable(original, APPLICATIONS_HEADER_V2);
    const after = splitTable(migrated, APPLICATIONS_HEADER);
    expect(after.found).toBe(true);
    expect(after.prefix).toBe(before.prefix);
    expect(after.suffix).toBe(before.suffix);
    expect(after.body.map((line) => parseRow(line)?.slice(0, 11))).toEqual(
      before.body.map((line) => parseRow(line)),
    );
    expect(parseApplications(migrated).rows[0].recordId).toBe("");
    expect(migrateV2ToV3(migrated)).toBe(migrated);
  });

  it("uses an exact ID, then only unique legacy matches", () => {
    const row = parseApplications(fs.readFileSync(fixture, "utf8")).rows[0];
    const first = summary("review-111", row.link);
    const second = summary("review-222", "");
    expect(
      savedRecordForRow({ ...row, recordId: first.id }, [second, first]),
    ).toBe(first);
    expect(
      savedRecordForRow({ ...row, recordId: "missing-id" }, [first]),
    ).toBeNull();
    expect(savedRecordForRow(row, [first, second])).toBe(first);
    expect(savedRecordForRow(row, [second])).toBe(second);
    expect(savedRecordForRow({ ...row, link: "" }, [first, second])).toBeNull();
    expect(
      savedRecordForRow(row, [first, summary("review-333", row.link)]),
    ).toBeNull();
  });
});
