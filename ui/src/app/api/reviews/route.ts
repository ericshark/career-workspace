import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import { findDuplicates } from "@/lib/duplicates";
import { readApplications } from "@/lib/applications";
import {
  historyItems,
  historyStatus,
  listReviews,
  reviewSlug,
} from "@/lib/reviews";
import { loadRun, updateRun, persistRun, unsavedRuns } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveRequest = z.object({
  runId: z.string().min(8),
  decision: z.enum(["applied", "later", "skip", "undecided"]).optional(),
});

// Re-save a review (every finished review is already saved automatically); optional decision.
export async function POST(req: Request) {
  try {
    const { runId, decision } = await parseBody(req, saveRequest);
    if (!loadRun(runId))
      throw new ApiError("NOT_FOUND", "Unknown score run", 404);
    if (decision) updateRun(runId, (r) => void (r.decision = decision));
    const run = loadRun(runId)!;
    const saved = persistRun(run);
    if (run.result.meta.persistenceWarning || !saved)
      throw new ApiError(
        "SAVE_FAILED",
        run.result.meta.persistenceWarning ?? "Could not save review",
        503,
      );
    return NextResponse.json(saved, {
      status: 201,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// GET → history: every saved review and quick add (newest first) with its derived status.
// GET ?link=… → only the saved records for that posting (exact URL / job id).
export async function GET(req: Request) {
  try {
    const link = new URL(req.url).searchParams.get("link");
    if (!link) {
      const apps = await readApplications();
      const items = historyItems(apps.rows);
      for (const run of unsavedRuns()) {
        const r = run.result;
        const slug = reviewSlug(run);
        const summary = {
          kind: "review" as const,
          viewedAt: run.viewedAt,
          id: r.runId,
          slug,
          jsonPath: `records/reviews/${slug}.json`,
          mdPath: `records/reviews/${slug}.md`,
          company: r.company,
          role: r.role,
          link: r.link,
          jobId: r.jobId,
          reviewedAt: r.reviewedAt,
          savedAt: run.savedAt,
          decision: run.decision ?? ("undecided" as const),
          fit: r.fit.total,
          match: r.match.total,
          persistenceWarning: r.meta.persistenceWarning,
        };
        const existing = items.findIndex((item) => item.id === r.runId);
        const item = { ...summary, status: historyStatus(summary, apps.rows) };
        if (existing < 0) items.push(item);
        else items[existing] = item;
      }
      items.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      return NextResponse.json({ items });
    }
    const all = listReviews();
    const hits = findDuplicates({ link }, [], all).exact.map(
      (m) => m.reviewPath,
    );
    return NextResponse.json({
      reviews: all.filter((r) => hits.includes(r.mdPath)),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
