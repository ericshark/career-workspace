import { ApiError, errorResponse } from "@/lib/api";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const job = getJob((await ctx.params).id);
    if (!job) throw new ApiError("NOT_FOUND", "Unknown job", 404);
    job.abort.abort();
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}
