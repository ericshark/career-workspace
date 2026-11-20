// Server-side duplicate check: reads applications.md (parsed, cached) and the saved reviews, then runs
// the pure matcher in lib/duplicates.ts. A read-only (v1/changed) table simply contributes no rows.
import fs from "node:fs";
import { parseApplications } from "./applications";
import { findDuplicates, type DuplicateQuery } from "./duplicates";
import { APPLICATIONS_FILE, CAREER_ROOT, resolveInside } from "./paths";
import { listReviews } from "./reviews";
import type { DuplicateReport } from "./types";

export function checkDuplicates(
  q: DuplicateQuery,
  sourceRecordId?: string,
  sourceApplicationKey?: string,
): DuplicateReport {
  const file = resolveInside(CAREER_ROOT, APPLICATIONS_FILE);
  const rows =
    file && fs.existsSync(file)
      ? parseApplications(fs.readFileSync(file, "utf8")).rows
      : [];
  return findDuplicates(
    q,
    rows.filter(
      (r) =>
        (!sourceRecordId || r.recordId !== sourceRecordId) &&
        (!sourceApplicationKey || r.key !== sourceApplicationKey),
    ),
    listReviews().filter((r) => r.id !== sourceRecordId),
  );
}
