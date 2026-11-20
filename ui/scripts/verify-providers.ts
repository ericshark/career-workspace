// Explicit live verification: real UI orchestration, disposable records, no applications submitted.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

if (process.argv[2] !== "--live") {
  console.error(
    "Uses Claude and OpenAI API billing. Run npm run verify:providers -- --live",
  );
  process.exit(2);
}
const selectedProvider = process.argv
  .find((arg) => arg.startsWith("--provider="))
  ?.split("=")[1];
if (selectedProvider && !["claude", "openai"].includes(selectedProvider))
  throw new Error("--provider must be claude or openai");
const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.dirname(ui);
process.chdir(ui);
// Use Next's environment precedence, including ui/.env.local, before importing server modules.
nextEnv.loadEnvConfig(ui, true);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-live-providers-"));
process.env.CAREER_ROOT = root;
try {
  for (const rel of [
    "profile/career.md",
    "source/tech/resume.tex",
    "prompts/answer-questions.md",
    "prompts/cover-letter.md",
  ]) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), dest);
  }
  const { generateExtras } = await import("../src/lib/extras");
  const { fixtureScore } = await import("../src/lib/claude/fixtures");
  const { persistRun, loadRun } = await import("../src/lib/runs");
  const jobPost =
    "SDK Verification Co — Backend Engineer. Build Python services, maintain PostgreSQL data, test APIs and collaborate with engineers. This is a synthetic job used only for SDK verification.";
  for (const [index, model] of (
    ["claude-sonnet-5-5", "gpt-6.1-sol"] as const
  ).entries()) {
    if (
      selectedProvider &&
      selectedProvider !== (model.startsWith("claude") ? "claude" : "openai")
    )
      continue;
    const runId = `sdk-verification-${index}`;
    const { analysis, result } = fixtureScore(
      "2026-10-27",
      undefined,
      undefined,
      runId,
    );
    persistRun({
      version: 2,
      request: { jobPost, resume: "tech" },
      analysis,
      result: {
        ...result,
        company: "SDK Verification Co",
        role: "Backend Engineer",
        requirements: [],
        recommendedChanges: [],
      },
      savedAt: new Date().toISOString(),
    });
    const target = { kind: "review" as const, id: runId };
    for (const operation of ["questions", "coverLetter"] as const) {
      const started = Date.now();
      try {
        const extras = await generateExtras(
          {
            target,
            model,
            ...(operation === "questions"
              ? {
                  questions: [
                    "Which experience best prepares you to build reliable backend services?",
                  ],
                }
              : { coverLetter: true }),
            note: "Keep the draft concise. Avoid unnecessary numerical claims.",
          },
          AbortSignal.timeout(180_000),
          false,
        );
        if (operation === "questions") {
          assert.equal(extras.questions?.at(-1)?.result.answers.length, 1);
          assert.equal(
            extras.questions?.at(-1)?.result.answers[0].options.length,
            3,
          );
        } else assert.ok(extras.coverLetter?.result.letter.trim());
        const saved = loadRun(runId)?.extras;
        assert.ok(
          operation === "questions"
            ? saved?.questions?.length
            : saved?.coverLetter?.result.letter,
        );
        console.log(
          `PASS ${model} ${operation}: validated and saved (${Date.now() - started} ms)`,
        );
      } catch (error) {
        process.exitCode = 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`FAIL ${model} ${operation}: ${message}`);
        if ((error as { kind?: string }).kind === "auth") {
          if (operation === "questions")
            console.error(
              `SKIP ${model} coverLetter: provider authentication is blocked; no automatic retry.`,
            );
          break;
        }
      }
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  console.log("Disposable records removed.");
}
