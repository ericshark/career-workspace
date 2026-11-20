// applications.md read/write. Owner: Agent A. Spec: docs/03-data-layer.md.
import { storedStatus } from "./status";
import { rowsForReview } from "./applicationRecord";
import { requireValidatedTailor } from "./tailorApproval";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import { ConflictError, sha256, withFileLock } from "./fileStore";
import {
  isPlaceholderRow,
  joinTable,
  parseRow,
  serializeRow,
  splitTable,
} from "./markdown/table";
import { APPLICATIONS_FILE, CAREER_ROOT, resolveInside } from "./paths";
import { isMissingRole, pendingRowFor } from "./duplicates";
import {
  APPLICATIONS_HEADER,
  APPLICATIONS_HEADER_V2,
  APPLICATIONS_HEADER_V1,
  STATUSES,
  type ApplicationRow,
  type ApplicationsPayload,
  type NewApplication,
  type Status,
  type SplitTable,
  type UpsertResult,
} from "./types";

/** Zero rows match the key → HTTP 404. */
export class NotFoundError extends Error {}
/** Table header changed → the UI is read-only → HTTP 423. */
export class ReadOnlyError extends Error {}
/** Bad input → HTTP 400. */
export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

// Writing is strict (reading is lenient).
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    // zod still runs refinements after a failed regex, so guard the Date parse.
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "not a real date");
export const statusSchema = z.enum(STATUSES);
const scoreSchema = z.number().int().min(0).max(100).nullable();
export const newApplicationSchema = z.object({
  fileHash: z.string().min(1),
  reviewId: z.string().optional(),
  decision: z.enum(["submitted", "later"]),
  date: dateSchema.optional(),
  row: z.object({
    company: z.string().trim().min(1),
    role: z.string().trim().min(1),
    lane: z.enum(["tech", "bridge"]),
    resume: z.string().trim().min(1),
    fit: scoreSchema,
    match: scoreSchema,
    source: z.string(),
    next: z.string().optional(),
    link: z.string().optional(),
    recordId: z
      .string()
      .regex(/^[A-Za-z0-9-]{8,64}$/)
      .optional(),
  }),
});

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError("invalid input", r.error.issues);
  return r.data;
}

/**
 * Runs work that follows a committed tracker write (history events, reference rekeying, recruiting
 * refresh). The row is already saved, so a failure here must not turn the request into an error:
 * the client would roll back an edit that is on disk. Failures become warnings instead.
 */
function afterCommit(warnings: string[]) {
  return async (what: string, step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`${what} failed after the tracker row was saved:`, e);
      warnings.push(
        `The change was saved, but ${what} did not finish: ${message}`,
      );
    }
  };
}

const COLUMNS = 12; // number of cells in a v3 application row

type BareRow = Omit<ApplicationRow, "key" | "lineIndex">;

export function applicationsPath(): string {
  const p = resolveInside(CAREER_ROOT, APPLICATIONS_FILE);
  if (!p) throw new Error("applications file resolves outside CAREER_ROOT");
  return p;
}

/** Stable row identity: sha1(date|company|role|link). */
export function rowKey(
  r: Pick<ApplicationRow, "date" | "company" | "role" | "link">,
): string {
  return createHash("sha1")
    .update([r.date, r.company, r.role, r.link].join("|"))
    .digest("hex");
}

/** Cells from a v2 or v3 row → row without derived fields. */
function cellsToRow(c: string[]): BareRow {
  return {
    date: c[0],
    company: c[1],
    role: c[2],
    lane: c[3] as ApplicationRow["lane"], // lenient: odd hand-written values pass through
    resume: c[4],
    fit: c[5],
    match: c[6],
    source: c[7],
    status: c[8],
    next: c[9],
    link: c[10],
    recordId: c[11] ?? "",
  };
}

/** Pure helper: apply an `ApplicationRow` → table line. Used by prependApplication. */
export function serializeApplication(r: BareRow): string {
  return serializeRow([
    r.date,
    r.company,
    r.role,
    r.lane,
    r.resume,
    r.fit,
    r.match,
    r.source,
    r.status,
    r.next,
    r.link,
    r.recordId ?? "",
  ]);
}

