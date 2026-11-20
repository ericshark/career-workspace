// Skip removes one unsubmitted review and, when uniquely linked, its To apply row.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NotFoundError, parseApplications } from "./applications";
import { ConflictError, sha256, withFileLock } from "./fileStore";
import { APPLICATIONS_FILE, CAREER_ROOT, resolveInside } from "./paths";
import { findSaved, forgetReviewCache } from "./reviews";
import { forgetCompletedReview } from "./scoreState";
import { loadRun } from "./runs";
import { rowsForReview } from "./applicationRecord";
import { joinTable, splitTable } from "./markdown/table";
import { APPLICATIONS_HEADER } from "./types";
import { statusColumn } from "./status";

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export async function discardReview(runId: string): Promise<void> {
  if (!ID_RE.test(runId)) throw new NotFoundError("Unknown review");
  const run = loadRun(runId);
  const saved = findSaved(runId);
  if (!run || (saved && saved.summary.kind !== "review"))
    throw new NotFoundError("Unknown review");
  const file = resolveInside(CAREER_ROOT, APPLICATIONS_FILE)!;
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const targets = [
    path.join(CAREER_ROOT, "ui", ".cache", "runs", `${runId}.json`),
    ...(saved
      ? [saved.summary.jsonPath, saved.summary.mdPath].map((p) =>
          resolveInside(CAREER_ROOT, p)!,
        )
      : []),
  ];
  const staged: { original: string; backup: string }[] = [];
  try {
    await withFileLock(
      file,
      sha256(current),
      (text) => {
        const payload = parseApplications(text);
        if (text && payload.readOnly)
          throw new ConflictError("Applications cannot be edited safely");
        const rows = rowsForReview(
          {
            ...run.result,
            id: runId,
            sourceRecordId: run.request.sourceRecordId,
          },
          payload.rows,
        );
        if (rows.length > 1)
          throw new ConflictError("Multiple tracker rows match this review");
        if (rows.some((row) => statusColumn(row.status).column !== "to apply"))
          throw new ConflictError("An applied tracker row uses this review");
        if (
          !rows.length &&
          (run.decision === "applied" || run.decision === "later")
        )
          throw new ConflictError(
            "This review was logged; its tracker link cannot be resolved safely",
          );
        let next = text;
        if (rows.length) {
          const table = splitTable(text, APPLICATIONS_HEADER);
          if (!table.found)
            throw new ConflictError("Applications table format changed");
          table.body.splice(rows[0].lineIndex, 1);
          next = joinTable(table);
        }
        // Quarantine files before committing the table. Restore every moved file if staging or
        // the atomic table write fails, so a failed request keeps the review recoverable.
        for (const original of targets)
          if (fs.existsSync(original)) {
            const backup = `${original}.discard-${randomUUID()}`;
            fs.renameSync(original, backup);
            staged.push({ original, backup });
          }
        return next;
      },
      { initialText: "" },
    );
  } catch (error) {
    for (const { original, backup } of staged.reverse())
      fs.renameSync(backup, original);
    throw error;
  }
  forgetReviewCache();
  forgetCompletedReview(runId);
  // The transaction has committed. Cleanup failure leaves recoverable quarantined files.
  for (const { backup } of staged) {
    try {
      fs.rmSync(backup, { force: true });
    } catch {
      /* excluded from saved review discovery */
    }
  }
}
