"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { patchApplication } from "@/components/tracker/patchApplication";
import type { QuickBatchListItem } from "@/lib/quickState";
import type { ApplicationRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { lsGet, lsSet } from "./useApplyHistory";

// Jobs the workspace owner has confirmed (fixed, or kept as they are). The fix itself lives in the tracker row;
// this only covers "keep as is", which leaves the row unchanged.
const RESOLVED_KEY = "career-ui.quick.missing-resolved";

export interface MissingJob {
  quickId: string;
  /** What the post stated: "company" and/or "role" were not named. */
  missing: ("company" | "role")[];
  row: ApplicationRow;
}

/**
 * Quick Add jobs whose post did not name the company and/or role and that the workspace owner has not yet fixed. It
 * is read from the tracker row, so correcting the name anywhere (the Edit button included) clears it.
 */
export function missingJobs(
  batches: QuickBatchListItem[],
  rows: ApplicationRow[],
  resolved: ReadonlySet<string>,
): MissingJob[] {
  const found = new Map<string, MissingJob>();
  for (const batch of batches) {
    if (batch.undone) continue;
    for (const added of batch.added) {
      if (!added.missing?.length || resolved.has(added.quickId)) continue;
      const row = rows.find((r) => r.recordId === added.quickId);
      if (!row || found.has(added.quickId)) continue;
      // Fixed once every field that was missing differs from what was saved at the time.
      const unchanged = added.missing.filter(
        (field) => row[field].trim() === added[field].trim(),
      );
      if (unchanged.length)
        found.set(added.quickId, {
          quickId: added.quickId,
          missing: unchanged,
          row,
        });
    }
  }
  return [...found.values()];
}

export function useMissingJobs(
  batches: QuickBatchListItem[],
  rows: ApplicationRow[] | undefined,
) {
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setResolved(new Set(lsGet<string[]>(RESOLVED_KEY) ?? []));
  }, []);
  const resolve = useCallback((quickId: string) => {
    setResolved((previous) => {
      const next = new Set(previous).add(quickId);
      lsSet(RESOLVED_KEY, [...next].slice(-500));
      return next;
    });
  }, []);
  const jobs = useMemo(
    () => (rows ? missingJobs(batches, rows, resolved) : []),
    [batches, rows, resolved],
  );
  return { jobs, resolve };
}

function MissingRow({
  job,
  onResolved,
}: {
  job: MissingJob;
  onResolved: (quickId: string) => void;
}) {
  const { row, missing } = job;
  const [company, setCompany] = useState(
    missing.includes("company") ? "" : row.company,
  );
  const [role, setRole] = useState(missing.includes("role") ? "" : row.role);
  const [pasted, setPasted] = useState<string | null>(null);
  const [showPasted, setShowPasted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function togglePasted() {
    setShowPasted((open) => !open);
    if (pasted !== null) return;
    try {
      const response = await fetch(
        `/api/tracker/details?id=${encodeURIComponent(job.quickId)}`,
        { cache: "no-store" },
      );
      const body = response.ok ? await response.json() : null;
      setPasted(body?.original || "The original text is not available.");
    } catch {
      setPasted("The original text is not available.");
    }
  }

  async function save() {
    if (saving) return;
    const changes: Record<string, string> = {};
    if (company.trim() && company.trim() !== row.company)
      changes.company = company.trim();
    if (role.trim() && role.trim() !== row.role) changes.role = role.trim();
    // Every field that was missing needs a value, unless the job is kept as it is.
    const stillEmpty = missing.filter((field) =>
      field === "company" ? !company.trim() : !role.trim(),
    );
    if (stillEmpty.length) {
      setError(`Enter the ${stillEmpty.join(" and ")}, or choose Keep as is.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (Object.keys(changes).length) await patchApplication(row, changes);
      onResolved(job.quickId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  }
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  };
  const field = (
    name: "company" | "role",
    value: string,
    set: (v: string) => void,
  ) => (
    <label className="block text-xs text-muted-foreground">
      {name === "company" ? "Company" : "Role"}
      {missing.includes(name) && (
        <span className="ml-1 text-destructive">· not stated</span>
      )}
      <Input
        className={cn(
          "mt-1 h-8 text-sm text-foreground",
          missing.includes(name) && "border-destructive/50",
        )}
        value={value}
        maxLength={200}
        disabled={saving}
        placeholder={
          missing.includes(name)
            ? name === "role"
              ? `Saved as "${row.role}" for now`
              : "Enter the company"
            : undefined
        }
        onChange={(e) => set(e.target.value)}
        onKeyDown={keys}
        autoFocus={missing[0] === name}
      />
    </label>
  );
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {field("company", company, setCompany)}
        {field("role", role, setRole)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7 px-2 text-xs"
          aria-expanded={showPasted}
          onClick={() => void togglePasted()}
        >
          View pasted
          <ChevronDownIcon
            className={cn("size-3", showPasted && "rotate-180")}
          />
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={saving}
            onClick={() => onResolved(job.quickId)}
          >
            Keep as is
          </Button>
          <Button
            type="button"
            size="icon-sm"
            aria-label={`Save ${row.company}`}
            title="Save"
            disabled={saving}
            onClick={() => void save()}
          >
            <CheckIcon className="size-5!" />
          </Button>
        </div>
      </div>
      {showPasted && (
        <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-card p-2.5 text-xs leading-5">
          {pasted ?? "Loading…"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * A red row, separate from progress and "Added N jobs", for jobs whose post did not name the
 * company or role. Expand it to read the pasted text and type the missing name.
 */
export function QuickMissingInfo({
  jobs,
  onResolved,
}: {
  jobs: MissingJob[];
  onResolved: (quickId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  // New jobs needing attention bring the row back after it was hidden.
  const signature = jobs.map((j) => j.quickId).join(",");
  useEffect(() => setHidden(false), [signature]);
  if (!jobs.length || hidden) return null;
  const both = jobs.some((j) => j.missing.length > 1);
  const what = both
    ? "a company or role"
    : jobs.every((j) => j.missing[0] === "company")
      ? "a company"
      : jobs.every((j) => j.missing[0] === "role")
        ? "a role"
        : "a company or role";
  return (
    <div
      role="alert"
      className="overflow-hidden rounded-xl border border-destructive/50 bg-destructive/5 shadow-xs"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-destructive"
        >
          <CircleAlertIcon className="size-4 shrink-0" />
          <span>
            {jobs.length} job{jobs.length === 1 ? " needs" : "s need"} {what}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Hide missing info alert"
          onClick={() => setHidden(true)}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      {open && (
        <ul className="divide-y divide-destructive/20 border-t border-destructive/20 bg-card px-3">
          {jobs.map((job) => (
            <MissingRow key={job.quickId} job={job} onResolved={onResolved} />
          ))}
        </ul>
      )}
    </div>
  );
}