/** Parse the whole file text into the API payload. Pure; never throws on a bad header. */
export function parseApplications(text: string): ApplicationsPayload {
  const fileHash = sha256(text);
  const current = splitTable(text, APPLICATIONS_HEADER);
  const legacy = current.found
    ? null
    : splitTable(text, APPLICATIONS_HEADER_V2);
  const t = current.found ? current : legacy!;

  if (!t.found) {
    const v1 = splitTable(text, APPLICATIONS_HEADER_V1).found;
    return {
      rows: [],
      malformed: [],
      fileHash,
      readOnly: {
        reason: v1
          ? "applications.md still uses the v1 table (Lvl + Score). Run `scripts/apps.sh migrate` once."
          : "applications table header not found or changed (expected: " +
            APPLICATIONS_HEADER +
            ")",
      },
    };
  }

  const rows: ApplicationRow[] = [];
  const malformed: ApplicationsPayload["malformed"] = [];
  t.body.forEach((line, lineIndex) => {
    const cells = parseRow(line);
    if (!cells || isPlaceholderRow(cells)) return; // placeholder stays in body, isn't a row
    if (cells.length !== (current.found ? COLUMNS : COLUMNS - 1)) {
      malformed.push({ lineIndex, text: line }); // kept verbatim, never rewritten
      return;
    }
    const row = cellsToRow(cells);
    rows.push({ ...row, key: rowKey(row), lineIndex });
  });
  return { rows, malformed, fileHash, readOnly: false };
}

// Parsed-file cache keyed by path + mtime + size; any write invalidates it.
let cache: { sig: string; payload: ApplicationsPayload } | null = null;

/** Read and parse records/applications.md (mtime+size cached). Never throws on a bad header: returns readOnly. */
export async function readApplications(): Promise<ApplicationsPayload> {
  const file = applicationsPath();
  const st = fs.statSync(file);
  const sig = `${file}:${st.mtimeMs}:${st.size}`;
  if (cache?.sig === sig) return cache.payload;
  const payload = parseApplications(fs.readFileSync(file, "utf8"));
  cache = { sig, payload };
  return payload;
}

/** Run a table edit under the file lock and return the fresh payload. */
async function edit(
  fileHash: string,
  change: (t: SplitTable) => void,
): Promise<ApplicationsPayload> {
  const { text } = await withFileLock(
    applicationsPath(),
    fileHash,
    (current) => {
      const t = splitTable(migrateV2ToV3(current), APPLICATIONS_HEADER);
      if (!t.found)
        throw new ReadOnlyError("applications table format changed");
      change(t);
      return joinTable(t);
    },
  );
  cache = null;
  return parseApplications(text);
}

