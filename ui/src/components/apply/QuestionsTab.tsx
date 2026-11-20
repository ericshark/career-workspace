"use client";
import { useEffect, useMemo, useState } from "react";
import { CompactJobBrief } from "../CompactJobBrief";
import ExtrasPanel from "../ExtrasPanel";
import { RESUMES } from "../applyHelpers";
import {
  ChevronRightIcon,
  XIcon,
  FileTextIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { CompanyAvatar } from "@/components/CompanyAvatar";
import { TintBadge } from "@/components/TintBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/Modal";
import { savedRecordForRow } from "@/lib/applicationRecord";
import { longDate } from "@/lib/calendar";
import { STATUS_COLOR, STATUS_LABEL, statusColumn } from "@/lib/status";
import type {
  ApplicationRow,
  ApplicationsPayload,
  ModelId,
  SavedReviewSummary,
} from "@/lib/types";

/** A tracker row and the saved review / quick add that holds its description (null: none saved). */
interface PickerRow {
  row: ApplicationRow;
  record: SavedReviewSummary | null;
}

/** The job questions are answered for: always a saved record, plus its tracker row when there is one. */
export interface QuestionsJob {
  record: SavedReviewSummary;
  row: ApplicationRow | null;
}

/** The resume the row was sent with, when it is one the cover letter can be written from. */
function sentResume(row: ApplicationRow | null): string | undefined {
  const r = row?.resume.trim() ?? "";
  return (RESUMES as readonly string[]).includes(r) || r.startsWith("tailored/")
    ? r
    : undefined;
}

const dateLabel = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) ? longDate(d) : d;

function StatusTag({ status }: { status: string }) {
  const { column } = statusColumn(status);
  const color = STATUS_COLOR[column];
  return (
    <TintBadge color={color} className="shrink-0">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {STATUS_LABEL[column]}
    </TintBadge>
  );
}

