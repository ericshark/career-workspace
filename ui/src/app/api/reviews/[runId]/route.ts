import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/api";
import {
  correctReviewIdentity,
  reviewIdentityCorrection,
} from "@/lib/correctReviewIdentity";
import { discardReview } from "@/lib/discardReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Skip: delete an unlogged review (cached run + saved records/reviews files).
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await ctx.params;
    await discardReview(runId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await ctx.params;
    const correction = await parseBody(req, reviewIdentityCorrection);
    return NextResponse.json(await correctReviewIdentity(runId, correction));
  } catch (e) {
    return errorResponse(e);
  }
}
