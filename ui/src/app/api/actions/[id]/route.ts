import { NextResponse } from "next/server";
import { z } from "zod";
import { completeAction, changeAction } from "@/lib/actions";
import { errorResponse, parseBody } from "@/lib/api";
export const runtime = "nodejs";
export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    z.uuid().parse(id);
    const body = await parseBody(
      req,
      z
        .object({
          revision: z.number().int().positive(),
          state: z.literal("completed").optional(),
          dismiss: z.literal(true).optional(),
          dismissNew: z.literal(true).optional(),
          remove: z.literal(true).optional(),
          keepCompleted: z.string().min(1).optional(),
          hidden: z.boolean().optional(),
          reason: z.string().trim().min(1).max(2000).optional(),
        })
        .strict()
        .refine(
          (body) =>
            [
              body.state !== undefined,
              body.dismiss !== undefined,
              body.dismissNew !== undefined,
              body.remove !== undefined,
              body.keepCompleted !== undefined,
              body.hidden !== undefined,
              body.reason !== undefined,
            ].filter(Boolean).length === 1,
          "Choose exactly one action change",
        ),
    );
    return NextResponse.json(
      body.state
        ? await completeAction(id, body.revision)
        : await changeAction(id, body.revision, body),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
