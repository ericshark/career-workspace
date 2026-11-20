import { jobKeyFromUrl, normalizeCompany, normalizeUrl } from "./duplicates";
import { isMissingJobIdentity } from "./jobIdentity";
import type { ApplicationRow, SavedReviewSummary } from "./types";

/** Legacy rows have no record ID; accept only a single exact posting or company/role match. */
export function savedRecordForRow(
  row: ApplicationRow,
  records: SavedReviewSummary[],
): SavedReviewSummary | null {
  if (row.recordId)
    return records.find((record) => record.id === row.recordId) ?? null;
  const linkMatches = row.link
    ? records.filter((record) => {
        if (!record.link) return false;
        const left = jobKeyFromUrl(row.link);
        return (
          normalizeUrl(record.link) === normalizeUrl(row.link) ||
          (left !== null && jobKeyFromUrl(record.link) === left)
        );
      })
    : [];
  if (linkMatches.length === 1) return linkMatches[0];
  if (linkMatches.length > 1) return null;
  const nameMatches = records.filter(
    (record) =>
      ![row.company, row.role, record.company, record.role].some(
        isMissingJobIdentity,
      ) &&
      normalizeCompany(record.company) === normalizeCompany(row.company) &&
      record.role.trim().toLowerCase() === row.role.trim().toLowerCase(),
  );
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

/** A completed full review must belong to this exact saved job. */
export function reviewForRecord(
  saved: SavedReviewSummary | null,
  records: SavedReviewSummary[],
): SavedReviewSummary | null {
  if (!saved) return null;
  return (
    records
      .filter(
        (record) =>
          record.kind === "review" &&
          !record.persistenceWarning &&
          (record.id === saved.id || record.sourceRecordId === saved.id),
      )
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null
  );
}

/** All plausible linked rows, so destructive operations can reject ambiguous associations. */
export function rowsForReview(
  review: Pick<
    SavedReviewSummary,
    "id" | "sourceRecordId" | "link" | "company" | "role" | "jobId"
  >,
  rows: ApplicationRow[],
): ApplicationRow[] {
  const linked = rows.filter(
    (row) =>
      row.recordId === review.id ||
      (!!review.sourceRecordId && row.recordId === review.sourceRecordId),
  );
  if (linked.length) return linked;
  return rows.filter((row) => {
    if (review.link && row.link) {
      const key = jobKeyFromUrl(review.link);
      return (
        normalizeUrl(row.link) === normalizeUrl(review.link) ||
        (key !== null && jobKeyFromUrl(row.link) === key)
      );
    }
    return (
      !review.link &&
      ![row.company, row.role, review.company, review.role].some(
        isMissingJobIdentity,
      ) &&
      normalizeCompany(row.company) === normalizeCompany(review.company) &&
      row.role.trim().toLowerCase() === review.role.trim().toLowerCase()
    );
  });
}
