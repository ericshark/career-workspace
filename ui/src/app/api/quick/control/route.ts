import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import {
  cancelQuickBatch,
  dismissQuickBatchTop,
  markQuickBatchUndone,
  markQuickBatchesViewed,
  quickBatches,
  retryQuickBatch,
} from "@/lib/quickState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const controlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    batchId: z.string().min(8).max(64),
  }),
  z.object({
    action: z.literal("retry"),
    batchId: z.string().min(8).max(64),
  }),
  z.object({
    action: z.literal("mark-viewed"),
    batchIds: z.array(z.string().min(8).max(64)).optional(),
  }),
  z.object({
    action: z.literal("mark-undone"),
    batchId: z.string().min(8).max(64),
  }),
  z.object({
    action: z.literal("dismiss-top"),
    batchId: z.string().min(8).max(64).optional(),
  }),
]);

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, controlSchema);
    switch (body.action) {
      case "cancel":
        cancelQuickBatch(body.batchId);
        break;
      case "retry": {
        const retried = retryQuickBatch(body.batchId);
        if (!retried)
          throw new ApiError("NOT_FOUND", "Quick Add batch not found", 404);
        break;
      }
      case "mark-viewed":
        markQuickBatchesViewed(body.batchIds);
        break;
      case "mark-undone":
        markQuickBatchUndone(body.batchId);
        break;
      case "dismiss-top":
        dismissQuickBatchTop(body.batchId);
        break;
    }
    return NextResponse.json(quickBatches());
  } catch (e) {
    return errorResponse(e);
  }
}
