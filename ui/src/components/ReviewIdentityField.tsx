"use client";

import { PencilIcon } from "lucide-react";
import { useRef, useState } from "react";
import { isMissingJobIdentity, type JobIdentityField } from "@/lib/jobIdentity";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ReviewIdentityField({
  field,
  value,
  disabled,
  onSave,
}: {
  field: JobIdentityField;
  value: string;
  disabled?: boolean;
  onSave: (field: JobIdentityField, value: string) => Promise<boolean>;
}) {
  const label = field === "company" ? "company" : "job title";
  const [draft, setDraft] = useState<string | null>(null);
  const pencil = useRef<HTMLButtonElement>(null);

  function cancel() {
    setDraft(null);
    requestAnimationFrame(() => pencil.current?.focus());
  }

  if (!isMissingJobIdentity(value)) return value;

  async function save() {
    if (draft === null || isMissingJobIdentity(draft) || disabled) return;
    if (await onSave(field, draft)) setDraft(null);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span>Unknown {label}</span>
      {draft === null ? (
        <Button
          ref={pencil}
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`Edit ${label}`}
          disabled={disabled}
          onClick={() => setDraft("")}
        >
          <PencilIcon />
        </Button>
      ) : (
        <>
          <Input
            autoFocus
            data-handles-escape
            className="w-44"
            aria-label={label === "company" ? "Company" : "Job title"}
            maxLength={200}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Enter") void save();
                else cancel();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={disabled || isMissingJobIdentity(draft)}
            onClick={() => void save()}
          >
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={cancel}
          >
            Cancel
          </Button>
        </>
      )}
    </span>
  );
}
