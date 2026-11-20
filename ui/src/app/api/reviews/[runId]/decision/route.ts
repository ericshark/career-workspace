import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import { recordDecision } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Record a decision that writes no application row (Skip), or reset it.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await ctx.params;
    const { decision } = await parseBody(
      req,
      z.object({ decision: z.enum(["skip", "undecided"]) }),
    );
    if (!recordDecision(runId, decision))
      throw new ApiError("NOT_FOUND", "Unknown review", 404);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
