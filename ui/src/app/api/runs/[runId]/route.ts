import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { findSaved } from "@/lib/reviews";
import { artifactHashes, sameHashes } from "@/lib/tailorApproval";
import { reviewContext } from "@/lib/reviewContext";
import { loadRun } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One review (ScoreResult) or quick add (QuickRecord) by id: the cache first, then the saved copy.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await ctx.params;
    const run = loadRun(runId);
    if (run) {
      if (run.tailor?.result) {
        try {
          if (
            !sameHashes(
              run.tailor.result.manualApproval?.hashes,
              artifactHashes(run.tailor.slug),
            )
          )
            run.tailor.result.manualApproval = undefined;
        } catch {
          run.tailor.result.manualApproval = undefined;
        }
      }
      return NextResponse.json({
        kind: "review",
        context: await reviewContext(run),
        viewedAt: run.viewedAt,
        result: {
          ...run.result,
          source: run.result.source ?? run.request.source,
          meta: {
            ...run.result.meta,
            originalAvailable:
              !!run.request.originalJobPost ||
              run.request.postFormat !== "brief",
            briefAvailable: run.request.postFormat === "brief",
          },
        },
        decision: run.decision ?? "undecided",
        jobPost: run.request.jobPost,
        postFormat: run.request.postFormat,
        tailor: run.tailor ?? null,
        extras: run.extras ?? null,
      });
    }
    const saved = findSaved(runId);
    if (saved?.summary.kind === "quick")
      return NextResponse.json({ kind: "quick", record: saved.record });
    throw new ApiError("NOT_FOUND", "Unknown review", 404);
  } catch (e) {
    return errorResponse(e);
  }
}