/** A tailored resume can only be logged as submitted once it has passed validation. */
function checkSubmittedResume(resume: string, reviewId?: string) {
  try {
    requireValidatedTailor(resume, reviewId);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
}

const scoreCell = (n: number | null) => (n === null ? "" : String(n));

/** Body lines that are real rows (not the placeholder / malformed), with their parsed form. */
function bodyRows(t: SplitTable): { index: number; row: ApplicationRow }[] {
  const out: { index: number; row: ApplicationRow }[] = [];
  t.body.forEach((line, index) => {
    const cells = parseRow(line);
    if (!cells || cells.length !== COLUMNS || isPlaceholderRow(cells)) return;
    const row = cellsToRow(cells);
    out.push({ index, row: { ...row, key: rowKey(row), lineIndex: index } });
  });
  return out;
}

/** What it takes to reverse one log: the written row and the line it replaced. */
export interface UndoTarget {
  rowKey: string;
  writtenLine: string; // the row exactly as logged; any later edit makes undo refuse

  previousLine: string | null; // null = the row was inserted, so undo removes it
}

/**
 * Log an application. `submitted` for a posting that already has a `to apply` row (same normalized
 * URL / job id) updates that row in place (status applied, submit date, resume, scores) instead of
 * adding a duplicate. Everything else is prepended (newest first). Throws ConflictError if fileHash is stale.
 */
export async function upsertApplication(
  input: NewApplication,
  today: string,
  beforeWrite?: (undo: UndoTarget) => void,
  reviewAssociation?: { sourceRecordId?: string },
): Promise<UpsertResult & { undo: UndoTarget }> {
  const { fileHash, decision, row, date, reviewId } = validate(
    newApplicationSchema,
    input,
  );
  validate(dateSchema, today);
  const when = date ?? today;
  const status = decision === "submitted" ? "applied" : "to apply";
  let action: UpsertResult["action"] = "inserted";
  let written: BareRow | null = null;
  let previousLine: string | null = null;
  const checkResume = (r: BareRow) => {
    if (decision === "submitted") checkSubmittedResume(r.resume, reviewId);
  };

  const payload = await edit(fileHash, (t) => {
    // Re-check against the freshly read file (under the lock), not the client's copy.
    const rows = bodyRows(t);
    // A retry of one submission is different from a separately pasted, similar job.
    const existing = row.recordId
      ? rows.find((r) => r.row.recordId === row.recordId)
      : undefined;
    if (existing) {
      written = existing.row;
      return;
    }
    const related =
      reviewId && reviewAssociation
        ? rowsForReview(
            {
              id: reviewId,
              sourceRecordId: reviewAssociation.sourceRecordId,
              link: row.link || "",
              jobId: "",
              company: row.company,
              role: row.role,
            },
            rows.map((r) => r.row),
          )
        : [];
    if (related.length > 1)
      throw new ConflictError("Multiple tracker rows match this review");
    if (related.some((r) => r.status !== "to apply"))
      throw new ConflictError(
        "This job has already progressed beyond To apply",
      );
    const pending =
      related[0] ||
      (row.link
        ? pendingRowFor(
            { link: row.link },
            rows.map((r) => r.row),
          )
        : null);
    if (pending) {
      const target = rows.find((r) => r.index === pending.lineIndex)!;
      written = {
        ...target.row,
        // Saving for later again keeps the original save date; submitting stamps the submit date.
        date: decision === "submitted" ? when : target.row.date,
        role:
          isMissingRole(target.row.role) && !isMissingRole(row.role)
            ? row.role
            : target.row.role,
        status,
        lane: row.lane,
        resume: row.resume,
        fit: scoreCell(row.fit),
        match: scoreCell(row.match),
        source: row.source || target.row.source,
        next: row.next ?? target.row.next,
        // Keep the original saved job link so its earlier answers/letter remain accessible.
        recordId:
          row.recordId ??
          (reviewAssociation?.sourceRecordId
            ? target.row.recordId
            : reviewId) ??
          target.row.recordId,
      };
      checkResume(written);
      previousLine = t.body[target.index];
      t.body[target.index] = serializeApplication(written);
      action = "updated";
      beforeWrite?.({
        rowKey: rowKey(written),
        writtenLine: serializeApplication(written),
        previousLine,
      });
      return;
    }
    written = {
      date: when,
      company: row.company,
      role: row.role,
      lane: row.lane,
      resume: row.resume,
      fit: scoreCell(row.fit),
      match: scoreCell(row.match),
      source: row.source,
      status,
      next: row.next ?? "",
      link: row.link ?? "",
      recordId: row.recordId ?? reviewId ?? "",
    };
    checkResume(written);
    // Drop the placeholder row(s) (the first real row replaces it); keep every other line as is.
    const kept = t.body.filter((l) => {
      const cells = parseRow(l);
      return !(cells && isPlaceholderRow(cells));
    });
    t.body = [serializeApplication(written), ...kept];
    // Journal the exact undo before committing the row, including a replaced to-apply row.
    beforeWrite?.({
      rowKey: rowKey(written),
      writtenLine: serializeApplication(written),
      previousLine,
    });
  });
  const key = rowKey(written!);
  const warnings: string[] = [];
  if (decision === "submitted") {
    const { recordSubmission } = await import("./recruiting");
    const saved = payload.rows.filter(
      (r) =>
        r.key === key &&
        (!written!.recordId || r.recordId === written!.recordId),
    );
    if (saved.length === 1)
      await afterCommit(warnings)("recording the submission in Activity", () =>
        recordSubmission(saved[0]),
      );
  }
  return {
    ...payload,
    ...(warnings.length ? { warnings } : {}),
    action,
    rowKey: key,
    undo: {
      rowKey: key,
      writtenLine: serializeApplication(written!),
      previousLine,
    },
  };
}

/**
 * Reverse one log under the file lock: the row must still be exactly as written (same key, single
 * match), otherwise it was edited since and is left alone. Restores the replaced line or removes
 * the inserted row. Re-reads the current hash itself, retrying once if the file changes meanwhile.
 */
export async function revertLog(target: UndoTarget): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const { fileHash } = await readApplications();
    try {
      await edit(fileHash, (t) => {
        const hits = bodyRows(t).filter(
          (r) =>
            r.row.key === target.rowKey &&
            t.body[r.index] === target.writtenLine,
        );
        if (hits.length !== 1)
          throw new ConflictError(
            "That row changed since it was logged; edit it in the Tracker instead",
          );
        if (target.previousLine === null) t.body.splice(hits[0].index, 1);
        else t.body[hits[0].index] = target.previousLine;
      });
      return;
    } catch (e) {
      const changedUnderUs =
        e instanceof ConflictError && /since it was last read/.test(e.message);
      if (!changedUnderUs || attempt >= 1) throw e;
    }
  }
}

