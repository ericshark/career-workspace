"use client";
import { usableJobLink } from "@/lib/foundLink";
import { LinkChip } from "@/components/JobLinkControl";
import { useState } from "react";
import { CompanyAvatar } from "@/components/CompanyAvatar";
import { ExternalLinkIcon, ListTodoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { SourceDot } from "@/components/SourceDot";
import { longDate, relativeDay } from "@/lib/calendar";
import { SOURCES, sourceColor } from "@/lib/sources";
import { isStale, type SortKey } from "@/lib/trackerView";
import type { ApplicationRow, Status } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StatusPill } from "./StatusPill";
import type { RowEdit } from "./useTrackerMutations";

export type ColumnId =
  | "company"
  | "role"
  | "status"
  | "date"
  | "review"
  | "source"
  | "actions"
  | "link";

export interface ColumnDef {
  id: ColumnId;
  label: string;
  width: string; // CSS grid track
  sort?: SortKey;
  locked?: boolean; // can't be hidden
}

export const COLUMNS: ColumnDef[] = [
  {
    id: "company",
    label: "Company",
    width: "minmax(150px,1.2fr)",
    sort: "company",
    locked: true,
  },
  { id: "role", label: "Role", width: "minmax(150px,1.6fr)" },
  {
    id: "status",
    label: "Status",
    width: "140px",
    locked: true,
  },
  { id: "date", label: "Date", width: "120px", sort: "date" },
  {
    id: "source",
    label: "Source",
    width: "120px",
  },
  { id: "review", label: "Review", width: "88px" },
  { id: "actions", label: "Timeline", width: "76px" },
  { id: "link", label: "View link", width: "100px" },
];

export const DEFAULT_COLUMNS: ColumnId[] = [
  "company",
  "role",
  "status",
  "date",
  "source",
  "review",
  "actions",
  "link",
];

export function gridTemplate(cols: ColumnId[]): string {
  return COLUMNS.filter((c) => cols.includes(c.id))
    .map((c) => c.width)
    .join(" ");
}

interface RowProps {
  hasReview?: boolean;
  hasActions?: boolean;
  onReview: () => void;
  onActivity: () => void;
  postingLink?: string;
  linkAction?: React.ReactNode;
  row: ApplicationRow;
  today: string;
  columns: ColumnId[];
  disabled: boolean;
  onOpen: () => void;
  onEdit: (e: RowEdit) => void;
}

/** Desktop list row: a CSS grid matching the header. Status and Source are editable in place; Actions opens linked task history. */
export function AppRow({
  row,
  today,
  columns,
  disabled,
  onOpen,
  onEdit,
  hasReview,
  hasActions,
  onReview,
  onActivity,
  postingLink,
  linkAction,
}: RowProps) {
  const show = (c: ColumnId) => columns.includes(c);
  const stale = isStale(row, today);
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) =>
        e.key === "Enter" && e.target === e.currentTarget && onOpen()
      }
      className={cn(
        "grid cursor-pointer items-center gap-3 px-4 py-2.5 text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        disabled && "opacity-60",
      )}
      style={{ gridTemplateColumns: gridTemplate(columns) }}
    >
      {show("company") && (
        <div className="flex min-w-0 items-center gap-2.5">
          <CompanyAvatar
            name={row.company}
            size={28}
            color={row.source ? sourceColor(row.source) : undefined}
          />
          <span className="truncate font-semibold">{row.company}</span>
        </div>
      )}
      {show("role") && (
        <span className="truncate text-muted-foreground" title={row.role}>
          {row.role}
        </span>
      )}
      {show("status") && (
        <div>
          <StatusPill
            status={row.status}
            disabled={disabled}
            onChange={(s: Status) => onEdit({ status: s })}
          />
        </div>
      )}
      {show("date") && (
        <DateCell
          row={row}
          today={today}
          stale={stale}
          disabled={disabled}
          onEdit={onEdit}
        />
      )}
      {show("source") && (
        <SourceCell
          source={row.source}
          disabled={disabled}
          onSave={(source) => onEdit({ source })}
        />
      )}
      {show("review") && <ReviewCell available={hasReview} onOpen={onReview} />}
      {show("actions") && (
        <ActionsIndicator present={hasActions} onOpen={onActivity} />
      )}
      {show("link") &&
        (linkAction ?? <LinkCell link={postingLink || row.link} />)}
    </div>
  );
}

