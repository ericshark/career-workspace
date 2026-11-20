import { NextResponse } from "next/server";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import { AgentError, runAgent } from "@/lib/claude/agent";
import { PROVIDER_LABELS } from "@/lib/config";
import { readPreferences } from "@/lib/preferences";
import { workshopSelection } from "@/lib/workshop/modelSelection";
import {
  buildTaskPrompt,
  fixtureTasks,
  taskJsonSchema,
  taskRequestSchema,
  taskResultSchema,
} from "@/lib/workshop/tasks";

export const runtime = "nodejs";
export const maxDuration = 120;

const TIMEOUT_MS = 100_000;

/** One model call; resolves to the validated tasks, or null when unusable. */
async function suggest(
  selection: ReturnType<typeof workshopSelection>,
  systemPrompt: string,
  prompt: string,
) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("timeout")), TIMEOUT_MS);
  try {
    const result = await runAgent({
      operation: "workshop-tasks",
      model: selection.model,
      effort: selection.effort,
      // Claude delivers structured output through a tool call, which needs a
      // second turn; with 1, Haiku failed with "maximum number of turns".
      maxTurns: 3,
      allowedTools: [],
      signal: abort.signal,
      outputSchema: taskJsonSchema(),
      systemPrompt,
      prompt,
    });
    const parsed = taskResultSchema.safeParse(result.structuredOutput);
    return result.subtype === "success" && parsed.success ? parsed.data : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Turns a runner failure into a short message; the raw text stays in the server log. */
function friendly(error: unknown, provider: string) {
  console.error("workshop task suggestions failed:", error);
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AgentError && error.kind === "auth")
    return new ApiError(
      "CLAUDE_UNAVAILABLE",
      `Sign in to ${provider} and try again. ${message}`,
      503,
    );
  if (/timeout|timed out|aborted/i.test(message))
    return new ApiError(
      "CLAUDE_UNAVAILABLE",
      "The model took too long to answer. Try again, or pick a faster model in Model settings.",
      504,
    );
  return new ApiError(
    "CLAUDE_UNAVAILABLE",
    "Could not get task suggestions from the model. Try again, or pick another model in Model settings.",
    502,
  );
}

// Suggests tasks only. Nothing is saved until the browser sends an addTasks
// command to /api/workshop after the workspace owner reviews the preview.
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, taskRequestSchema);
    if (process.env.UI_FIXTURES === "1")
      return NextResponse.json(fixtureTasks(input));
    const { systemPrompt, prompt } = buildTaskPrompt(input);
    const selection = workshopSelection(readPreferences());
    // A malformed answer is retried once before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      let tasks;
      try {
        tasks = await suggest(selection, systemPrompt, prompt);
      } catch (error) {
        throw friendly(error, PROVIDER_LABELS[selection.provider]);
      }
      if (tasks) return NextResponse.json(tasks);
    }
    throw new ApiError(
      "CLAUDE_UNAVAILABLE",
      "Task suggestions did not return a usable result. Try again.",
      502,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
