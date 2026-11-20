import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { buildQuickBatchPrompt } from "@/lib/quick";
import {
  readPrompt,
  fillInstructions,
  quickInstructions,
  reviewInstructions,
} from "@/lib/claude/prompts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-prompts-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "prompts"));
  return root;
}

it("keeps Quick Add's job-brief instructions identical to the review's", () => {
  // Both workflows save the same kind of brief; prompts/README.md says to edit them together.
  const { jobBrief } = reviewInstructions(readPrompt("review-job.md"));
  expect(quickInstructions("quick-add.md").userPrompt).toContain(
    jobBrief.trim(),
  );
});

it("fills every Quick Add slot and appends the job data after the instructions", () => {
  const prompt = buildQuickBatchPrompt([{ description: "Acme is hiring." }]);
  expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  expect(prompt).toMatch(/^Below are 1 job post entered/);
  expect(prompt).toMatch(
    /\n<job_posts>\n<job number="1">\nJob 1\nURL: none\nDescription:\nAcme is hiring\.\n<\/job>\n<\/job_posts>$/,
  );
});

it("tells Quick Add to infer supported titles and leave missing work details empty", () => {
  const prompt = buildQuickBatchPrompt([
    { description: "Company information only." },
  ]);
  expect(prompt).toContain('Use "Unknown" when the employer is unnamed');
  expect(prompt).toContain(
    "closest conventional title from the stated duties and qualifications",
  );
  expect(prompt).toContain(
    '"Unknown" for the role and Quick Add will use its default title',
  );
  expect(prompt).toContain('set jobBrief.overview to "Unknown"');
  expect(prompt).toContain(
    "responsibilities and qualifications as empty arrays",
  );
});

it("reads the next edit and never falls back to archived rules", () => {
  const root = temporaryRoot();
  const file = path.join(root, "prompts/review-job.md");
  fs.writeFileSync(file, "first");
  expect(readPrompt("review-job.md", root)).toBe("first");
  fs.writeFileSync(file, "second");
  expect(readPrompt("review-job.md", root)).toBe("second");
  fs.mkdirSync(path.join(root, "archive/skills/apply"), { recursive: true });
  fs.copyFileSync(
    file,
    path.join(root, "archive/skills/apply/classification.md"),
  );
  fs.unlinkSync(file);
  expect(() => readPrompt("review-job.md", root)).toThrow(
    "Missing prompts/review-job.md",
  );
});

it("rejects traversal and redirected prompt files", () => {
  const root = temporaryRoot();
  expect(() => readPrompt("../archive/rules.md", root)).toThrow(
    /Invalid prompt/,
  );
  fs.writeFileSync(path.join(root, "other.md"), "redirected");
  fs.symlinkSync(
    path.join(root, "other.md"),
    path.join(root, "prompts/review-job.md"),
  );
  expect(() => readPrompt("review-job.md", root)).toThrow(
    /Source outside Career/,
  );
});

it("replaces instruction slots once and refuses unknown slots", () => {
  expect(
    fillInstructions("{{jobBrief}}", { jobBrief: "literal {{plural}}" }),
  ).toBe("literal {{plural}}");
  expect(() => fillInstructions("{{typo}}", {})).toThrow(/Unknown prompt slot/);
});

it("loads Quick Add system instructions from disk and reports malformed sections", async () => {
  const root = temporaryRoot();
  const file = path.join(root, "prompts/quick-add.md");
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
  const { quickInstructions } = await import("@/lib/claude/prompts");
  fs.writeFileSync(
    file,
    "## System prompt\n\nCustom system\n\n## User prompt\n\nCustom task\n",
  );
  expect(quickInstructions("quick-add.md")).toEqual({
    systemPrompt: "Custom system",
    userPrompt: "Custom task",
  });
  fs.writeFileSync(file, "broken headings");
  expect(() => quickInstructions("quick-add.md")).toThrow(
    /Invalid prompt sections/,
  );
});

it("loads a Quick Add system prompt and assembles plural batches", () => {
  expect(quickInstructions("quick-add.md").systemPrompt).toMatch(/JSON schema/);
  const prompt = buildQuickBatchPrompt([
    { description: "First" },
    { description: "Second" },
  ]);
  expect(prompt).toMatch(/^Below are 2 job posts entered/);
  expect(prompt).toContain(
    '<job number="2">\nJob 2\nURL: none\nDescription:\nSecond\n</job>',
  );
});
