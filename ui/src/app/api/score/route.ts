import { trackerDetails } from "@/lib/trackerDetails";
import { readPreferences } from "@/lib/preferences";
import { executeReview } from "@/lib/executeReview";
import { MODEL_IDS } from "@/lib/types";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import { pendingReview, startReview } from "@/lib/scoreState";
import type {
  ClaudeReviewOutput,
  ScoreRequest,
  ScoreResult,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const scoreRequest = z.object({
  sourceRecordId: z.string().min(8).optional(),
  jobPost: z.string().min(1).max(50_000).optional(),
  resume: z.enum(["tech", "general", "datacenter"]).optional(),
  // Accept "linkedin.com/jobs/1" by prefixing https:// before validating.
  link: z
    .string()
    .trim()
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url())
    .optional(),
  source: z.string().max(100).optional(),
  model: z.enum(MODEL_IDS).optional(),
  ignoreDuplicate: z.boolean().optional(),
});

// Live scoring through the Agent SDK. UI_FIXTURES=1 returns canned data instead (no plan usage).
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, scoreRequest);
    const prefsForJob = readPreferences();
    const details = body.sourceRecordId
      ? await trackerDetails(body.sourceRecordId)
      : null;
    if (details?.review)
      return NextResponse.json({ runId: details.review.runId });
    const request: ScoreRequest = details
      ? {
          jobPost: details.original ?? details.summary ?? "",
          resume: details.resume,
          link: details.link || undefined,
          source: details.source,
          sourceRecordId: body.sourceRecordId,
          sourceApplicationKey: details.applicationKey,
          trackerCompany: details.company,
          trackerRole: details.role,
          model: prefsForJob.selections[prefsForJob.provider].review,
          ignoreDuplicate: true,
        }
      : { ...body, jobPost: body.jobPost ?? "", resume: body.resume ?? "tech" };
    if (request.jobPost.length < 200)
      throw new ApiError(
        "VALIDATION",
        "The saved description is too short to review (200 characters required).",
        400,
      );

    if (request.sourceRecordId && pendingReview(request))
      throw new ApiError(
        "CONFLICT",
        "This job is already in the review queue",
        409,
      );
    const prefs = readPreferences();
    const model = request.model ?? "gpt-6.1-terra";
    request.effort =
      prefs.operationEfforts[`review:${model}`] ?? prefs.efforts[model];

    // Run the review in the background: leaving or refreshing the page never cancels it. The page
    // polls /api/score/status and loads the result from /api/runs/<runId> when it's done.
    const runId = randomUUID();
    startReview(
      runId,
      request.jobPost,
      async (signal, onStep) => {
        await executeReview(request, runId, signal, onStep);
      },
      120_000,
      request,
    );
    return NextResponse.json({ runId }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
