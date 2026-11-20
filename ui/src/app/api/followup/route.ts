import { readPreferences } from "@/lib/preferences";
import { effectiveContextMode } from "@/lib/jobContext";
import { loadRun } from "@/lib/runs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/api";
import { MAX_FOLLOWUP_HISTORY } from "@/lib/claude/followup";
import { DEFAULT_EXTRAS_MODEL, MODEL_IDS } from "@/lib/config";
import { answerFollowup } from "@/lib/followup";
import { withModelDeadline } from "@/lib/claude/deadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const followupRequest = z.object({
  runId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  question: z.string().trim().min(1).max(4000),
  history: z
    .array(
      z.object({
        q: z.string().max(4000),
        a: z.string().max(8000),
      }),
    )
    .max(MAX_FOLLOWUP_HISTORY)
    .optional(),
  model: z.enum(MODEL_IDS).optional(),
});

// One follow-up question about a saved review, answered inside the request. Not saved anywhere.
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, followupRequest);
    const started = Date.now();
    const prefs = readPreferences();
    const model = body.model ?? DEFAULT_EXTRAS_MODEL;
    const run = loadRun(body.runId);
    const contextMode = run
      ? effectiveContextMode(run.request, run.request.postFormat)
      : prefs.contextMode;
    const answer = await withModelDeadline(req.signal, 120_000, (signal) =>
      answerFollowup(
        { ...body, model: body.model ?? DEFAULT_EXTRAS_MODEL },
        signal,
      ),
    );
    return NextResponse.json({
      answer,
      generation: {
        model,
        effort:
          prefs.operationEfforts[`extras:${model}`] ?? prefs.efforts[model],
        contextMode,
        durationMs: Date.now() - started,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
