"use client";

import { useEffect, useRef, useState } from "react";
import type { LogLine } from "@/lib/dev/types";
import { cn } from "@/lib/utils";

const MAX_LINES = 5000;
// Terminal colour codes in a dev server's output; the log shows plain text.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** One run's live output, streamed from the server. */
export function LogsPanel({
  itemId,
  runId,
  title,
}: {
  itemId: string;
  runId: string;
  title: string;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [lost, setLost] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    setLines([]);
    setLost(false);
    const source = new EventSource(
      `/api/workshop/dev/${itemId}/logs?run=${encodeURIComponent(runId)}`,
    );
    source.addEventListener("backlog", (event) =>
      setLines(JSON.parse((event as MessageEvent).data) as LogLine[]),
    );
    source.addEventListener("lines", (event) =>
      setLines((previous) =>
        [
          ...previous,
          ...(JSON.parse((event as MessageEvent).data) as LogLine[]),
        ].slice(-MAX_LINES),
      ),
    );
    source.onerror = () => {
      // The run is gone (replaced or the server restarted): stop retrying.
      source.close();
      setLost(true);
    };
    return () => source.close();
  }, [itemId, runId]);

  // Follow the output unless the reader scrolled up.
  useEffect(() => {
    const element = box.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black text-zinc-100">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <h4 className="text-xs font-semibold">Logs · {title}</h4>
      </div>
      <div
        ref={box}
        role="log"
        aria-label={`Logs for ${title}`}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
        }}
        className="max-h-72 overflow-auto bg-black p-3 font-mono text-xs leading-5 text-zinc-100"
      >
        {lines.length === 0 && <p className="text-zinc-400">No output yet.</p>}
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "break-all whitespace-pre-wrap",
              line.stream === "err" && "text-red-300",
              line.stream === "sys" && "text-zinc-400",
            )}
          >
            {line.text.replace(ANSI, "") || " "}
          </div>
        ))}
        {lost && (
          <p className="pt-1 text-zinc-400">The log connection closed.</p>
        )}
      </div>
    </div>
  );
}
