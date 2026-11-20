"use client";
import { TrackerSummary } from "@/components/tracker/TrackerSummary";
import { savedRecordForRow, reviewForRecord } from "@/lib/applicationRecord";
import { applicationDate } from "@/lib/config";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  useRef,
  useSyncExternalStore,
} from "react";
import { localDate } from "@/components/applyHelpers";
import { ReviewProgress } from "@/components/tracker/ReviewProgress";
import { useRecruiting } from "@/components/Recruiting";
import { applicationKeysWithActionHistory } from "@/lib/recruitingTypes";
import { AppSheet } from "@/components/tracker/AppSheet";
import {
  AppRow,
  AppRowCompact,
  COLUMNS,
  DEFAULT_COLUMNS,
  gridTemplate,
} from "@/components/tracker/AppRow";
import { useTrackerMutations } from "@/components/tracker/useTrackerMutations";
import {
  ChevronDownIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  InboxIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
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
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SourceDot } from "@/components/SourceDot";
import { JobLinkControl } from "@/components/JobLinkControl";
import { usableJobLink } from "@/lib/foundLink";
import { showToast } from "@/components/notify";
import { useFetchJson } from "@/components/useFetchJson";
import { SOURCES } from "@/lib/sources";
import { STATUS_LABEL } from "@/lib/status";
import {
  NO_FILTERS,
  activeFilterCount,
  filterRows,
  sortRows,
  viewCounts,
  type Since,
  type SortDir,
  type SortKey,
  type TrackerFilters,
  type TrackerView,
} from "@/lib/trackerView";
import { cn } from "@/lib/utils";
import {
  STATUSES,
  type SavedReviewSummary,
  type ApplicationRow,
  type ApplicationsPayload,
  type Status,
} from "@/lib/types";

export default function TrackerPage() {
  // useSearchParams needs a Suspense boundary for static prerender.
  return (
    <Suspense fallback={<TrackerSkeleton />}>
      <Tracker />
    </Suspense>
  );
}

const PREFS_KEY = "career-ui.tracker";
const ROW_BATCH_SIZE = 50;

interface Prefs {
  sortKey: SortKey;
  sortDir: SortDir;
  filters: Omit<TrackerFilters, "q">;
}

const DEFAULT_PREFS: Prefs = {
  sortKey: "date",
  sortDir: "desc",
  filters: { ...NO_FILTERS },
};

const SORT_LABEL: Partial<Record<SortKey, string>> = {
  date: "Date",
  company: "Company",
};

// Sensible first direction when picking a sort field (newest / highest first, A→Z for text).
const FIRST_DIR: Record<SortKey, SortDir> = {
  date: "desc",
  fit: "desc",
  match: "desc",
  company: "asc",
};

const SINCE_LABEL: Record<Since, string> = {
  all: "All time",
  week: "This week",
  "30d": "Last 30 days",
};

const VIEWS: TrackerView[] = [
  "all",
  "to apply",
  "applied",
  "in progress",
  "no response",
  "rejected",
  "unsuccessful",
];
const viewLabel = (v: TrackerView) => (v === "all" ? "All" : STATUS_LABEL[v]);

