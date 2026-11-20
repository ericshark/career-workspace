import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { markReviewViewed } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await ctx.params;
    const viewedAt = markReviewViewed(runId);
    if (!viewedAt) throw new ApiError("NOT_FOUND", "Unknown review", 404);
    return NextResponse.json({ viewedAt });
  } catch (e) {
    return errorResponse(e);
  }
}
