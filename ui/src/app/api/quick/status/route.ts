import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { quickBatchDetail, quickBatches } from "@/lib/quickState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The list omits each batch's pasted job text (it is large and polled often). Restore and Undo read
// one batch in full with ?batchId=.
export function GET(req: Request) {
  try {
    const batchId = new URL(req.url).searchParams.get("batchId");
    if (!batchId) return NextResponse.json(quickBatches());
    const batch = quickBatchDetail(batchId);
    if (!batch)
      throw new ApiError("NOT_FOUND", "Quick Add batch not found", 404);
    return NextResponse.json({ batch });
  } catch (e) {
    return errorResponse(e);
  }
}
