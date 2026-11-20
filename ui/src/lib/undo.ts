// Undo for the last log from the Apply page. The server keeps a short-lived record of exactly what
// one log wrote, so the client only ever sends an opaque id back (never row text). A record expires
// after two minutes and can be used once.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "./api";
import { revertLog, type UndoTarget } from "./applications";
import { atomicWrite } from "./fileStore";
import { CAREER_ROOT, resolveExpected } from "./paths";
import { REVIEWS_DIR } from "./reviews";
import { recordDecision } from "./runs";
import type { ReviewDecision } from "./types";

export const UNDO_TTL_MS = 120_000;

export interface UndoRecord extends UndoTarget {
  /** review: reset the saved review's decision · quick: delete the record that log created. */
  kind: "review" | "quick";
  runId?: string;
  previousDecision?: ReviewDecision;
  quickSlug?: string;
  expiresAt: number;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const undoDir = () => path.join(CAREER_ROOT, "ui", ".cache", "undo");
const gone = (message: string) => new ApiError("NOT_FOUND", message, 410);

export function saveUndo(
  record: Omit<UndoRecord, "expiresAt">,
  now = Date.now(),
): string {
  const id = randomUUID();
  fs.mkdirSync(undoDir(), { recursive: true });
  fs.writeFileSync(
    path.join(undoDir(), `${id}.json`),
    JSON.stringify({ ...record, expiresAt: now + UNDO_TTL_MS }),
    { flag: "wx" },
  );
  return id;
}

/** Start the user's undo window when a multi-group Quick Add can return its result. */
export function renewUndo(ids: string[], now = Date.now()): void {
  for (const id of ids) {
    const file = path.join(undoDir(), `${id}.json`);
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8")) as UndoRecord;
      atomicWrite(
        file,
        JSON.stringify({ ...record, expiresAt: now + UNDO_TTL_MS }),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * Reverse one log: restore or remove the tracker row (only if it is untouched since), and undo its
 * side effect on the saved review / quick record.
 */
export async function undoLog(id: string, now = Date.now()): Promise<void> {
  if (!ID_RE.test(id)) throw gone("Nothing to undo");
  const file = path.join(undoDir(), `${id}.json`);
  const claimed = `${file}.claimed`;
  // Claim by rename first, so a double click (or two tabs) can never undo the same log twice.
  try {
    fs.renameSync(file, claimed);
  } catch {
    throw gone("Nothing to undo (already undone or expired)");
  }
  let record: UndoRecord;
  try {
    record = JSON.parse(fs.readFileSync(claimed, "utf8")) as UndoRecord;
  } catch {
    fs.rmSync(claimed, { force: true });
    throw gone("Nothing to undo");
  }
  if (now > record.expiresAt) {
    fs.rmSync(claimed, { force: true });
    throw gone("Undo expired; change it in the Tracker instead");
  }
  try {
    await revertLog(record);
  } catch (e) {
    // The row is still there: release the claim so a transient failure (lock held) can be retried.
    fs.renameSync(claimed, file);
    throw e;
  }
  fs.rmSync(claimed, { force: true });
  if (record.kind === "review" && record.runId)
    recordDecision(record.runId, record.previousDecision ?? "undecided");
  if (record.kind === "quick" && record.quickSlug)
    for (const ext of ["json", "md"])
      fs.rmSync(resolveExpected(`${REVIEWS_DIR}/${record.quickSlug}.${ext}`), {
        force: true,
      });
}

/**
 * Undo a batch (a multi-job quick add), newest log first. A log that can't be undone (row edited
 * since, expired) is counted as failed and the rest still run.
 */
export async function undoMany(
  ids: string[],
  now = Date.now(),
): Promise<{ undone: number; failed: number }> {
  let undone = 0;
  for (const id of [...ids].reverse()) {
    try {
      await undoLog(id, now);
      undone++;
    } catch {
      // Counted below; the client says how many could not be undone.
    }
  }
  return { undone, failed: ids.length - undone };
}