// Match Tailwind's md breakpoint used by the table header.
const TRACKER_TABLE_QUERY = "(min-width: 48rem)";
function subscribeToTableViewport(onChange: () => void) {
  const media = window.matchMedia(TRACKER_TABLE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const tableViewport = () => window.matchMedia(TRACKER_TABLE_QUERY).matches;
const serverTableViewport = () => false;

function Tracker() {
  const recruiting = useRecruiting();
  const actionHistory = useMemo(
    () => applicationKeysWithActionHistory(recruiting.data),
    [recruiting.data],
  );
  const showTable = useSyncExternalStore(
    subscribeToTableViewport,
    tableViewport,
    serverTableViewport,
  );
  const {
    data,
    setData,
    error,
    loadedAt,
    reload: reloadApplications,
  } = useFetchJson<ApplicationsPayload>("/api/applications");
  const savedJobs = useFetchJson<{ items: SavedReviewSummary[] }>(
    "/api/reviews",
    { events: true },
  );
  const reload = () => {
    void reloadApplications();
    void savedJobs.reload();
    void recruiting.reload();
  };

  const params = useSearchParams();
  const {
    update,
    remove,
    reapply,
    busy,
    saveError,
    conflict,
    dismissConflict,
  } = useTrackerMutations(data, setData, reload);

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [q, setQ] = useState("");
  const [rowLimit, setRowLimit] = useState(ROW_BATCH_SIZE);
  const moreRows = useRef<HTMLButtonElement>(null);
  // Key + line: two rows can share a key (same posting logged twice in a day), so the line picks one.
  const [openRef, setOpenRef] = useState<{
    key: string;
    lineIndex: number;
    view?: "review" | "activity";
  } | null>(null);

  // Saved view prefs load after mount (localStorage isn't available on the server). A ?status=
  // link (e.g. Today's "N queued") opens that status tab for this visit.
  useEffect(() => {
    let saved: Partial<Prefs> = {};
    try {
      saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    } catch {
      /* missing or unreadable: defaults */
    }
    // Keep only fields the current tracker knows: older prefs carry grouping, lane/resume/stale
    // filters and other sort keys that no longer exist.
    const f = (saved.filters ?? {}) as Partial<Prefs["filters"]>;
    const next: Prefs = {
      sortKey: saved.sortKey ?? DEFAULT_PREFS.sortKey,
      sortDir: saved.sortDir === "asc" ? "asc" : "desc",
      filters: {
        // A saved view that no longer exists (the removed Needs action tab) opens All.
        view: VIEWS.includes(f.view as TrackerView)
          ? (f.view as TrackerView)
          : "all",
        sources: Array.isArray(f.sources) ? f.sources : [],
        since: f.since && f.since in SINCE_LABEL ? f.since : "all",
      },
    };
    if (!(next.sortKey in SORT_LABEL)) next.sortKey = "date";
    const s = params.get("status");
    if (s && (STATUSES as readonly string[]).includes(s))
      next.filters = { ...next.filters, view: s as Status };
    const t = setTimeout(() => {
      setPrefs(next);
      setRowLimit(ROW_BATCH_SIZE);
    }, 0);
    return () => clearTimeout(t);
  }, [params]);

  const openedDeepLink = useRef<string | null>(null);
  // Dashboard actions link directly to a row, including legacy rows without a Record ID.
  useEffect(() => {
    const target = params.get("application");
    const identity = `${target}:${params.get("lineIndex") ?? ""}:${params.get("view") ?? ""}`;
    if (!target || !data || openedDeepLink.current === identity) return;
    const matches = data.rows.filter(
      (row) =>
        (row.recordId === target || row.key === target) &&
        (!params.has("lineIndex") ||
          row.lineIndex === Number(params.get("lineIndex"))),
    );
    if (matches.length !== 1) return;
    openedDeepLink.current = identity;
    const timer = setTimeout(
      () =>
        setOpenRef({
          key: matches[0].key,
          lineIndex: matches[0].lineIndex,
          ...(params.get("view") === "activity" ||
          params.get("view") === "review"
            ? { view: params.get("view") as "activity" | "review" }
            : {}),
        }),
      0,
    );
    return () => clearTimeout(timer);
  }, [params, data]);

  function savePrefs(p: Prefs) {
    setPrefs(p);
    setRowLimit(ROW_BATCH_SIZE);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* storage unavailable: prefs last for this visit */
    }
  }
  const setFilters = (f: Partial<Prefs["filters"]>) =>
    savePrefs({ ...prefs, filters: { ...prefs.filters, ...f } });

  const today = applicationDate();
  const filters: TrackerFilters = { ...prefs.filters, q };
  const visible = useMemo(
    () =>
      data
        ? sortRows(
            filterRows(data.rows, filters, today),
            prefs.sortKey,
            prefs.sortDir,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, q, prefs, today],
  );
  const hasMoreRows = visible.length > rowLimit;
  useEffect(() => {
    const target = moreRows.current;
    if (!hasMoreRows || !target || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setRowLimit((current) =>
          current === rowLimit ? current + ROW_BATCH_SIZE : current,
        );
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreRows, rowLimit, prefs, q]);

  if (error && !data)
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertDescription>
          Couldn&apos;t read applications.md: {error}
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!data) return <TrackerSkeleton />;

  const readOnly = data.readOnly;
  function linkAction(
    row: ApplicationRow,
    postingLink?: string,
    summary = false,
  ) {
    if (usableJobLink(postingLink) || usableJobLink(row.link)) return undefined;
    if (!row.foundLink && (readOnly || !savedJobs.data)) return undefined;
    return (
      <JobLinkControl
        row={row}
        fileHash={data!.fileHash}
        readOnly={!!readOnly}
        onChanged={reloadApplications}
        variant={summary ? "full" : "chip"}
      />
    );
  }

  const counts = viewCounts(data.rows, filters, today);
  const tabs: TrackerView[] = ["all", "applied", "in progress", "rejected"];
  const extraViews: TrackerView[] = ["to apply", "no response", "unsuccessful"];
  const openRow =
    data.rows.find(
      (r) => r.key === openRef?.key && r.lineIndex === openRef.lineIndex,
    ) ?? null;
  // Sources in use that aren't in the standard list still get a filter entry.
  const extraSources = [
    ...new Set(
      data.rows
        .map((r) => r.source.trim())
        .filter(
          (s) => s && !SOURCES.some((k) => k.toLowerCase() === s.toLowerCase()),
        ),
    ),
  ];

  async function edit(row: ApplicationRow, e: Parameters<typeof update>[1]) {
    if (await update(row, e)) {
      if (e.status) showToast(`${row.company} → ${STATUS_LABEL[e.status]}`);
      else showToast(`${row.company} updated`);
    }
  }

  function sortBy(key: SortKey) {
    const dir =
      prefs.sortKey === key
        ? prefs.sortDir === "asc"
          ? "desc"
          : "asc"
        : FIRST_DIR[key];
    savePrefs({ ...prefs, sortKey: key, sortDir: dir });
  }

  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const nFilters = activeFilterCount({ ...prefs.filters, q: "" });
  const chips: { label: React.ReactNode; clear: () => void }[] = [
    ...prefs.filters.sources.map((s) => ({
      label: (
        <>
          <SourceDot source={s} size={7} />
          {s}
        </>
      ),
      clear: () =>
        setFilters({ sources: prefs.filters.sources.filter((x) => x !== s) }),
    })),
    ...(prefs.filters.since !== "all"
      ? [
          {
            label: SINCE_LABEL[prefs.filters.since],
            clear: () => setFilters({ since: "all" }),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {savedJobs.error && (
        <p role="status" className="text-sm text-destructive">
          Review availability could not refresh.{" "}
          <button className="underline" onClick={() => void savedJobs.reload()}>
            Retry
          </button>
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tracker</h1>
        </div>
        <ReviewProgress onChange={reload} />
      </div>

      <TrackerSummary
        rows={data.rows}
        recruiting={recruiting.data}
        historyUnavailable={!!recruiting.error}
        today={today}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-auto sm:max-w-72 sm:flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search company or role"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setRowLimit(ROW_BATCH_SIZE);
            }}
            aria-label="Search applications"
          />
        </InputGroup>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" aria-label="Filter">
              <SlidersHorizontalIcon data-icon="inline-start" />
              Filter
              {nFilters ? (
                <Badge className="h-4 px-1.5">{nFilters}</Badge>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Source</DropdownMenuLabel>
              {[...SOURCES, ...extraSources].map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={prefs.filters.sources.includes(s)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() =>
                    setFilters({ sources: toggle(prefs.filters.sources, s) })
                  }
                >
                  <SourceDot source={s} />
                  {s}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Date</DropdownMenuLabel>
              {(Object.keys(SINCE_LABEL) as Since[]).map((k) => (
                <DropdownMenuCheckboxItem
                  key={k}
                  checked={prefs.filters.since === k}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => setFilters({ since: k })}
                >
                  {SINCE_LABEL[k]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" aria-label="Sort">
              Sort: {SORT_LABEL[prefs.sortKey]}
              {prefs.sortDir === "asc" ? (
                <ArrowUpIcon data-icon="inline-end" />
              ) : (
                <ArrowDownIcon data-icon="inline-end" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={prefs.sortKey}
                onValueChange={(k) =>
                  savePrefs({
                    ...prefs,
                    sortKey: k as SortKey,
                    sortDir: FIRST_DIR[k as SortKey],
                  })
                }
              >
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <DropdownMenuRadioItem key={k} value={k}>
                    {SORT_LABEL[k]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Direction</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={prefs.sortDir}
                onValueChange={(d) =>
                  savePrefs({ ...prefs, sortDir: d as SortDir })
                }
              >
                <DropdownMenuRadioItem
                  value="asc"
                  onSelect={(e) => e.preventDefault()}
                >
                  Ascending
                  <ArrowUpIcon className="ml-auto text-muted-foreground" />
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="desc"
                  onSelect={(e) => e.preventDefault()}
                >
                  Descending
                  <ArrowDownIcon className="ml-auto text-muted-foreground" />
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="icon"
          className="ml-auto"
          onClick={reload}
          title={`Reload from disk${loadedAt ? ` (last ${loadedAt.toLocaleTimeString()})` : ""}`}
          aria-label="Reload from disk"
        >
          <RefreshCwIcon />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            ariaLabel="Show"
            value={prefs.filters.view}
            onChange={(v) => setFilters({ view: v })}
            options={tabs.map((v) => ({
              value: v,
              label: (
                <span className="whitespace-nowrap">
                  {viewLabel(v)}{" "}
                  <span className="text-muted-foreground tabular-nums">
                    {counts[v]}
                  </span>
                </span>
              ),
            }))}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={
                extraViews.includes(prefs.filters.view)
                  ? "secondary"
                  : "outline"
              }
              aria-label="More statuses"
            >
              {extraViews.includes(prefs.filters.view)
                ? `${viewLabel(prefs.filters.view)} ${counts[prefs.filters.view]}`
                : "More"}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Other statuses</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={prefs.filters.view}
              onValueChange={(value) =>
                setFilters({ view: value as TrackerView })
              }
            >
              {extraViews.map((view) => (
                <DropdownMenuRadioItem key={view} value={view}>
                  {viewLabel(view)}{" "}
                  <span className="ml-auto pl-4 text-muted-foreground tabular-nums">
                    {counts[view]}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c, i) => (
            <Badge key={i} asChild variant="secondary" className="h-6 gap-1.5">
              <button
                type="button"
                onClick={c.clear}
                aria-label="Remove filter"
              >
                {c.label}
                <XIcon data-icon="inline-end" />
              </button>
            </Badge>
          ))}
          <Button
            variant="link"
            size="xs"
            onClick={() =>
              setFilters({
                sources: NO_FILTERS.sources,
                since: NO_FILTERS.since,
              })
            }
          >
            Clear all
          </Button>
        </div>
      ) : null}

      {readOnly ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            Read-only: {readOnly.reason}. Edit applications.md by hand.
          </AlertDescription>
        </Alert>
      ) : null}
      {conflict ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            applications.md changed outside the UI, so your change was not
            saved.
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  dismissConflict();
                  reload();
                }}
              >
                Reload
              </Button>
              <Button variant="outline" size="sm" onClick={reapply}>
                Reload &amp; reapply change
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            Couldn&apos;t refresh ({error}); showing the last data.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Radix status menus portal outside this scrolling table; native source selects also stay usable. */}
      <section className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <div
          className="md:min-w-(--tracker-min-width)"
          style={
            {
              "--tracker-min-width": `${COLUMNS.filter((c) => DEFAULT_COLUMNS.includes(c.id)).reduce((sum, c) => sum + Number(c.width.match(/\d+/)![0]), 32 + Math.max(0, DEFAULT_COLUMNS.length - 1) * 12)}px`,
            } as React.CSSProperties
          }
        >
          <div
            role="row"
            className="hidden gap-3 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid"
            style={{ gridTemplateColumns: gridTemplate(DEFAULT_COLUMNS) }}
          >
            {COLUMNS.filter((c) => DEFAULT_COLUMNS.includes(c.id)).map((c) =>
              c.sort ? (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => sortBy(c.sort!)}
                  className={cn(
                    "flex items-center gap-1 text-left transition-colors hover:text-foreground",
                    prefs.sortKey === c.sort && "text-foreground",
                  )}
                >
                  {c.label}
                  {prefs.sortKey === c.sort ? (
                    prefs.sortDir === "asc" ? (
                      <ArrowUpIcon className="size-3" />
                    ) : (
                      <ArrowDownIcon className="size-3" />
                    )
                  ) : null}
                </button>
              ) : (
                <span
                  key={c.id}
                  className={
                    c.id === "actions" || c.id === "review"
                      ? "text-center"
                      : undefined
                  }
                >
                  {c.label}
                </span>
              ),
            )}
          </div>

          {visible.slice(0, rowLimit).map((row) => {
            const items = savedJobs.data?.items;
            const saved = items ? savedRecordForRow(row, items) : null;
            const props = {
              row,
              hasActions: actionHistory.has(row.key),
              onReview: () =>
                setOpenRef({
                  key: row.key,
                  lineIndex: row.lineIndex,
                  view: "review",
                }),
              onActivity: () =>
                setOpenRef({
                  key: row.key,
                  lineIndex: row.lineIndex,
                  view: "activity",
                }),
              hasReview: items ? !!reviewForRecord(saved, items) : undefined,
              postingLink: usableJobLink(saved?.link) ? saved.link : undefined,
              linkAction: linkAction(row, saved?.link),
              today,
              disabled: !!readOnly || busy === row.key || busy === "bulk",
              onOpen: () =>
                setOpenRef({ key: row.key, lineIndex: row.lineIndex }),
              onEdit: (editFields: Parameters<typeof update>[1]) =>
                edit(row, editFields),
            };
            return (
              <div
                key={row.key + row.lineIndex}
                className="border-b border-border/50 last:border-b-0"
              >
                {showTable ? (
                  <AppRow {...props} columns={DEFAULT_COLUMNS} />
                ) : (
                  <AppRowCompact {...props} />
                )}
              </div>
            );
          })}

          {!visible.length ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <InboxIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {!data.rows.length
                    ? "No applications yet."
                    : "No applications match these filters."}
                </EmptyTitle>
                {data.rows.length ? (
                  <EmptyDescription>
                    Clear a filter or search to see more.
                  </EmptyDescription>
                ) : null}
              </EmptyHeader>
            </Empty>
          ) : null}
        </div>
      </section>

      {hasMoreRows && (
        <Button
          ref={moreRows}
          variant="outline"
          className="self-center"
          onClick={() =>
            setRowLimit((current) =>
              current === rowLimit ? current + ROW_BATCH_SIZE : current,
            )
          }
        >
          Show more applications
        </Button>
      )}

      {data.malformed.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Needs a hand edit</CardTitle>
            <CardDescription>
              These lines in applications.md couldn&apos;t be read (wrong number
              of cells). The UI never rewrites them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {data.malformed.map((m) => (
                <li
                  key={m.lineIndex}
                  className="overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-xs"
                >
                  {m.text}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <AppSheet
        initialView={openRef?.view ?? "summary"}
        row={openRow}
        linkAction={
          openRow
            ? linkAction(
                openRow,
                savedRecordForRow(openRow, savedJobs.data?.items ?? [])?.link,
                true,
              )
            : undefined
        }
        disabled={!!readOnly || (openRow ? busy === openRow.key : false)}
        onClose={() => setOpenRef(null)}
        onEdited={(updated) => {
          // Show the saved row right away (its key changes when company/role/link/date is edited),
          // then refresh the table so the file hash and sort order catch up.
          if (data)
            setData({
              ...data,
              rows: data.rows.map((r) =>
                r.lineIndex === updated.lineIndex ? { ...r, ...updated } : r,
              ),
            });
          setOpenRef({ key: updated.key, lineIndex: updated.lineIndex });
          reload();
        }}
        onMove={(s, date) =>
          openRow && edit(openRow, { status: s, ...(date ? { date } : {}) })
        }
        onRemove={async () => {
          if (openRow && (await remove(openRow))) {
            setOpenRef(null);
            showToast(`${openRow.company} removed`);
          }
        }}
      />
    </div>
  );
}

function TrackerSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-8 w-full max-w-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
