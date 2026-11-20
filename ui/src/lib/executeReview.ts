import { localDate } from "./config";
import { loadInputSnapshot } from "./claude/inputs";
import { fixtureScore } from "./claude/fixtures";
import { scoreJobPost } from "./claude/score";
import { checkDuplicates } from "./dupCheck";
import { setReviewIdentity } from "./scoreState";
import { persistRun } from "./runs";
import type { ClaudeReviewOutput, ScoreRequest, ScoreResult } from "./types";
const FIXTURE_STEP_MS = Number(process.env.UI_FIXTURE_STEP_MS ?? 2500);
export async function executeReview(
  request: ScoreRequest,
  runId: string,
  signal: AbortSignal,
  onStep: (s: string) => void,
) {
  const today = localDate();
  let out: {
    result: ScoreResult;
    analysis: ClaudeReviewOutput;
    jobPostBrief?: string;
    jobBrief?: import("./jobBrief").JobBrief;
  };
  if (process.env.UI_FIXTURES === "1") {
    // Fixture mode: a short fake wait (cancelable) so navigation can be tested without Claude.
    for (const step of [
      "Preparing inputs",
      "Reviewing the job",
      "Checking keywords",
    ]) {
      onStep(step);
      await new Promise((r) => setTimeout(r, FIXTURE_STEP_MS));
      if (signal.aborted) throw new Error("cancelled");
    }
    out = fixtureScore(
      today,
      request.link,
      request.link ? checkDuplicates({ link: request.link }) : undefined,
      runId,
    );
  } else {
    out = await scoreJobPost(request, today, signal, onStep, runId);
  }
  if (process.env.UI_FIXTURES === "1")
    out.result.meta.sources = loadInputSnapshot(request.resume).sources;
  out.result.source = request.source;
  onStep("Saving review");
  if (signal.aborted) throw new Error("cancelled");
  setReviewIdentity(runId, out.result.company, out.result.role);
  persistRun({
    viewedAt: null,
    version: 2,
    request: {
      ...request,
      originalJobPost: request.jobPost,
      jobBrief: out.jobBrief,
      postFormat: "brief",
      jobPost:
        out.jobPostBrief ??
        `# ${out.result.company} — ${out.result.role}\n\nFixture job brief for UI verification.\n\nQualifications:\n${out.result.requirements.map((item) => `- ${item.text}`).join("\n")}`,
    },
    analysis: out.analysis,
    result: out.result,
    savedAt: new Date().toISOString(),
  });
}
