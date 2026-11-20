import { NextResponse } from "next/server";
import { z } from "zod";
import { recruitingView, editRecruiting } from "@/lib/recruiting";
import { parseBody, errorResponse } from "@/lib/api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  try {
    return NextResponse.json(await recruitingView());
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(req: Request) {
  try {
    const body = await parseBody(
      req,
      z
        .object({
          fileHash: z.string().min(1),
          seen: z.array(z.string().min(1)).default([]),
          viewed: z.array(z.string().min(1)).default([]),
          dismissedAppointments: z.array(z.string().min(1)).default([]),
          dismissed: z.array(z.string().min(1)).default([]),
        })
        .strict()
        .refine(
          (b) =>
            b.seen.length +
              b.viewed.length +
              b.dismissed.length +
              b.dismissedAppointments.length >
            0,
          "Choose an update",
        ),
    );
    return NextResponse.json(
      await editRecruiting(
        body.fileHash,
        [],
        body.seen,
        body.viewed,
        body.dismissed,
        body.dismissedAppointments,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const { resolveRecruiting, linkHistoricalAction, editOpenAction } =
      await import("@/lib/recruiting");
    const body = await parseBody(
      req,
      z
        .object({
          kind: z.enum(["match", "action", "action-edit"]),
          input: z.unknown(),
        })
        .strict(),
    );
    return NextResponse.json(
      await (body.kind === "match"
        ? resolveRecruiting(body.input)
        : body.kind === "action-edit"
          ? editOpenAction(body.input)
          : linkHistoricalAction(body.input)),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
