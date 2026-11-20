import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Does this tailor job still exist, and is it finished? Lets the Apply page reattach after navigation.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const job = getJob(id);
    if (!job) throw new ApiError("NOT_FOUND", "Unknown job", 404);
    return NextResponse.json({ id: job.id, done: job.done });
  } catch (e) {
    return errorResponse(e);
  }
}
