import { z } from "zod";
import { parseBody, errorResponse } from "@/lib/api";
import { assessTailorMatch } from "@/lib/tailorMatch";
export async function POST(req: Request) {
  try {
    const { runId } = await parseBody(
      req,
      z.object({ runId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }),
    );
    return Response.json(await assessTailorMatch(runId, req.signal));
  } catch (e) {
    return errorResponse(e);
  }
}