/** Scrollable, searchable list of tracker rows; rows without a saved description can't be picked. */
function JobPicker({
  open,
  rows,
  loading,
  error,
  selectedId,
  onPick,
  onClose,
}: {
  open: boolean;
  rows: PickerRow[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onPick: (r: PickerRow) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? rows.filter((r) =>
          `${r.row.company} ${r.row.role} ${r.row.source}`
            .toLowerCase()
            .includes(q),
        )
      : rows;
  }, [rows, query]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Select a previous job"
      width={560}
    >
      <div className="flex flex-col gap-3 pt-1">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search jobs"
            placeholder="Search company or role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        {error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : loading ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner />
            Loading your applications…
          </p>
        ) : !shown.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {rows.length ? "No jobs match." : "No applications yet."}
          </p>
        ) : (
          <ul
            className="-mx-1 flex max-h-[60vh] flex-col gap-1 overflow-y-auto px-1"
            aria-label="Previous jobs"
          >
            {shown.map((r) => {
              const usable = !!r.record;
              const selected = usable && r.record!.id === selectedId;
              return (
                <li key={r.row.key}>
                  <button
                    type="button"
                    disabled={!usable}
                    onClick={() => onPick(r)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors enabled:hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45",
                      selected && "bg-primary/10 enabled:hover:bg-primary/15",
                    )}
                  >
                    <CompanyAvatar name={r.row.company} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {r.row.company}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.row.role} · {dateLabel(r.row.date)}
                        {usable ? "" : " · No saved description"}
                      </span>
                    </span>
                    <StatusTag status={r.row.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/**
 * Questions tab: pick a job already in the tracker, then answer its application questions (and
 * optionally write a cover letter) from its saved description. `preselectId` comes from the
 * Tracker's "Answer application questions" link.
 */
export function QuestionsTab({
  model,
  preselectId,
  onClear,
}: {
  model: ModelId;
  preselectId: string | null;
  onClear: () => void;
}) {
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [records, setRecords] = useState<SavedReviewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [job, setJob] = useState<QuestionsJob | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [apps, reviews] = await Promise.all([
          fetch("/api/applications", { cache: "no-store" }),
          fetch("/api/reviews", { cache: "no-store" }),
        ]);
        if (!apps.ok || !reviews.ok) throw new Error("Couldn't load your jobs");
        const payload = (await apps.json()) as ApplicationsPayload;
        const { items } = (await reviews.json()) as {
          items: SavedReviewSummary[];
        };
        if (!live) return;
        setRecords(items);
        setRows(
          payload.rows.map((row) => ({
            row,
            record: savedRecordForRow(row, items),
          })),
        );
      } catch (e) {
        if (live)
          setLoadError(e instanceof Error ? e.message : "Couldn't load jobs");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Deep link from the Tracker: select that record once the lists have loaded.
  useEffect(() => {
    if (!preselectId || loading) return;
    const record = records.find((r) => r.id === preselectId);
    if (!record) {
      setMissing(true);
      return;
    }
    const match = rows.find((r) => r.record?.id === preselectId);
    setJob({ record, row: match?.row ?? null });
  }, [preselectId, loading, records, rows]);

  const jobId = job?.record.id ?? null;
  useEffect(() => {
    setDescription(null);
    if (!jobId) return;
    let live = true;
    fetch(`/api/runs/${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((p) => {
        if (!live || !p) return;
        setDescription(
          (p.kind === "quick" ? p.record?.request?.jobPost : p.jobPost) ?? null,
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [jobId]);

  const picker = (
    <JobPicker
      open={pickerOpen}
      rows={rows}
      loading={loading}
      error={loadError}
      selectedId={jobId}
      onClose={() => setPickerOpen(false)}
      onPick={(r) => {
        if (!r.record) return;
        setJob({ record: r.record, row: r.row });
        setMissing(false);
        setPickerOpen(false);
      }}
    />
  );

  if (!job)
    return (
      <>
        <Card>
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon />
              </EmptyMedia>
              <EmptyTitle className="text-lg font-semibold">
                <h2>Answer questions for a job you logged</h2>
              </EmptyTitle>
              <EmptyDescription>
                Pick the job from your tracker. Its saved description is used
                for the answers and cover letter.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {missing && (
                <p className="text-sm text-warning">
                  That job&apos;s saved record wasn&apos;t found. Pick it from
                  the list instead.
                </p>
              )}
              <Button size="lg" onClick={() => setPickerOpen(true)}>
                <SearchIcon data-icon="inline-start" />
                Select previous job
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
        {picker}
      </>
    );

  const company = job.row?.company ?? job.record.company;
  const role = job.row?.role ?? job.record.role;
  return (
    <>
      <Card>
        <CardHeader className="flex items-start gap-3">
          <CompanyAvatar name={company} size={40} />
          <div className="min-w-0 flex-1">
            <CardTitle
              asChild
              className="truncate text-lg font-semibold tracking-tight"
            >
              <h2>{company}</h2>
            </CardTitle>
            <CardDescription>{role}</CardDescription>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {job.row && <StatusTag status={job.row.status} />}
              {[
                job.row ? dateLabel(job.row.date) : "",
                job.record.kind === "review" ? "reviewed" : "quick add",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <CardAction className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setPickerOpen(true)}>
              Change
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear selected job"
              onClick={() => {
                setJob(null);
                setMissing(false);
                setPickerOpen(false);
                onClear();
              }}
            >
              <XIcon />
            </Button>
          </CardAction>
        </CardHeader>
        {description && (
          <CardContent>
            <details className="group rounded-lg bg-muted px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
                <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
                Saved job description
              </summary>
              <div className="mt-3 max-h-96 overflow-auto">
                <CompactJobBrief>{description}</CompactJobBrief>
              </div>
            </details>
          </CardContent>
        )}
      </Card>
      <ExtrasPanel
        key={job.record.id}
        target={{ kind: job.record.kind, id: job.record.id }}
        resume={job.record.kind === "review" ? sentResume(job.row) : undefined}
        model={model}
      />
      {picker}
    </>
  );
}
