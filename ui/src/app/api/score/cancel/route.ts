import { fail } from "@/lib/api";
import { cancelReview } from "@/lib/scoreState";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.runId !== undefined && typeof body.runId !== "string")
    return fail("VALIDATION", "Invalid runId", 400);
  if (!cancelReview(body.runId))
    return fail("NOT_FOUND", "No review is running", 404);
  return new Response(null, { status: 204 });
}