/** Phone layout: a stacked two-line card with the same editable status. */
export function AppRowCompact({
  row,
  today,
  disabled,
  onOpen,
  onEdit,
  hasReview,
  hasActions,
  onReview,
  onActivity,
  postingLink,
  linkAction,
}: Omit<RowProps, "columns">) {
  const stale = isStale(row, today);
  return (
    <div
      onClick={onOpen}
      className={cn(
        "flex cursor-pointer gap-3 px-4 py-3",
        disabled && "opacity-60",
      )}
    >
      <CompanyAvatar
        name={row.company}
        size={34}
        color={row.source ? sourceColor(row.source) : undefined}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">
            {row.company}
          </span>
          <StatusPill
            status={row.status}
            disabled={disabled}
            onChange={(s) => onEdit({ status: s })}
          />
        </div>
        <div className="truncate text-sm text-muted-foreground">{row.role}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{relativeDay(row.date, today)}</span>
          <ReviewCell available={hasReview} onOpen={onReview} />
          {linkAction ?? <LinkCell link={postingLink || row.link} />}
          {row.source ? (
            <span className="inline-flex items-center gap-1.5">
              <SourceDot source={row.source} size={7} />
              {row.source}
            </span>
          ) : null}
          <ActionsIndicator present={hasActions} onOpen={onActivity} />
          {stale ? (
            <Badge asChild variant="warning">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit({ status: "no response" });
                }}
                disabled={disabled}
              >
                No reply 21d · Move to No response
              </button>
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DateCell({
  row,
  today,
  stale,
  disabled,
  onEdit,
}: {
  row: ApplicationRow;
  today: string;
  stale: boolean;
  disabled: boolean;
  onEdit: (e: RowEdit) => void;
}) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(row.date);
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate" title={valid ? longDate(row.date) : row.date}>
        {valid ? relativeDay(row.date, today) : row.date}
      </span>
      {stale ? (
        <button
          type="button"
          disabled={disabled}
          className="truncate text-left text-[11px] font-medium text-warning hover:underline"
          title="Applied 21+ days ago with no reply. Click to move to No response."
          onClick={(e) => {
            e.stopPropagation();
            onEdit({ status: "no response" });
          }}
        >
          No reply 21d · No response
        </button>
      ) : null}
    </div>
  );
}

function ReviewCell({
  available,
  onOpen,
}: {
  available?: boolean;
  onOpen: () => void;
}) {
  return available ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title="View review"
      aria-label="View review"
      className="inline-flex h-6 items-center justify-center justify-self-center whitespace-nowrap rounded-full border border-success/20 bg-success/10 px-2.5 text-[11px] font-medium text-success hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      View Review
    </button>
  ) : (
    <span
      className="justify-self-center text-muted-foreground"
      aria-label={
        available === undefined ? "Loading review status" : "No review yet"
      }
    >
      –
    </span>
  );
}

export function LinkCell({ link }: { link: string }) {
  if (!usableJobLink(link))
    return (
      <span className="text-muted-foreground" aria-label="No posting link">
        –
      </span>
    );
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <LinkChip kind="posting" url={link} />
    </span>
  );
}

/** Source: dot + name; click to pick from the list (an unknown current value stays selectable). */
function SourceCell({
  source,
  disabled,
  onSave,
}: {
  source: string;
  disabled: boolean;
  onSave: (s: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const options =
    SOURCES.some((s) => s === source) || !source
      ? [...SOURCES]
      : [source, ...SOURCES];
  if (editing)
    return (
      <NativeSelect
        autoFocus
        size="sm"
        value={source}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        onChange={(e) => {
          setEditing(false);
          if (e.target.value !== source) onSave(e.target.value);
        }}
        aria-label="Source"
      >
        {!source ? (
          <NativeSelectOption value="">(none)</NativeSelectOption>
        ) : null}
        {options.map((s) => (
          <NativeSelectOption key={s} value={s}>
            {s}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="-mx-1.5 inline-flex h-6 min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[13px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        title="Change source"
      >
        <SourceDot source={source} size={7} />
        <span className="truncate">
          {source || <span className="text-muted-foreground">–</span>}
        </span>
      </button>
    </div>
  );
}

function ActionsIndicator({
  present,
  onOpen,
}: {
  present?: boolean;
  onOpen: () => void;
}) {
  return present ? (
    <button
      type="button"
      aria-label="View action timeline"
      title="View action timeline"
      className="inline-flex h-6 items-center justify-center justify-self-center rounded-full bg-success/10 px-3 text-success hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <ListTodoIcon aria-hidden="true" className="size-4" />
    </button>
  ) : (
    <span
      className="justify-self-center text-muted-foreground"
      aria-label="No actions"
    >
      –
    </span>
  );
}
