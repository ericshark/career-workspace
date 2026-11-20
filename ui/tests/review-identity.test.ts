import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  buildNewApplication,
  confirmDefaults,
} from "@/components/applyHelpers";
import { fixtureScore, FIXTURE_POST } from "@/lib/claude/fixtures";
import { removeTestRoot } from "./seedResumes";

const link = "https://acme.test/jobs/1";
let root: string;
let table: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "review-identity-"));
  table = path.join(root, "records/applications.md");
  fs.mkdirSync(path.dirname(table));
  fs.copyFileSync(
    path.join(import.meta.dirname, "fixtures/applications.one-row.md"),
    table,
  );
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  removeTestRoot(root);
});

async function setup(reviewLink = link) {
  const { loadRun, persistRun } = await import("@/lib/runs");
  const { findSaved } = await import("@/lib/reviews");
  const { readApplications, upsertApplication } =
    await import("@/lib/applications");
  const { correctReviewIdentity, reviewIdentityCorrection } =
    await import("@/lib/correctReviewIdentity");
  const { result, analysis } = fixtureScore("2026-10-08", reviewLink);
  result.company = " ";
  result.role = "Unknown job title";
  const saved = persistRun({
    version: 2,
    request: { jobPost: FIXTURE_POST, resume: "tech", link: reviewLink },
    analysis,
    result,
    savedAt: "2026-10-08T10:00:00Z",
  })!;
  const id = result.runId;
  return {
    result,
    saved,
    readApplications,
    upsertApplication,
    load: () => loadRun(id)!,
    savedReview: () => findSaved(id)?.summary,
    correct: (field: "company" | "role", value: string) =>
      correctReviewIdentity(
        id,
        reviewIdentityCorrection.parse({ field, value }),
      ),
  };
}

it("logs a blank review identity and keeps separate linkless placeholders distinct", async () => {
  const { result, readApplications, upsertApplication } = await setup("");
  result.role = "";
  const values = confirmDefaults(result, "tech", "Other", "");
  for (const reviewId of ["review-identity-1", "review-identity-2"]) {
    const { fileHash } = await readApplications();
    await upsertApplication(
      { ...buildNewApplication(fileHash, "submitted", values), reviewId },
      "2026-10-08",
      undefined,
      {},
    );
  }
  expect(
    (await readApplications()).rows.filter(
      (row) => row.company === "Unknown" && row.role === "Unknown",
    ),
  ).toHaveLength(2);
  expect(
    buildNewApplication("hash", "later", {
      ...values,
      company: "Acme",
      role: "Engineer",
    }).row,
  ).toMatchObject({ company: "Acme", role: "Engineer" });
});

it("corrects an unlinked review without writing to the Tracker and rejects stale or invalid edits", async () => {
  const { correct, load, savedReview } = await setup("");
  const before = fs.readFileSync(table, "utf8");
  for (const value of [" ", "Unknown company", "A\nB", "x".repeat(201)])
    expect(() => correct("company", value)).toThrow();
  await expect(correct("company", "  Example Inc  ")).resolves.toMatchObject({
    result: { company: "Example Inc" },
    context: { application: null },
  });
  await expect(correct("company", "Other")).rejects.toThrow(
    "already has a value",
  );
  expect(load().result.company).toBe("Example Inc");
  expect(savedReview()?.company).toBe("Example Inc");
  expect(fs.readFileSync(table, "utf8")).toBe(before);
});

it("fills the missing field on a linked legacy row and keeps a known field", async () => {
  fs.writeFileSync(
    table,
    fs
      .readFileSync(table, "utf8")
      .replace(
        "| Acme | Software Engineer |",
        "| Unknown | Software Engineer |",
      ),
  );
  const { correct, result, readApplications, savedReview, saved } =
    await setup();
  await correct("company", "Example Inc");
  await correct("role", "Backend Developer");
  expect((await readApplications()).rows[0]).toMatchObject({
    recordId: result.runId,
    company: "Example Inc",
    role: "Software Engineer",
    status: "applied",
  });
  expect(savedReview()).toMatchObject({
    slug: saved.slug,
    company: "Example Inc",
    role: "Backend Developer",
  });
});

it("rejects ambiguous links without updating either copy", async () => {
  const original = fs.readFileSync(table, "utf8");
  const row = original
    .split("\n")
    .find((line) => line.startsWith("| 2026-10-05 | Acme"))!;
  const ambiguous = original.replace(
    row,
    row + "\n" + row.replace("2026-10-05", "2026-10-06"),
  );
  fs.writeFileSync(table, ambiguous);
  const { correct, load, savedReview } = await setup();
  await expect(correct("company", "Example Inc")).rejects.toThrow(
    "Multiple Tracker rows",
  );
  expect(load().result.company).toBe(" ");
  expect(savedReview()?.company).toBe(" ");
  expect(fs.readFileSync(table, "utf8")).toBe(ambiguous);
});

it("refuses to edit a logged review when only placeholder names match", async () => {
  fs.writeFileSync(
    table,
    fs
      .readFileSync(table, "utf8")
      .replace(
        "| Acme | Software Engineer |",
        "| Unknown | Unknown job title |",
      ),
  );
  const { correct, load, result } = await setup("");
  const { recordDecision } = await import("@/lib/runs");
  recordDecision(result.runId, "applied");
  const before = fs.readFileSync(table, "utf8");
  await expect(correct("company", "Example Inc")).rejects.toThrow(
    "could not be identified safely",
  );
  expect(load().result.company).toBe(" ");
  expect(fs.readFileSync(table, "utf8")).toBe(before);
});

it("restores both review copies and rendered Markdown when the Tracker commit fails", async () => {
  const { correct, load, savedReview, saved } = await setup();
  const before = fs.readFileSync(table, "utf8");
  const markdown = path.join(root, saved.mdPath);
  const previousMarkdown = fs.readFileSync(markdown, "utf8");
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (to === table) throw new Error("Tracker write failed");
    return rename(from, to);
  });
  await expect(correct("company", "Example Inc")).rejects.toThrow(
    "Tracker write failed",
  );
  expect(load().result.company).toBe(" ");
  expect(savedReview()?.company).toBe(" ");
  expect(fs.readFileSync(markdown, "utf8")).toBe(previousMarkdown);
  expect(fs.readFileSync(table, "utf8")).toBe(before);
});