/** @deprecated v1 name: always prepends via upsert semantics. */
export const prependApplication = upsertApplication;

// Free-text cells edited inline in the tracker: one line, short. serializeRow escapes pipes.
const cellText = z
  .string()
  .max(200)
  .refine((s) => !/[\r\n]/.test(s), "must be a single line")
  .transform((s) => s.trim());
export const rowChangeSchema = z
  .object({
    status: statusSchema.optional(),
    company: cellText.refine(Boolean, "Company is required").optional(),
    role: cellText.refine(Boolean, "Role is required").optional(),
    // Posting link: empty clears it, otherwise it must be an http(s) URL.
    link: z
      .string()
      .max(2000)
      .refine((s) => !/[\r\n]/.test(s), "must be a single line")
      .transform((s) => s.trim())
      .refine(
        (s) => s === "" || /^https?:\/\/\S+$/i.test(s),
        "Link must start with http:// or https://",
      )
      .optional(),
    // Explicit correction of the saved/applied date (`date` only matters for the to-apply flip).
    dateEdit: dateSchema.optional(),
    next: cellText.optional(),
    source: cellText.optional(),
    date: dateSchema.optional(),
    resume: cellText.optional(),
    fit: scoreSchema.optional(),
    match: scoreSchema.optional(),
  })
  .refine(
    (c) => Object.values(c).some((v) => v !== undefined),
    "nothing to change",
  );
export type RowChanges = z.infer<typeof rowChangeSchema>;

/** Change one row's status. `to apply` → `applied` also sets date to `today`. */
export async function updateStatus(
  fileHash: string,
  key: string,
  status: Status,
  today: string,
): Promise<ApplicationsPayload> {
  return updateRow(fileHash, key, { status }, today);
}

/** Bind one existing tracker row to its saved record without changing its application details. */
export async function attachRecordId(
  fileHash: string,
  key: string,
  recordId: string,
): Promise<ApplicationsPayload> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(recordId))
    throw new ValidationError("invalid record ID");
  return edit(fileHash, (t) => {
    const hits = bodyRows(t).filter(({ row }) => row.key === key);
    if (!hits.length) throw new NotFoundError("application row not found");
    if (hits.length > 1)
      throw new ConflictError("duplicate application row key");
    const { index, row } = hits[0];
    if (row.recordId && row.recordId !== recordId)
      throw new ConflictError("application row already has another record ID");
    t.body[index] = serializeApplication({ ...row, recordId });
  });
}

/**
 * Change one row's status, Next, Source, resume or scores. Flipping `to apply` → `applied` stamps the
 * date with the submit date (`changes.date`, default `today`), so the daily count uses the real day.
 * `date` on its own (no flip) is ignored: the row's date is only rewritten by that flip.
 */
