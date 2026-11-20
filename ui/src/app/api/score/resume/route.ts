import { resumeReview } from "@/lib/scoreState";
import { errorResponse, parseBody, fail } from "@/lib/api";
import { z } from "zod";
export async function POST(req: Request) {
  try {
    const { runId } = await parseBody(
      req,
      z.object({ runId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }),
    );
    if (!(await resumeReview(runId)))
      return fail("NOT_FOUND", "No resumable review", 404);
    return Response.json({ resumed: true });
  } catch (e) {
    return errorResponse(e);
  }
}
