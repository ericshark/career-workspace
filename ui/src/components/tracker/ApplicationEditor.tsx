"use client";
import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { localDate } from "@/components/applyHelpers";
import { patchApplication } from "./patchApplication";
import { SOURCES } from "@/lib/sources";
import { STATUS_LABEL, statusColumn } from "@/lib/status";
import {
  STATUSES,
  type ApplicationRow,
  type ApplicationsPayload,
  type Status,
} from "@/lib/types";

/**
 * Edits every field of one tracker application in place. A check mark saves, an X cancels; Enter
 * saves and Escape cancels. It reads a fresh file hash itself, so it works wherever the summary is
 * opened (Tracker, Actions, Dashboard). Changing company, role, link or date changes the row key;
 * the server moves every saved reference, and `onSaved` returns the row under its new key.
 */
export function ApplicationEditor({
  row,
  onSaved,
  onCancel,
}: {
  row: ApplicationRow;
  onSaved: (row: ApplicationRow) => void;
  onCancel: () => void;
}) {
  const column = statusColumn(row.status).column;
  const [draft, setDraft] = useState({
    company: row.company,
    role: row.role,
    link: row.link,
    date: row.date,
    source: row.source,
    resume: row.resume,
    next: row.next,
    status: column as Status,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof typeof draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  async function save() {
    if (saving) return;
    const changes: Record<string, string> = {};
    if (draft.company.trim() !== row.company) changes.company = draft.company;
    if (draft.role.trim() !== row.role) changes.role = draft.role;
    if (draft.link.trim() !== row.link) changes.link = draft.link;
    if (draft.source !== row.source) changes.source = draft.source;
    if (draft.resume.trim() !== row.resume) changes.resume = draft.resume;
    if (draft.next.trim() !== row.next) changes.next = draft.next;
    const flipping = column === "to apply" && draft.status === "applied";
    if (draft.status !== column) changes.status = draft.status;
    // Saving a to-apply row as applied stamps its submit date; otherwise a date change is a correction.
    if (draft.date !== row.date)
      changes[flipping ? "date" : "dateEdit"] = draft.date;
    else if (flipping) changes.date = localDate();
    if (!Object.keys(changes).length) return onCancel();
    setSaving(true);
    setError(null);
    try {
      const updated = await patchApplication(row, changes);
      if (updated) onSaved(updated);
      else onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes");
      setSaving(false);
    }
  }

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") void save();
      else onCancel();
    }
  };
  const text = (
    field: "company" | "role" | "link" | "resume" | "next",
    label: string,
    wide = false,
  ) => (
    <label
      className={`block text-xs text-muted-foreground ${wide ? "sm:col-span-2" : ""}`}
    >
      {label}
      <Input
        data-handles-escape
        className="mt-1 h-8 text-sm text-foreground"
        value={draft[field]}
        maxLength={field === "link" ? 2000 : 200}
        disabled={saving}
        onChange={(e) => set(field)(e.target.value)}
        onKeyDown={keys}
        autoFocus={field === "company"}
      />
    </label>
  );
  return (
    <section
      aria-label="Edit application"
      className="space-y-3 rounded-xl border bg-muted/30 p-3.5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {text("company", "Company")}
        {text("role", "Role")}
        {text("link", "Posting link", true)}
        <label className="block text-xs text-muted-foreground">
          {column === "to apply" ? "Saved on" : "Applied on"}
          <Input
            type="date"
            data-handles-escape
            className="mt-1 h-8 text-sm text-foreground"
            value={draft.date}
            max={localDate()}
            disabled={saving}
            onChange={(e) => set("date")(e.target.value || row.date)}
            onKeyDown={keys}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Status
          <NativeSelect
            className="mt-1 w-full"
            aria-label="Status"
            value={draft.status}
            disabled={saving}
            onChange={(e) => set("status")(e.target.value)}
          >
            {STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {STATUS_LABEL[status]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="block text-xs text-muted-foreground">
          Source
          <NativeSelect
            className="mt-1 w-full"
            aria-label="Source"
            value={draft.source}
            disabled={saving}
            onChange={(e) => set("source")(e.target.value)}
          >
            {/* A source no longer in the standard list is kept, not silently replaced. */}
            {[
              ...new Set([...(draft.source ? [draft.source] : []), ...SOURCES]),
            ].map((source) => (
              <NativeSelectOption key={source} value={source}>
                {source}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value="">(none)</NativeSelectOption>
          </NativeSelect>
        </label>
        {text("resume", "Resume")}
        {text("next", "Next", true)}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Cancel editing"
          title="Cancel"
          disabled={saving}
          onClick={onCancel}
        >
          <XIcon className="size-5!" />
        </Button>
        <Button
          size="icon-sm"
          aria-label="Save changes"
          title="Save changes"
          disabled={saving}
          onClick={() => void save()}
        >
          <CheckIcon className="size-5!" />
        </Button>
      </div>
    </section>
  );
}
