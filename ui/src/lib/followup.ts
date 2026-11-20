import { jobContext } from "./jobContext";
// Answer one follow-up question about a saved review (POST /api/followup). Nothing is written.
import { NotFoundError } from "./applications";
import {
  askFollowup,
  fixtureFollowup,
  type FollowupTurn,
} from "./claude/followup";
import { loadFollowupInputs } from "./claude/inputs";
import { loadRun } from "./runs";
import type { ModelId } from "./types";

export interface FollowupRequest {
  runId: string;
  question: string;
  history?: FollowupTurn[];
  model: ModelId;
}

export async function answerFollowup(
  req: FollowupRequest,
  signal?: AbortSignal,
  fixtures = process.env.UI_FIXTURES === "1",
): Promise<string> {
  const run = loadRun(req.runId);
  if (!run) throw new NotFoundError("Unknown review");
  if (fixtures) return fixtureFollowup(req.question);
  return askFollowup(
    loadFollowupInputs(run.result.resume),
    jobContext(run.request, run.request.postFormat),
    run.result,
    req.history ?? [],
    req.question,
    req.model,
    signal,
  );
}
