import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/api";
import {
  MAX_QUICK,
  MAX_QUICK_BATCH_CHARS,
  MAX_QUICK_JOB_CHARS,
  PROVIDERS,
} from "@/lib/config";
import { enqueueQuickBatch } from "@/lib/quickState";
import { SOURCES } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const quickRequest = z.object({
  batchId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/)
    .optional(),
  jobs: z
    .array(
      z.object({
        submissionId: z
          .string()
          .regex(/^[A-Za-z0-9-]{8,64}$/)
          .optional(),
        link: z.string().trim().max(2000).optional(),
        description: z.string().trim().min(25).max(MAX_QUICK_JOB_CHARS),
      }),
    )
    .min(1)
    .max(MAX_QUICK)
    .refine(
      (jobs) => {
        const ids = jobs.flatMap((job) =>
          job.submissionId ? [job.submissionId] : [],
        );
        return new Set(ids).size === ids.length;
      },
      { message: "Each job card needs its own submission ID" },
    )
    .refine(
      (jobs) =>
        jobs.reduce((n, j) => n + j.description.length, 0) <=
        MAX_QUICK_BATCH_CHARS,
      {
        message: `Too much text in one batch (${MAX_QUICK_BATCH_CHARS.toLocaleString("en-US")} characters max)`,
      },
    ),
  source: z.enum(SOURCES).optional(),
  provider: z.enum(PROVIDERS).optional(),
});

export async function POST(req: Request) {
  try {
    const request = await parseBody(req, quickRequest);
    const { batchId, promise } = enqueueQuickBatch(request);
    const result = await promise;
    return NextResponse.json(
      { batchId, ...result },
      { status: result.added.length ? 201 : 200 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