export async function updateRow(
  fileHash: string,
  key: string,
  input: RowChanges,
  today: string,
  lineIndex?: number,
): Promise<ApplicationsPayload> {
  const changes = validate(rowChangeSchema, input);
  validate(dateSchema, today);
  if (changes.dateEdit && changes.dateEdit > today)
    throw new ValidationError("The date cannot be in the future");
  if (changes.status) {
    const { observeStatus } = await import("./recruiting");
    await observeStatus(key);
  }
  // Company, role, link and date are part of the row key. Everything that points at the application
  // (tasks, timeline, found links, reports, saved review) survives only through a Record ID, so a
  // row without one gets it first: the saved review's ID when one is linked, else a new one.
  const changesIdentity =
    changes.company !== undefined ||
    changes.role !== undefined ||
    changes.link !== undefined ||
    changes.dateEdit !== undefined;
  let assignedRecordId: string | undefined;
  if (changesIdentity) {
    const current = (await readApplications()).rows.find(
      (r) =>
        r.key === key && (lineIndex === undefined || r.lineIndex === lineIndex),
    );
    if (current && !current.recordId) {
      const [{ listReviews }, { savedRecordForRow }] = await Promise.all([
        import("./reviews"),
        import("./applicationRecord"),
      ]);
      assignedRecordId =
        savedRecordForRow(current, listReviews())?.id ?? randomUUID();
    }
  }
  let renamed: { from: string; to: string; recordId: string } | undefined;
  let submittedKey: string | undefined;
  const result = await edit(fileHash, (t) => {
    // Find rows by key in the freshly read file (malformed/placeholder lines never match).
    const matches: { index: number; row: BareRow }[] = [];
    t.body.forEach((line, index) => {
      const cells = parseRow(line);
      if (!cells || cells.length !== COLUMNS || isPlaceholderRow(cells)) return;
      const row = cellsToRow(cells);
      if (
        rowKey(row) === key &&
        (lineIndex === undefined || index === lineIndex)
      )
        matches.push({ index, row });
    });
    if (matches.length === 0)
      throw new NotFoundError("row not found (edited or removed elsewhere)");
    if (matches.length > 1)
      throw new ConflictError("duplicate rows, edit by hand");

    const { index, row } = matches[0];
    const status = changes.status
      ? storedStatus(row.status, changes.status)
      : row.status;
    // Only side effect: flipping to `applied` from `to apply` stamps the submit date.
    const date =
      row.status === "to apply" && status === "applied"
        ? (changes.date ?? today)
        : (changes.dateEdit ?? row.date);
    const updated = {
      ...row,
      company: changes.company ?? row.company,
      role: changes.role ?? row.role,
      link: changes.link ?? row.link,
      recordId: row.recordId || assignedRecordId || "",
      status,
      date,
      next: changes.next ?? row.next,
      source: changes.source ?? row.source,
      resume: changes.resume || row.resume,
      fit: changes.fit !== undefined ? scoreCell(changes.fit) : row.fit,
      match: changes.match !== undefined ? scoreCell(changes.match) : row.match,
    };
    if (row.status === "to apply" && status === "applied") {
      checkSubmittedResume(updated.resume);
      submittedKey = rowKey(updated);
    }
    const newKey = rowKey(updated);
    if (
      newKey !== key &&
      bodyRows(t).some(
        (other) => other.index !== index && other.row.key === newKey,
      )
    )
      throw new ConflictError(
        "Another application already has that date, company, role and link",
      );
    if (newKey !== key && changesIdentity)
      renamed = { from: key, to: newKey, recordId: updated.recordId };
    t.body[index] = serializeApplication(updated);
  });
  const warnings: string[] = [];
  const after = afterCommit(warnings);
  if (renamed) {
    const { rekeyApplicationReferences } = await import("./rekey");
    const move = renamed;
    await after("moving linked tasks and history to the edited row", () =>
      rekeyApplicationReferences(move.from, move.to, move.recordId),
    );
  }
  if (submittedKey) {
    const { recordSubmission } = await import("./recruiting");
    const matches = result.rows.filter((r) => r.key === submittedKey);
    if (matches.length === 1)
      await after("recording the submission in Activity", () =>
        recordSubmission(matches[0]),
      );
  }
  if (changes.status) {
    const { reconcileRecruiting } = await import("./recruiting");
    await after("refreshing recruiting history", () => reconcileRecruiting());
  }
  return warnings.length ? { ...result, warnings } : result;
}

/**
 * Remove one row from the tracker. Only that line is deleted; saved reviews stay on disk. `lineIndex` picks the exact line: the fileHash check guarantees the file is the one
 * the client read, so it stays valid and lets the workspace owner remove one of two rows that share a key (the same
 * posting logged twice on one day). Refuses a stale fileHash or a line that no longer holds that key.
 */
export async function deleteRow(
  fileHash: string,
  key: string,
  lineIndex: number,
): Promise<ApplicationsPayload> {
  return edit(fileHash, (t) => {
    const hit = bodyRows(t).find(
      (r) => r.index === lineIndex && r.row.key === key,
    );
    if (!hit)
      throw new NotFoundError("row not found (edited or removed elsewhere)");
    t.body.splice(hit.index, 1);
  });
}

// ───────── one-time v1 → v2 migration (Lvl + Score → Fit + Match, outreach log removed) ─────────

