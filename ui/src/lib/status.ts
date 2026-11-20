// Status → board column. Pure (no node APIs) so both the tracker and tests can use it.
// Legacy values are read leniently and normalized when a row is moved.
import { STATUSES, type Status } from "./types";

export interface ColumnInfo {
  column: Status;
  /** The raw value when it isn't one of the supported statuses (legacy or hand-typed), else null. */
  legacy: string | null;
}

const LEGACY: Record<string, Status> = {
  replied: "in progress",
  screen: "in progress",
  interview: "in progress",
  offer: "in progress",
  ghosted: "no response",
};

/** Which of the status columns a raw status belongs in. Unknown values land in `applied`, flagged. */
export function statusColumn(raw: string): ColumnInfo {
  const s = raw.trim().toLowerCase();
  if ((STATUSES as readonly string[]).includes(s))
    return { column: s as Status, legacy: null };
  return { column: LEGACY[s] ?? "applied", legacy: raw };
}

export const STATUS_LABEL: Record<Status, string> = {
  "to apply": "To apply",
  applied: "Applied",
  "in progress": "In progress",
  "no response": "No response",
  rejected: "Rejected",
  unsuccessful: "Unsuccessful",
};

/** CSS color token per column (defined in globals.css). */
export const STATUS_COLOR: Record<Status, string> = {
  "to apply": "var(--warning)",
  applied: "var(--chart-1)",
  "in progress": "var(--chart-4)",
  "no response": "var(--warning)",
  rejected: "var(--destructive)",
  // Purple (in progress) blended into rose (rejected): rejected after progressing.
  unsuccessful: "color-mix(in oklab, var(--chart-4) 55%, var(--chart-5))",
};

/** Statuses where the application is over: the recruiting view treats them as closed. */
const CLOSED_STATUSES: readonly string[] = [
  "rejected",
  "unsuccessful",
  "no response",
];
export const isClosedStatus = (status: string) =>
  CLOSED_STATUSES.includes((status ?? "").trim().toLowerCase());

/**
 * The status actually stored for a requested change. A rejection of an application that had reached
 * In progress (assessment, interview, ...) is kept distinct from a plain rejection so the workspace owner can later
 * see which jobs and sources led somewhere. Callers always keep requesting "rejected".
 */
export function storedStatus(current: string, requested: Status): Status {
  const from = current.trim().toLowerCase();
  if (requested === "rejected" && from === "unsuccessful")
    return "unsuccessful";
  if (requested === "rejected" && from === "in progress") return "unsuccessful";
  return requested;
}

/** Rejections (plain or after progress): employer said no, as opposed to silence. */
export const isRejectedStatus = (status: string) =>
  ["rejected", "unsuccessful"].includes((status ?? "").trim().toLowerCase());
