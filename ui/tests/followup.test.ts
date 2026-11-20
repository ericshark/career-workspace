import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureScore, FIXTURE_POST } from "@/lib/claude/fixtures";
import {
  MAX_FOLLOWUP_HISTORY,
  buildFollowupPrompt,
  followupReviewContext,
} from "@/lib/claude/followup";
import type { RunRecord } from "@/lib/runs";

const repo = path.resolve(import.meta.dirname, "../..");

// CAREER_ROOT is read when lib/paths.ts loads: point it at a temp dir and import fresh.
let root: string;
async function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "followup-"));
  process.env.CAREER_ROOT = root;
  for (const rel of [
    "profile/career.md",
    "prompts/review-followup.md",
    "source/tech/resume.tex",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), path.join(root, rel));
  }
  vi.resetModules();
  return {
    followup: await import("@/lib/followup"),
    inputs: await import("@/lib/claude/inputs"),
    runs: await import("@/lib/runs"),
  };
}
afterEach(() => {
  delete process.env.CAREER_ROOT;
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function review() {
  const { result, analysis } = fixtureScore(
    "2026-10-19",
    undefined,
    undefined,
    "run-0001-abcd",
  );
  const rec: RunRecord = {
    version: 2,
    request: { jobPost: FIXTURE_POST, resume: "tech" },
    analysis,
    result,
    savedAt: "2026-10-19T12:00:00Z",
  };
  return rec;
}

it("sends the review, earlier turns (capped) and the question last", () => {
  const { result } = review();
  const history = Array.from({ length: MAX_FOLLOWUP_HISTORY + 2 }, (_, i) => ({
    q: `Earlier question ${i}`,
    a: `Earlier answer ${i}`,
  }));
  const prompt = buildFollowupPrompt(
    { careerEvidence: "Career facts", resumeVisible: "Resume text" },
    "Job post text",
    followupReviewContext(result),
    history,
    "  Should I tailor?  ",
  );
  expect(prompt).toContain(`Fit: ${result.fit.total}`);
  expect(prompt).toContain(`Verdict: ${result.verdict.text}`);
  expect(prompt).toContain("<resume>\nResume text\n</resume>");
  expect(prompt).not.toContain("Earlier question 1\n");
  expect(prompt).toContain("Earlier question 2");
  expect(prompt.trimEnd()).toMatch(
    /<question>\nShould I tailor\?\n<\/question>$/,
  );
  expect(prompt.indexOf("<earlier_turns>")).toBeGreaterThan(
    prompt.indexOf("</job_post>"),
  );
});

it("loads the scored master and career without contact details", async () => {
  const { inputs } = await setup();
  const loaded = inputs.loadFollowupInputs("tech");
  expect(loaded.followupRules).toContain("follow-up");
  expect(loaded.careerEvidence).not.toMatch(/^## Contact/m);
  expect(loaded.resumeVisible.length).toBeGreaterThan(100);
});

it("answers in fixture mode without writing to the run, and rejects unknown reviews", async () => {
  const { followup, runs } = await setup();
  runs.persistRun(review());
  const file = fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.includes("run-0001-abcd"))
    .map((d) => path.join(d.parentPath, d.name));
  expect(file.length).toBeGreaterThan(0);
  const before = file.map((f) => fs.readFileSync(f, "utf8"));
  const answer = await followup.answerFollowup(
    {
      runId: "run-0001-abcd",
      question: "Why stretch?",
      model: "claude-sonnet-5-5",
    },
    undefined,
    true,
  );
  expect(answer).toContain("Why stretch?");
  expect(file.map((f) => fs.readFileSync(f, "utf8"))).toEqual(before);
  await expect(
    followup.answerFollowup(
      { runId: "missing-0001", question: "x", model: "claude-sonnet-5-5" },
      undefined,
      true,
    ),
  ).rejects.toThrow(/Unknown review/);
});
