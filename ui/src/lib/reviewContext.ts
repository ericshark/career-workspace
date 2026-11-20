import { readApplications } from "./applications";
import { rowsForReview } from "./applicationRecord";
import { trackerBrief } from "./trackerBrief";
import { statusColumn } from "./status";
import type { RunRecord } from "./runs";

export async function reviewContext(run: RunRecord) {
  const r = run.result;
  const rows = (await readApplications()).rows;
  const linked = rowsForReview(
    { ...r, id: r.runId, sourceRecordId: run.request.sourceRecordId },
    rows,
  );
  const row = linked.length === 1 ? linked[0] : null;
  return {
    application: row
      ? {
          key: row.key,
          lineIndex: row.lineIndex,
          recordId: row.recordId,
          status: row.status,
        }
      : null,
    brief: trackerBrief(
      run.request.jobBrief,
      run.request.postFormat === "brief" ? run.request.jobPost : null,
      r.location,
      "",
      r.workMode,
    ),
    source: row?.source || r.source || run.request.source || "Unknown",
    resume: row?.resume || r.resume,
    date: row?.date || run.savedAt.slice(0, 10),
    dateLabel:
      row && statusColumn(row.status).column !== "to apply"
        ? "Applied"
        : "Saved",
    status:
      linked.length > 1
        ? "ambiguous"
        : row
          ? statusColumn(row.status).column
          : {
              applied: "applied",
              later: "to apply",
              skip: "skipped",
              undecided: "not decided",
            }[run.decision || "undecided"],
  };
}
export type ReviewContext = Awaited<ReturnType<typeof reviewContext>>;
