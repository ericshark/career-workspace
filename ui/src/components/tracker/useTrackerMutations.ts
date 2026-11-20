"use client";
import { useState } from "react";
import { PROGRESS_CHANGED } from "@/components/useFetchJson";
import type { ApplicationRow, ApplicationsPayload, Status } from "@/lib/types";

// Every stored column of a row; two rows with equal values here are the same application state.
const SAVED_FIELDS = [
  "date",
  "company",
  "role",
  "lane",
  "resume",
  "fit",
  "match",
  "source",
  "status",
  "next",
  "link",
  "recordId",
] as const satisfies readonly (keyof ApplicationRow)[];

/** Fields the tracker can edit in place (PATCH /api/applications). */
export interface RowEdit {
  status?: Status;
  next?: string;
  source?: string;
  /** Submit date for a `to apply` → `applied` flip (server default: today). */
  date?: string;
}

/**
 * Row edits for the tracker (same behavior as v0's table): optimistic update, rollback on any
 * error, a 409 conflict offers "Reload & reapply", a 423 means locked/read-only.
 */
export function useTrackerMutations(
  data: ApplicationsPayload | null,
  setData: (d: ApplicationsPayload) => void,
  reload: () => void,
) {
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set after a 409: the edit that was rolled back, so "Reload & reapply" can resend it.
  const [conflict, setConflict] = useState<{
    key: string;
    recordId?: string;
    lineIndex: number;
    edit: RowEdit;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * The file hash is stale when anything in applications.md changed, for example another row edited
   * by Career Check or the CLI. If this row is unchanged in the fresh file, the edit is still safe to
   * apply, so it is retried once against that file instead of asking the workspace owner to resolve a conflict.
   */
  async function freshRowIfUnchanged(
    row: ApplicationRow,
  ): Promise<{ fresh: ApplicationsPayload; row: ApplicationRow } | null> {
    try {
      const res = await fetch("/api/applications", { cache: "no-store" });
      if (!res.ok) return null;
      const fresh = (await res.json()) as ApplicationsPayload;
      const candidates = fresh.rows.filter((r) =>
        row.recordId ? r.recordId === row.recordId : r.key === row.key,
      );
      if (candidates.length !== 1) return null;
      const [current] = candidates;
      const same = SAVED_FIELDS.every((field) => current[field] === row[field]);
      return same ? { fresh, row: current } : null;
    } catch {
      return null;
    }
  }

  /** Optimistic edit of one row; resolves true when saved. */
  async function update(
    row: ApplicationRow,
    edit: RowEdit,
    base: ApplicationsPayload | null = data,
    retried = false,
  ): Promise<boolean> {
    if (!base) return false;
    const snapshot = base;
    setSaveError(null);
    setConflict(null);
    setBusy(row.key);
    setData({
      ...snapshot,
      rows: snapshot.rows.map((r) =>
        r.key === row.key && r.lineIndex === row.lineIndex
          ? { ...r, ...edit }
          : r,
      ),
    });
    try {
      const res = await fetch("/api/applications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileHash: snapshot.fileHash,
          key: row.key,
          lineIndex: row.lineIndex,
          ...edit,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setData(snapshot); // rollback
        const msg: string = body?.error?.message ?? "";
        if (
          res.status === 409 &&
          !retried &&
          /since it was last read/i.test(msg)
        ) {
          const unchanged = await freshRowIfUnchanged(row);
          if (unchanged)
            return update(unchanged.row, edit, unchanged.fresh, true);
        }
        if (res.status === 409 && !/duplicate/i.test(msg))
          setConflict({
            key: row.key,
            recordId: row.recordId,
            lineIndex: row.lineIndex,
            edit,
          });
        else if (res.status === 409)
          setSaveError(
            "Duplicate rows with the same date, company, role and link: edit applications.md by hand.",
          );
        else
          setSaveError(
            res.status === 423
              ? "The file is locked or read-only; try again in a moment."
              : msg || `HTTP ${res.status}`,
          );
        return false;
      }
      setData(body as ApplicationsPayload);
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
      return true;
    } catch (e) {
      setData(snapshot);
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** Delete one row (not optimistic: the row stays until the server confirms). */
  async function remove(row: ApplicationRow): Promise<boolean> {
    if (!data) return false;
    setSaveError(null);
    setConflict(null);
    setBusy(row.key);
    try {
      const res = await fetch("/api/applications", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileHash: data.fileHash,
          key: row.key,
          lineIndex: row.lineIndex,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg: string = body?.error?.message ?? "";
        setSaveError(
          res.status === 409
            ? "applications.md changed since it was loaded; reload and try again."
            : res.status === 423
              ? "The file is locked or read-only; try again in a moment."
              : msg || `HTTP ${res.status}`,
        );
        return false;
      }
      setData(body as ApplicationsPayload);
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Apply one edit to several rows. Not optimistic: PATCHes run one at a time because each save
   * changes the file hash the next one must send. Stops at the first failure; resolves to the
   * number saved.
   */
  async function updateMany(
    rows: ApplicationRow[],
    edit: RowEdit,
  ): Promise<number> {
    if (!data) return 0;
    let current = data;
    let saved = 0;
    setSaveError(null);
    setConflict(null);
    setBusy("bulk");
    try {
      for (const row of rows) {
        const res = await fetch("/api/applications", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileHash: current.fileHash,
            key: row.key,
            lineIndex: row.lineIndex,
            ...edit,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          const msg: string = body?.error?.message ?? "";
          setSaveError(
            `Saved ${saved} of ${rows.length}. ${
              res.status === 409
                ? "applications.md changed outside the UI; reload and try again."
                : res.status === 423
                  ? "The file is locked or read-only; try again in a moment."
                  : msg || `HTTP ${res.status}`
            }`,
          );
          break;
        }
        current = body as ApplicationsPayload;
        setData(current);
        saved++;
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (saved) window.dispatchEvent(new Event(PROGRESS_CHANGED));
    }
    return saved;
  }

  /** Status-only shorthand. */
  const change = (row: ApplicationRow, status: Status) =>
    update(row, { status });

  /** Re-read the file, then resend the rolled-back edit against the fresh hash. */
  async function reapply(): Promise<boolean> {
    if (!conflict) return false;
    const c = conflict;
    const res = await fetch("/api/applications", { cache: "no-store" });
    if (!res.ok) {
      reload();
      return false;
    }
    const fresh = (await res.json()) as ApplicationsPayload;
    setData(fresh);
    const row = fresh.rows.find((r) =>
      c.recordId
        ? r.recordId === c.recordId
        : r.key === c.key && r.lineIndex === c.lineIndex,
    );
    if (!row) {
      setConflict(null);
      setSaveError("That row no longer exists after the reload.");
      return false;
    }
    return update(row, c.edit, fresh);
  }

  return {
    update,
    updateMany,
    remove,
    change,
    reapply,
    busy,
    saveError,
    conflict,
    dismissConflict: () => setConflict(null),
  };
}
