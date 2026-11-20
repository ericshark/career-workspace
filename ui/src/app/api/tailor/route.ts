import { createFixtureTailor } from "@/lib/claude/fixtureTailoring";
import { MODEL_IDS } from "@/lib/types";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import { assertSourcesCurrent } from "@/lib/claude/inputs";
import { runTailor } from "@/lib/claude/tailor";
import { runningJob, startJob } from "@/lib/jobs";
import { CAREER_ROOT } from "@/lib/paths";
import { loadRun } from "@/lib/runs";
import { isValidSlug } from "@/lib/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tailorRequest = z.object({
  runId: z.string().min(8),
  slug: z.string().min(1).max(60),
  overwrite: z.boolean().optional(),
  model: z.enum(MODEL_IDS).optional(),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Live tailoring via runTailor(). UI_FIXTURES=1 replays canned events instead (no plan usage).
export async function POST(req: Request) {
  try {
    const req_ = await parseBody(req, tailorRequest);
    const { runId, slug, overwrite } = req_;
    if (!isValidSlug(slug))
      throw new ApiError("VALIDATION", "Invalid slug", 400);
    const run = loadRun(runId);
    if (!run) throw new ApiError("NOT_FOUND", "Unknown score run", 404);
    assertSourcesCurrent(run.result.meta.sources);
    if (runningJob())
      throw new ApiError("CONFLICT", "A tailoring job is already running", 409);
    if (
      !overwrite &&
      fs.existsSync(path.join(CAREER_ROOT, "source", "tailored", slug))
    ) {
      throw new ApiError("CONFLICT", "Tailored folder already exists", 409, {
        slug,
      });
    }
    const job = startJob("tailor", async (emit, signal) => {
      if (process.env.UI_FIXTURES === "1") {
        const steps = [
          "Preparing inputs",
          "Drafting supported resume changes",
          "Building candidate",
          "Checking candidate evidence, text and rendered page",
        ];
        for (const text of steps) {
          if (signal.aborted)
            return emit({
              type: "error",
              kind: "cancelled",
              message: "Cancelled",
            });
          emit({ type: "step", text, at: Date.now() });
          await sleep(400);
        }
        await createFixtureTailor(req_, emit, signal);
        return;
      }
      await runTailor(req_, emit, signal);
    });
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
