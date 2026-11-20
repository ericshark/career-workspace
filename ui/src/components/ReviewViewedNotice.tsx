"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

/** Mounted only alongside a displayed review, never by prefetching or progress polling. */
export function ReviewViewedNotice({ runId }: { runId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void fetch(`/api/reviews/${encodeURIComponent(runId)}/view`, {
      method: "POST",
    })
      .then((response) => {
        if (!response.ok) throw new Error("Could not mark viewed");
        if (live) window.dispatchEvent(new Event("review-viewed"));
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [runId, attempt]);
  return failed ? (
    <p role="status" className="text-xs text-warning">
      Couldn&apos;t save viewed status.{" "}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setAttempt((v) => v + 1)}
      >
        Retry
      </Button>
    </p>
  ) : null;
}