/** Remove the "## Outreach log" section (from its preceding `---` rule to the next `## ` heading or EOF). */
function dropOutreachSection(text: string, eol: string): string {
  const lines = text.split(eol);
  const h = lines.findIndex((l) => /^##\s+Outreach log/i.test(l));
  if (h < 0) return text;
  // Start at the `---` rule above the heading (skipping blank lines), if there is one.
  let start = h;
  let k = h - 1;
  while (k >= 0 && lines[k].trim() === "") k--;
  if (k >= 0 && /^-{3,}\s*$/.test(lines[k])) start = k;
  let end = h + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  // Collapse the blank lines left at the cut, then end with exactly one newline.
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  return kept.join(eol) + eol;
}

/**
 * Pure migration of applications.md text from the v1 table to v2. Real rows keep every cell except
 * Lvl (dropped); Score moves to Fit and Match is left blank. Placeholder and malformed lines are kept
 * verbatim. Legend lines about Lvl/Score/follow-ups are rewritten. Already-v2 text is returned unchanged.
 */
export function migrateV1ToV2(text: string): string {
  if (
    splitTable(text, APPLICATIONS_HEADER_V2).found ||
    splitTable(text, APPLICATIONS_HEADER).found
  )
    return text;
  const t = splitTable(text, APPLICATIONS_HEADER_V1);
  if (!t.found)
    throw new ReadOnlyError("v1 applications table header not found");
  t.header = APPLICATIONS_HEADER_V2;
  t.body = t.body.map((line) => {
    const c = parseRow(line);
    if (!c || isPlaceholderRow(c) || c.length !== COLUMNS - 1) return line;
    // v1: date company role lane resume lvl score source status next link
    return serializeRow([
      c[0],
      c[1],
      c[2],
      c[3],
      c[4],
      c[6],
      "",
      c[7],
      c[8],
      c[9],
      c[10],
    ]);
  });
  t.prefix = t.prefix
    .split(t.eol)
    .filter((l) => !/^\*\*Follow-up:\*\*/.test(l))
    .map((l) =>
      l
        .replace(/ · \*\*Lvl:\*\*[^\n]*$/, "")
        .replace(
          /\*\*Score:\*\*.*$/,
          "**Fit:** Candidate Fit 0–100 (career.md) · **Match:** Resume Match 0–100 (the resume sent). Rows from before /apply v2 keep the old single fit score in Fit and leave Match blank.",
        )
        .replace(
          "Claude adds rows via `/apply`",
          "`/apply` adds rows via `scripts/apps.sh`, the UI via its own write path",
        ),
    )
    .join(t.eol);
  t.suffix = dropOutreachSection(t.suffix, t.eol);
  return joinTable(t);
}

/** Add a record pointer while retaining every existing application value. */
export function migrateV2ToV3(text: string): string {
  if (splitTable(text, APPLICATIONS_HEADER).found) return text;
  const t = splitTable(text, APPLICATIONS_HEADER_V2);
  if (!t.found) return text;
  t.header = APPLICATIONS_HEADER;
  t.separator = t.separator.replace(/\|\s*$/, "|---|");
  t.body = t.body.map((line) => {
    const cells = parseRow(line);
    return cells && cells.length === COLUMNS - 1
      ? line.replace(/\|(\s*)$/, "|  |$1")
      : line;
  });
  return joinTable(t);
}

/** Migrate the real file in place under the file lock. Returns false if already current. */
export async function migrateApplicationsFile(): Promise<boolean> {
  const file = applicationsPath();
  const current = fs.readFileSync(file, "utf8");
  if (splitTable(current, APPLICATIONS_HEADER).found) return false;
  await withFileLock(file, sha256(current), (text) =>
    migrateV2ToV3(migrateV1ToV2(text)),
  );
  cache = null;
  return true;
}

/** Evaluate response aging against fresh rows under the application lock. */
export async function ageUnansweredApplications(
  eligible: (row: ApplicationRow) => boolean,
) {
  const apps = await readApplications();
  if (apps.readOnly) throw new ReadOnlyError(apps.readOnly.reason);
  return edit(apps.fileHash, (table) => {
    for (const { index, row } of bodyRows(table)) {
      if (
        (row.status === "applied" || row.status === "in progress") &&
        eligible(row)
      )
        table.body[index] = serializeApplication({
          ...row,
          status: "no response",
        });
    }
  });
}
