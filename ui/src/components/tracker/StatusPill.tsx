"use client";
import { ChevronDownIcon } from "lucide-react";
import { TintBadge } from "@/components/TintBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_COLOR, STATUS_LABEL, statusColumn } from "@/lib/status";
import { GROUP_ORDER } from "@/lib/trackerView";
import type { Status } from "@/lib/types";

/** Colored status pill; click for a menu of the supported statuses. Legacy values show as-is. */
export function StatusPill({
  status,
  disabled,
  onChange,
}: {
  status: string;
  disabled?: boolean;
  onChange: (s: Status) => void;
}) {
  const { column, legacy } = statusColumn(status);
  const color = STATUS_COLOR[column];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <TintBadge
          asChild
          color={color}
          className="h-6 cursor-pointer transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <button
            type="button"
            aria-label={`Status: ${STATUS_LABEL[column]}. Change status`}
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ background: color }}
            />
            {legacy !== null ? legacy || "no status" : STATUS_LABEL[column]}
            <ChevronDownIcon data-icon="inline-end" className="opacity-70" />
          </button>
        </TintBadge>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Status</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={legacy === null ? column : ""}
            onValueChange={(s) => s !== status && onChange(s as Status)}
          >
            {GROUP_ORDER.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                <span
                  className="size-2 rounded-full"
                  style={{ background: STATUS_COLOR[s] }}
                />
                {STATUS_LABEL[s]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {legacy !== null ? (
          <p className="px-1.5 py-1.5 text-xs text-muted-foreground">
            Older status &ldquo;{legacy}&rdquo;; picking one rewrites it.
          </p>
        ) : null}
        {column === "to apply" ? (
          <p className="px-1.5 py-1.5 text-xs text-muted-foreground">
            Applied sets the date to today.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
