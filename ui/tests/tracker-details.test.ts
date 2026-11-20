import { describe, it, expect } from "vitest";
import { cleanBriefMarkdown, formatJobBrief } from "@/lib/jobBrief";
describe("tracker summaries", () => {
  it("omits placeholder metadata while retaining known partial fields", () => {
    expect(
      cleanBriefMarkdown(
        "# Acme — Engineer\n\n- Compensation: Not stated.\n- Location/work mode: New York; work mode not stated.\n\nQualifications:\n- Required: Python",
      ),
    ).toBe(
      "# Acme — Engineer\n\n- Location/work mode: New York\n\nQualifications:\n- Required: Python",
    );
  });
  it("omits empty sections and keeps required/preferred distinctions", () => {
    const text = formatJobBrief("Acme", "Engineer", {
      overview: "Build software for customers.",
      experience: "",
      location: "",
      compensation: "",
      responsibilities: [],
      qualifications: ["Required: Python", "Preferred: React"],
    });
    expect(text).not.toContain("Responsibilities:");
    expect(text).not.toContain("Experience:");
    expect(text).toContain("Required: Python");
    expect(text).toContain("Preferred: React");
  });
});

describe("legacy placeholder cleanup", () => {
  it("drops headings left with only placeholder bullets", () => {
    expect(
      cleanBriefMarkdown(
        "Responsibilities:\n- Unknown\n\nQualifications:\n- Preferred: SQL",
      ),
    ).toBe("Qualifications:\n- Preferred: SQL");
  });
});

import { renderReviewMarkdown } from "@/lib/reviews";
import { fixtureScore } from "@/lib/claude/fixtures";
import type { RunRecord } from "@/lib/runs";
it("renders legacy review fields without rewriting canonical scoring data", () => {
  const { result, analysis } = fixtureScore("2026-10-29");
  Reflect.deleteProperty(result, "gaps");
  const record: RunRecord = {
    version: 2,
    request: { jobPost: "Saved legacy description", resume: "tech" },
    result,
    analysis,
    savedAt: "2026-10-29T12:00:00Z",
  };
  const before = JSON.stringify(record);
  expect(renderReviewMarkdown(record)).toContain("Requirements and evidence");
  expect(JSON.stringify(record)).toBe(before);
});

import { trackerBrief } from "@/lib/trackerBrief";
import { reviewForRecord } from "@/lib/applicationRecord";
import type { SavedReviewSummary } from "@/lib/types";
it("presents legacy briefs without losing requirements or pay units", () => {
  const brief = trackerBrief(
    undefined,
    "# Acme — Engineer\n\nBuild useful services.\n- Experience: 0–2 years or equivalent projects\n- Location/work mode: NYC; hybrid\n- Compensation: $50/hour\n\nResponsibilities:\n- Build APIs\nQualifications:\n- Required: Python\n- Preferred: React",
  );
  expect(brief).toMatchObject({
    overview: "Build useful services.",
    experience: "0–2 years or equivalent projects",
    workMode: "Hybrid",
    compensation: "$50/hour",
    qualifications: ["Required: Python", "Preferred: React"],
    responsibilities: ["Build APIs"],
  });
  expect(trackerBrief(undefined, null, "New York").workMode).toBe("");
  expect(trackerBrief().overview).toBe("");
});
it("prefers structured briefs and preserves their complete content", () => {
  const brief = {
    overview: "Build customer applications.",
    experience: "Equivalent experience accepted",
    location: "Remote, US",
    compensation: "$100k–$120k/year",
    responsibilities: ["Build services"],
    qualifications: ["Preferred: SQL"],
  };
  expect(trackerBrief(brief, "Old overview")).toEqual({
    ...brief,
    workMode: "Remote",
  });
});
it("requires a saved full review associated with the exact record, not a score or title", () => {
  const quick = {
    id: "q1",
    kind: "quick",
    company: "Acme",
    role: "Engineer",
  } as SavedReviewSummary;
  const unrelated = {
    id: "r1",
    kind: "review",
    sourceRecordId: "q2",
    savedAt: "2026-10-30",
  } as SavedReviewSummary;
  const linked = { ...unrelated, id: "r2", sourceRecordId: "q1" };
  expect(reviewForRecord(quick, [quick, unrelated])).toBeNull();
  expect(reviewForRecord(quick, [quick, unrelated, linked])).toEqual(linked);
  expect(reviewForRecord(null, [linked])).toBeNull();
  expect(
    reviewForRecord(quick, [{ ...linked, persistenceWarning: "Not saved" }]),
  ).toBeNull();
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { APPLICATIONS_HEADER } from "@/lib/types";

it("falls back to the saved QuickRecord when no tracker row is uniquely linked", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "tracker-details-unlinked-"),
  );
  try {
    fs.mkdirSync(path.join(root, "records/reviews"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "records/applications.md"),
      `${APPLICATIONS_HEADER}\n|${Array(12).fill("---").join("|")}|\n`,
    );
    vi.stubEnv("CAREER_ROOT", root);
    vi.resetModules();
    const { saveQuick } = await import("@/lib/reviews");
    const { trackerDetails } = await import("@/lib/trackerDetails");
    saveQuick({
      version: 2,
      kind: "quick",
      id: "unlinked-quick-1234",
      slug: "unlinked-co-engineer",
      savedAt: "2026-11-10T12:00:00Z",
      reviewedAt: "2026-11-10",
      postFormat: "brief",
      request: {
        jobPost: "# Unlinked Co — Engineer\n\nBuild distributed systems.",
        originalJobPost: "Original pasted post for Unlinked Co.",
        source: "Jobright",
        link: "https://jobright.ai/jobs/info/999",
        jobBrief: {
          overview: "Build distributed systems.",
          experience: "1+ years",
          responsibilities: ["Write Go services"],
          qualifications: ["Go"],
          location: "New York, NY",
          compensation: "$140,000/year",
        },
      },
      extract: {
        company: "Unlinked Co",
        role: "Engineer",
        location: "New York, NY",
        workMode: "hybrid",
        level: "",
        postedText: "Posted today",
        postedDate: "2026-11-10",
        jobId: "",
        suggestedResume: "tech",
      },
      age: {
        date: "2026-11-10",
        days: 0,
        band: "fresh",
        source: "post",
        quote: "Posted today",
        reposted: false,
      },
      decision: "applied",
      resume: "tech",
    });
    const details = await trackerDetails("unlinked-quick-1234");
    expect(details).toMatchObject({
      id: "unlinked-quick-1234",
      company: "Unlinked Co",
      role: "Engineer",
      date: "2026-11-10",
      status: "applied",
      source: "Jobright",
      usedResume: "tech",
      postedAt: "2026-11-10",
      original: "Original pasted post for Unlinked Co.",
    });
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
