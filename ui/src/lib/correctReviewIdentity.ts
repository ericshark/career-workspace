import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  migrateV2ToV3,
  NotFoundError,
  ReadOnlyError,
  parseApplications,
  readApplications,
  serializeApplication,
} from "./applications";
import { rowsForReview } from "./applicationRecord";
import { atomicWrite, ConflictError, withFileLock } from "./fileStore";
import { isMissingJobIdentity } from "./jobIdentity";
import { joinTable, splitTable } from "./markdown/table";
import { APPLICATIONS_FILE, CAREER_ROOT, resolveInside } from "./paths";
import {
  forgetReviewCache,
  REVIEWS_DIR,
  reviewSlug,
  saveReview,
} from "./reviews";
import { reviewContext } from "./reviewContext";
import { loadRun, saveRun, type RunRecord } from "./runs";
import { APPLICATIONS_HEADER } from "./types";

export const reviewIdentityCorrection = z.strictObject({
  field: z.enum(["company", "role"]),
  value: z
    .string()
    .max(200)
    .refine((value) => !/[\r\n]/.test(value), "Enter a single line")
    .trim()
    .refine(
      (value) => !isMissingJobIdentity(value),
      "Enter a company or job title",
    ),
});

export async function correctReviewIdentity(
  runId: string,
  { field, value }: z.infer<typeof reviewIdentityCorrection>,
) {
  const file = resolveInside(CAREER_ROOT, APPLICATIONS_FILE)!;
  const { fileHash } = await readApplications();
  const originals = new Map<string, string | null>();
  let corrected!: RunRecord;
  await withFileLock(
    file,
    fileHash,
    (text) => {
      const run = loadRun(runId);
      if (!run) throw new NotFoundError("Unknown review");
      if (!isMissingJobIdentity(run.result[field]))
        throw new ConflictError(
          "This field already has a value. Reopen the review to see it.",
        );

      const { rows, readOnly } = parseApplications(text);
      if (readOnly) throw new ReadOnlyError(readOnly.reason);
      const linked = rowsForReview(
        {
          ...run.result,
          id: runId,
          sourceRecordId: run.request.sourceRecordId,
        },
        rows,
      );
      if (linked.length > 1)
        throw new ConflictError("Multiple Tracker rows match this review");
      const row = linked[0];
      if (!row && (run.decision === "applied" || run.decision === "later"))
        throw new ConflictError(
          "This review's Tracker row could not be identified safely",
        );

      run.result[field] = value;
      const slug = reviewSlug(run);
      const paths = [
        path.join(CAREER_ROOT, "ui", ".cache", "runs", `${runId}.json`),
        resolveInside(CAREER_ROOT, `${REVIEWS_DIR}/${slug}.json`)!,
        resolveInside(CAREER_ROOT, `${REVIEWS_DIR}/${slug}.md`)!,
      ];
      let next = text;
      if (row && (!row.recordId || isMissingJobIdentity(row[field]))) {
        const table = splitTable(migrateV2ToV3(text), APPLICATIONS_HEADER);
        if (!table.found)
          throw new ReadOnlyError("Applications table format changed");
        table.body[row.lineIndex] = serializeApplication({
          ...row,
          recordId: row.recordId || runId,
          [field]: isMissingJobIdentity(row[field]) ? value : row[field],
        });
        next = joinTable(table);
      }

      // Restore both review copies if either review write or the Tracker commit fails.
      for (const target of paths)
        originals.set(
          target,
          fs.existsSync(/* turbopackIgnore: true */ target)
            ? fs.readFileSync(/* turbopackIgnore: true */ target, "utf8")
            : null,
        );
      delete run.result.meta.persistenceWarning;
      saveReview(run);
      saveRun(run);
      corrected = run;
      return next;
    },
    {
      rollback() {
        for (const [target, original] of originals) {
          if (original === null) fs.rmSync(target, { force: true });
          else if (
            !fs.existsSync(target) ||
            fs.readFileSync(target, "utf8") !== original
          )
            atomicWrite(target, original);
        }
        if (originals.size) forgetReviewCache();
      },
    },
  );
  return { result: corrected.result, context: await reviewContext(corrected) };
}
