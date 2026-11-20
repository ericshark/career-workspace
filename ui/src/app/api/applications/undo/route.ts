import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import { MAX_QUICK } from "@/lib/config";
import { undoLog, undoMany } from "@/lib/undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const undoRequest = z.union([
  z.object({ undoId: z.string() }),
  z.object({ undoIds: z.array(z.string()).min(1).max(MAX_QUICK) }),
]);

// Undo the last log from the Apply page, by the opaque id that log returned (valid two minutes, once).
// A batch quick add sends all its ids; those are undone newest first and partial failures reported.
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, undoRequest);
    if ("undoId" in body) {
      await undoLog(body.undoId);
      return NextResponse.json({ ok: true, undone: 1, failed: 0 });
    }
    const { undone, failed } = await undoMany(body.undoIds);
    if (!undone)
      throw new ApiError(
        "CONFLICT",
        "Nothing could be undone (expired or edited since); change it in the Tracker instead",
        409,
      );
    return NextResponse.json({ ok: true, undone, failed });
  } catch (e) {
    return errorResponse(e);
  }
}
