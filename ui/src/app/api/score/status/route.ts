import { NextResponse } from "next/server";
import { reviewStatus, reviewStatuses } from "@/lib/scoreState";

export const dynamic = "force-dynamic";

// The current (or last finished) background review: the Apply page and the header poll this.
export async function GET() {
  return NextResponse.json({
    ...reviewStatus(),
    jobs: reviewStatuses(),
    runningCount: reviewStatuses().filter((j) => j.running).length,
    queuedCount: reviewStatuses().filter((j) => j.status === "queued").length,
  });
}
