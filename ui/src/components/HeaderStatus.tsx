"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReviewJobStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { formatElapsed } from "./applyHelpers";
import { HealthDot } from "./HealthDot";
import { useFetchJson } from "./useFetchJson";

/**
 * "Reviewing… 0:42" while a background review runs, on every page. Polls every 3 s, only while the
 * tab is visible; the elapsed time ticks locally in between.
 */
function ReviewingPill() {
  // Shared with every other reader of the status endpoint: one request, at the fastest cadence asked.
  const status = useFetchJson<
    ReviewJobStatus & { runningCount?: number; queuedCount?: number }
  >("/api/score/status", { intervalMs: 3000 });
  const s = status.data;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  if (!s?.running || !s.startedAt) return null;
  return (
    <Badge
      asChild
      variant="secondary"
      className="h-7 px-2.5 text-sm tabular-nums"
    >
      <Link href="/apply" title={s.step ?? "Reviewing"}>
        <Spinner data-icon="inline-start" />
        Reviewing {s.runningCount ?? 1}
        {s.queuedCount ? ` · ${s.queuedCount} queued` : ""}…{" "}
        {formatElapsed(now - s.startedAt)}
      </Link>
    </Badge>
  );
}

// Right side of the header: review in progress and the plan-login health dot. Counts and the
// streak live on Today only.
export function HeaderStatus() {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-3">
      <ReviewingPill />
      <span className="hidden sm:inline-flex">
        <HealthDot />
      </span>
    </div>
  );
}
