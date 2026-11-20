import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/api";
import { DEFAULT_EXTRAS_MODEL, MODEL_IDS } from "@/lib/config";
import { generateExtras } from "@/lib/extras";
import { withModelDeadline } from "@/lib/claude/deadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const extrasRequest = z
  .object({
    target: z.object({
      kind: z.enum(["review", "quick"]),
      id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
    }),
    // One entry per question box; a single string is still accepted.
    questions: z
      .union([
        z.string().trim().max(20_000),
        z.array(z.string().trim().max(20_000)).max(30),
      ])
      .optional(),
    coverLetter: z.boolean().optional(),
    // the workspace owner's own steering note (style, emphasis, things to mention) for this request.
    note: z.string().trim().max(2000).optional(),
    resume: z.string().max(80).optional(),
    model: z.enum(MODEL_IDS).optional(),
  })
  .refine(
    (r) =>
      (Array.isArray(r.questions) ? r.questions.some(Boolean) : r.questions) ||
      r.coverLetter,
    {
      message: "Paste questions or ask for a cover letter",
    },
  );

// Extras for one saved review or quick add: answers to the application's questions and/or a cover
// letter. One tool-less call each (in parallel), run inside the request, saved with the record.
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, extrasRequest);
    const extras = await withModelDeadline(req.signal, 180_000, (signal) =>
      generateExtras(
        { ...body, model: body.model ?? DEFAULT_EXTRAS_MODEL },
        signal,
      ),
    );
    return NextResponse.json({ extras });
  } catch (e) {
    return errorResponse(e);
  }
}
