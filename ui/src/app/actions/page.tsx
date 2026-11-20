"use client";
import { isClosedStatus } from "@/lib/status";
import { useState, useEffect, useRef } from "react";
import {
  useRecruiting,
  AppointmentRows,
  TaskEvidenceLinks,
  taskEmailUrl,
  RecruitingState,
  ReminderChip,
  PendingMatchCard,
  MatchPicker,
} from "@/components/Recruiting";
import {
  applicationClosed,
  completedNewest,
  decisionItems,
  mailReviewsFor,
  unlinkedTask,
  DECISION_LABELS,
  ISSUE_LABELS,
  ARCHIVE_AFTER_DAYS,
  closedTimes,
  isArchivedClosure,
  type DecisionItem,
} from "@/lib/recruitingPresentation";
import {
  applicationFor,
  latestAppointmentEvidence,
  isAheadAppointment,
} from "@/lib/recruitingTypes";
import {
  PencilIcon,
  CheckIcon,
  Trash2Icon,
  XIcon,
  CircleCheckIcon,
  CircleXIcon,
  Building2Icon,
  UsersIcon,
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  ListTodoIcon,
} from "lucide-react";
import { useFetchJson, PROGRESS_CHANGED } from "@/components/useFetchJson";
import { JobLinkControl, LinkChip } from "@/components/JobLinkControl";
import { usableJobLink } from "@/lib/foundLink";
import { CategoryChip } from "@/components/CategoryChip";
import {
  ACTION_CATEGORY_STYLE,
  actionActivityId,
  latestCheckChange,
  hasNewActionMarker,
  isActionOverdue,
  type ActionGroupRef,
  type InboxAction,
  type ActionsPayload,
} from "@/lib/actionTypes";
import type { ApplicationsPayload, ApplicationRow } from "@/lib/types";
import type { OpportunityReport } from "@/lib/opportunities";
import { Modal } from "@/components/Modal";
import { AppSheet } from "@/components/tracker/AppSheet";
import { Button } from "@/components/ui/button";
import { TintBadge } from "@/components/TintBadge";
const relationships = {
  direct: ["Direct Employer", "var(--success)"],
  agency: ["Recruitment Agency", "var(--warning)"],
  consulting: ["Consulting / Outsourcing", "var(--chart-4)"],
  unknown: ["Unknown", "var(--muted-foreground)"],
};
function shortDate(value: string, dateOnly = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: dateOnly ? "UTC" : "America/New_York",
    month: "short",
    day: "numeric",
    ...(dateOnly ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(new Date(dateOnly ? `${value}T12:00:00Z` : value));
}
export default function ActionsPage() {
  const { data, error, reload } = useFetchJson<ActionsPayload>("/api/actions", {
    events: true,
  });
  const mail = useFetchJson<{
    discoveries: {
      messageId: string;
      summary: string;
      url: string;
      reviewReason?: string;
      acknowledgedAt?: string;
    }[];
  }>("/api/mail", { events: true });
  const apps = useFetchJson<ApplicationsPayload>("/api/applications", {
    events: true,
  });
  const reports = useFetchJson<OpportunityReport[]>("/api/opportunities", {
    events: true,
  });
  const recruiting = useRecruiting();
  const [selectedView, setSelectedView] = useState<"summary" | "activity">(
    "activity",
  );
  const [showHidden, setShowHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    const timer = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const [filter, setFilter] = useState("all");
  const defaultFilterApplied = useRef(false);
  const jumped = useRef(false);
  // The deep link picks its tab once; later tab clicks must not be overridden.
  const jumpFilterApplied = useRef(false);
  useEffect(() => {
    if (!data || !apps.data || !recruiting.data || jumped.current) return;
    const id = new URLSearchParams(location.search).get("action");
    if (!id) {
      const key = new URLSearchParams(location.search).get("application");
      const row = apps.data.rows.find((r) => r.key === key);
      if (row) {
        setSelectedView("activity");
        setSelected(row);
        jumped.current = true;
      }
      return;
    }
    const task = data.actions.find((a) => a.id === id);
    if (!task) return;
    const row = task.application
      ? applicationFor(task.application, apps.data.rows)
      : null;
    if (!jumpFilterApplied.current) {
      jumpFilterApplied.current = true;
      setFilter(
        row &&
          (isClosedStatus(row.status) ||
            recruiting.data.workflows.some(
              (w) => w.applicationKey === row.key && w.closure,
            ))
          ? "closed"
          : task.state === "completed"
            ? "completed"
            : // An open task with no resolvable application is a decision until it is matched.
              unlinkedTask(task, recruiting.data)
              ? "decisions"
              : "all",
      );
    }
    if (
      row &&
      new URLSearchParams(location.search).get("view") === "activity"
    ) {
      setSelectedView("activity");
      setSelected(row);
      jumped.current = true;
    }
    if (task.state === "completed" || task.hidden) setShowHidden(true);
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`action-${id}`);
      if (element) {
        element.scrollIntoView({ block: "center" });
        element.focus({ preventScroll: true });
        jumped.current = true;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [data, apps.data, recruiting.data, filter]);
  const [editingAction, setEditingAction] = useState<string | null>(null);
  // Key of the Closed-tab group whose permanent delete is awaiting confirmation.
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: InboxAction;
    kind: "completion" | "dismissal";
  } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<ApplicationRow | null>(null),
    [failure, setFailure] = useState("");
  // New/Updated markers seen on this visit. They stay visible until the page is left, but are saved
  // as seen right away, so the next visit (or a refresh) no longer shows them.
  const [visitNew, setVisitNew] = useState<
    ReadonlyMap<string, "new" | "updated">
  >(new Map());
  useEffect(() => {
    if (!data) return;
    const fresh = data.actions.filter(
      (a) => hasNewActionMarker(a, data) && !visitNew.has(a.id),
    );
    if (!fresh.length) return;
    setVisitNew((current) => {
      const next = new Map(current);
      for (const a of fresh)
        next.set(
          a.id,
          latestCheckChange(a, data)?.kind === "updated" ? "updated" : "new",
        );
      return next;
    });
    void fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "seen-new",
        items: fresh.map((a) => ({
          id: a.id,
          activityId: actionActivityId(a),
        })),
      }),
    })
      .then((r) => {
        if (r.ok) window.dispatchEvent(new Event(PROGRESS_CHANGED));
      })
      .catch(() => {});
  }, [data, visitNew]);
  useEffect(() => {
    // Only an explicit ?filter= picks the tab; otherwise a deep link may already have chosen one.
    const requested = new URLSearchParams(location.search).get("filter");
    if (
      requested === "completed" ||
      requested === "closed" ||
      requested === "decisions" ||
      requested === "all"
    )
      setFilter(requested);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 30000);
    return () => clearInterval(t);
  }, [reload]);
  function showDecisions() {
    setFilter("decisions");
    const url = new URL(location.href);
    url.searchParams.set("filter", "decisions");
    history.replaceState(null, "", url);
  }
  async function mutate(a: InboxAction, change: object) {
    try {
      setSaving(a.id);
      setFailure("");
      const r = await fetch(`/api/actions/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: a.revision, ...change }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error?.message ?? "Could not save action");
      setConfirmation(null);
      await reload();
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (e) {
      setConfirmation(null);
      setFailure(String(e));
      void reload();
    } finally {
      setSaving(null);
    }
  }
  async function transition(
    tasks: InboxAction[],
    operation: "close" | "uncomplete",
  ) {
    setSaving(tasks[0].id);
    setFailure("");
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation,
          tasks: tasks.map(({ id, revision }) => ({ id, revision })),
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message ?? "Could not move completed actions",
        );
      await reload();
      setFilter(operation === "close" ? "closed" : "all");
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (error) {
      setFailure(String(error));
      void reload();
    } finally {
      setSaving(null);
    }
  }
  async function dismissMailReview(messageId: string) {
    setSaving(messageId);
    setFailure("");
    try {
      const response = await fetch("/api/mail", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Could not dismiss request");
      await mail.reload();
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (e) {
      setFailure(String(e));
    } finally {
      setSaving(null);
    }
  }
  // A matching record owns the request even after it has been dismissed or linked.
  const mailReviews = mailReviewsFor(
    mail.data?.discoveries,
    data,
    recruiting.data,
  );
  const isClosed = (row: ApplicationRow) =>
    applicationClosed(row, recruiting.data);
  const open = (data?.actions ?? []).filter((a) => a.state === "open");
  // Only latest-check membership affects placement; priority is display metadata.
  const active = [...open].sort(
    (a, b) =>
      Number(!!latestCheckChange(b, data)) -
      Number(!!latestCheckChange(a, data)),
  );
  const known = (value?: string) =>
    !!value?.trim() &&
    !/^(unknown(?: company| role)?|(?:company|role) unknown|n\/a|not stated|unspecified)$/i.test(
      value.trim(),
    );
  // The job's link: a posting already on the row, a stored or found one, or the manual Find link chip.
  function jobLink(row: ApplicationRow) {
    if (!apps.data) return null;
    if (usableJobLink(row.link))
      return <LinkChip kind="posting" url={row.link} big />;
    return (
      <JobLinkControl
        row={row}
        fileHash={apps.data.fileHash}
        readOnly={!!apps.data.readOnly}
        onChanged={() => apps.reload()}
        variant="full"
      />
    );
  }

  function openJob(row: ApplicationRow, view: "activity" | "summary") {
    setSelectedView(view);
    setSelected(row);
  }
  function jobHeading(company?: string, role?: string) {
    return (
      <span className="font-sans text-base leading-6">
        <span className="font-semibold">{known(company) ? company : ""}</span>
        {known(company) && known(role) && (
          <span className="mx-1.5 text-muted-foreground">·</span>
        )}
        <span className="font-normal text-muted-foreground">
          {known(role) ? role : ""}
        </span>
      </span>
    );
  }
  function emailButton(url?: string) {
    return url ? (
      <Button size="sm" variant="outline" asChild>
        <a href={url} target="_blank" rel="noreferrer">
          View email
        </a>
      </Button>
    ) : (
      <span title="No email linked">
        <Button
          size="sm"
          variant="outline"
          disabled
          aria-label="View email — No email linked"
        >
          View email
        </Button>
      </span>
    );
  }
  function groupHidden(row: ApplicationRow | null, action: InboxAction) {
    return !!data?.hiddenGroups?.some((g) =>
      "application" in g
        ? !!row &&
          applicationFor(g.application, apps.data?.rows ?? [])?.key === row.key
        : !row && g.actionId === action.id,
    );
  }
  async function hideGroup(
    row: ApplicationRow | null,
    action: InboxAction,
    hidden: boolean,
  ) {
    if (!data) return;
    const group: ActionGroupRef = row
      ? {
          application: {
            rowKey: row.key,
            ...(row.recordId ? { recordId: row.recordId } : {}),
          },
        }
      : { actionId: action.id };
    try {
      setSaving(action.id);
      setFailure("");
      const response = await fetch("/api/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileHash: data.fileHash, group, hidden }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Could not update visibility");
      await reload();
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (e) {
      setFailure(String(e));
      void reload();
    } finally {
      setSaving(null);
    }
  }
  async function deleteGroup(row: ApplicationRow | null, action: InboxAction) {
    if (!data) return;
    const group: ActionGroupRef = row
      ? {
          application: {
            rowKey: row.key,
            ...(row.recordId ? { recordId: row.recordId } : {}),
          },
        }
      : { actionId: action.id };
    try {
      setSaving(action.id);
      setFailure("");
      const response = await fetch("/api/actions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileHash: data.fileHash, group }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Could not delete history");
      setDeleting(null);
      await reload();
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (e) {
      setFailure(String(e));
      void reload();
    } finally {
      setSaving(null);
    }
  }
  async function purgeHistory(
    category: "closed" | "dismissed" | "archived",
    id?: string,
  ) {
    if (!data) return;
    const key = `purge:${category}:${id ?? "all"}`;
    if (deleting !== key) {
      setDeleting(key);
      return;
    }
    setSaving(key);
    try {
      const response = await fetch("/api/actions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileHash: data.fileHash, category, id }),
      });
      if (!response.ok)
        throw new Error("History changed; refresh before deleting");
      setDeleting(null);
      await reload();
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (e) {
      setFailure(String(e));
    } finally {
      setSaving(null);
    }
  }
  /** Trash icon; one click asks to confirm with a check mark (or cancel). */
  function purgeControl(
    category: "closed" | "dismissed" | "archived",
    label: string,
  ) {
    const key = `purge:${category}:all`;
    return deleting === key ? (
      <div
        role="group"
        aria-label={`Confirm delete all ${label}`}
        className="flex gap-1"
      >
        <Button
          size="icon-sm"
          variant="destructive"
          aria-label={`Confirm delete all ${label}`}
          disabled={saving === key}
          onClick={() => void purgeHistory(category)}
        >
          <CheckIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={`Cancel delete all ${label}`}
          onClick={() => setDeleting(null)}
        >
          <XIcon />
        </Button>
      </div>
    ) : (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete all ${label}`}
        title={`Delete all ${label}`}
        onClick={() => void purgeHistory(category)}
      >
        <Trash2Icon />
      </Button>
    );
  }
  function metadata(
    a: InboxAction,
    app?: ApplicationRow | null,
    showApplied = true,
  ) {
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {a.relationship && a.relationship !== "unknown" && (
          <span className="inline-flex items-center gap-1.5">
            {a.relationship === "direct" ? (
              <Building2Icon className="size-3.5" />
            ) : a.relationship === "agency" ? (
              <UsersIcon className="size-3.5" />
            ) : (
              <BriefcaseBusinessIcon className="size-3.5" />
            )}
            {relationships[a.relationship][0]}
          </span>
        )}
        {showApplied && app?.date && app.status !== "to apply" && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDaysIcon className="size-3.5" />
            Applied {shortDate(app.date, true)}
          </span>
        )}
      </div>
    );
  }
  /** Age and date of the email behind an open task, e.g. "2 d · Nov 16". */
  function receivedAge(a: InboxAction) {
    const at = a.email?.receivedAt ?? a.createdAt;
    const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000));
    const age =
      minutes < 60
        ? `${minutes} min`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)} hr`
          : `${Math.floor(minutes / 1440)} d`;
    return `${age} ago · ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(at))}`;
  }
  function newChip(kind: "new" | "updated") {
    return (
      <span className="inline-flex items-center rounded-full bg-chart-1/10 px-2 py-0.5 text-[10px] leading-4 text-chart-1">
        {kind === "updated" ? "Updated" : "New"}
      </span>
    );
  }
  /** Mark completed / Dismiss, each confirmed inline with a check or X. */
  function openControls(a: InboxAction) {
    return (["completion", "dismissal"] as const).map((kind) => (
      <div
        key={kind}
        className={`inline-flex h-8 items-center justify-center ${kind === "completion" ? "w-36" : "w-20"}`}
      >
        {confirmation?.action.id === a.id && confirmation.kind === kind ? (
          <div
            role="group"
            aria-label={`Confirm ${kind}`}
            className="flex w-full items-center justify-center gap-1"
          >
            <Button
              size="icon-sm"
              className="h-8 min-w-0 flex-1"
              variant={kind === "dismissal" ? "destructive" : "default"}
              disabled={saving === a.id}
              aria-label={`Confirm ${kind}: ${a.text}`}
              title="Confirm"
              onClick={() =>
                void mutate(
                  confirmation.action,
                  kind === "completion"
                    ? { state: "completed" }
                    : { remove: true },
                )
              }
            >
              <CheckIcon className="size-5!" />
            </Button>
            <Button
              size="icon-sm"
              className="h-8 min-w-0 flex-1"
              variant="outline"
              disabled={saving === a.id}
              aria-label={`Cancel ${kind}: ${a.text}`}
              title="Cancel"
              onClick={() => setConfirmation(null)}
            >
              <XIcon className="size-5!" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="h-8 w-full"
            variant={kind === "dismissal" ? "ghost" : "default"}
            disabled={saving === a.id}
            onClick={() => setConfirmation({ action: a, kind })}
          >
            {kind === "dismissal"
              ? "Dismiss"
              : a.completionSuggestion
                ? "Confirm completed"
                : "Mark Completed"}
          </Button>
        )}
      </div>
    ));
  }
  /** One open task inside a job card, laid out like a completed task row. */
  function openTaskRow(a: InboxAction, showNewDot: boolean) {
    const overdue = isActionOverdue(a, new Date(now));
    return (
      <li
        id={`action-${a.id}`}
        tabIndex={-1}
        key={a.id}
        className="scroll-mt-24 space-y-2 py-2.5 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            <h3 className="flex items-start gap-2 font-sans text-sm font-medium">
              <ListTodoIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-warning"
              />
              <span className="min-w-0">
                {showNewDot && (
                  <span
                    aria-hidden="true"
                    data-new-dot
                    title="New"
                    className="mr-1.5 inline-block size-1.5 rounded-full bg-chart-1 align-middle"
                  />
                )}
                {a.text}
                {a.category && (
                  <CategoryChip
                    {...ACTION_CATEGORY_STYLE[a.category]}
                    size="md"
                  />
                )}
              </span>
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
              {a.deadline && (
                <span
                  className={`rounded-md bg-neutral-200/70 px-1.5 py-0.5 font-medium dark:bg-neutral-700/60 ${overdue ? "text-destructive" : "text-warning"}`}
                  title={a.deadline.wording}
                >
                  {overdue ? "Overdue" : "Due"}{" "}
                  {shortDate(a.deadline.at ?? a.deadline.date, !a.deadline.at)}
                </span>
              )}
              <time
                dateTime={a.email?.receivedAt ?? a.createdAt}
                title={a.email?.receivedAt ? "Email received" : "Action added"}
              >
                {a.email?.receivedAt ? "Received" : "Added"} {receivedAge(a)}
              </time>
            </div>
            {known(a.explanation) && (
              <p className="mt-1 pl-6 text-xs leading-5 text-muted-foreground">
                {a.explanation}
              </p>
            )}
            {a.reviewReason && (
              <p className="mt-1 pl-6 text-xs text-warning">{a.reviewReason}</p>
            )}
          </div>
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-7 text-muted-foreground"
              aria-label={`Edit linked application: ${a.text}`}
              title="Edit linked application"
              onClick={() => setEditingAction(a.id)}
            >
              <PencilIcon className="size-3.5!" aria-hidden="true" />
            </Button>
            {emailButton(a.email?.url)}
            {/* Complete and Dismiss wrap together on narrow screens. */}
            <div className="flex items-center gap-2">{openControls(a)}</div>
          </div>
        </div>
        {a.completionSuggestion && (
          <div className="ml-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-warning/10 px-3 py-2 text-xs">
            <p className="flex-1 basis-48">{a.completionSuggestion.reason}</p>
            <a
              className="underline underline-offset-2"
              href={a.completionSuggestion.url}
              target="_blank"
              rel="noreferrer"
            >
              View evidence
            </a>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void mutate(a, { dismiss: true })}
            >
              Keep open
            </Button>
          </div>
        )}
        {a.syncWarning && (
          <p role="alert" className="pl-6 text-xs text-warning">
            {a.syncWarning}
          </p>
        )}
        {editingAction === a.id && (
          <Modal
            open
            title="Edit linked application"
            onClose={() => setEditingAction(null)}
          >
            <MatchPicker
              editing
              action={a}
              onDone={() => {
                setEditingAction(null);
                void reload();
              }}
            />
          </Modal>
        )}
      </li>
    );
  }
  /** Footer shared by every job card: what you open to look at the job. */
  function jobButtons(row: ApplicationRow) {
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openJob(row, "summary")}
        >
          Job Summary
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openJob(row, "activity")}
        >
          Timeline
        </Button>
        {jobLink(row)}
      </>
    );
  }
  /**
   * Open work for one job, in the same card as Completed: heading, a row per open task, then the
   * job buttons. Unlinked tasks (Decisions) use it too, with Match application in the footer.
   */
  function openCard(tasks: InboxAction[]) {
    const first = tasks[0];
    const app = first.application
      ? applicationFor(first.application, apps.data?.rows ?? [])
      : null;
    const fresh = tasks.filter((t) => visitNew.has(t.id));
    const headerChip = fresh.length
      ? fresh.every((t) => visitNew.get(t.id) === "updated")
        ? "updated"
        : "new"
      : null;
    return (
      <section
        key={app?.key ?? first.id}
        aria-label={`${app?.company ?? first.company ?? "Company"} open tasks`}
        className="space-y-2 rounded-xl border bg-card p-3.5"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {headerChip && newChip(headerChip)}
            <h2>
              {jobHeading(
                app?.company ?? first.company,
                first.roleOverride ?? app?.role ?? first.role,
              )}
            </h2>
            {app && <ReminderChip row={app} data={recruiting.data} />}
          </div>
          <TintBadge color="var(--warning)" className="px-2 py-1 text-xs">
            {tasks.length} open
          </TintBadge>
        </div>
        {metadata({ ...first, state: "completed" }, app)}
        {app && <RecruitingState row={app} data={recruiting.data} />}
        <ul className="ml-3 divide-y border-t sm:ml-5">
          {tasks.map((t) =>
            openTaskRow(t, tasks.length > 1 && visitNew.has(t.id)),
          )}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          {app ? (
            jobButtons(app)
          ) : (
            <details className="w-full">
              <summary className="text-xs text-warning">
                Match application
              </summary>
              <MatchPicker action={first} onDone={() => void reload()} />
            </details>
          )}
        </div>
      </section>
    );
  }
  /** Decisions shows one unlinked task at a time. */
  const card = (a: InboxAction) => openCard([a]);
  function showOpenTask(id: string) {
    setFilter("all");
    const url = new URL(location.href);
    url.searchParams.set("filter", "all");
    history.replaceState(null, "", url);
    requestAnimationFrame(() => {
      const element = document.getElementById(`action-${id}`);
      element?.scrollIntoView({ block: "center" });
      element?.focus({ preventScroll: true });
    });
  }
  // Open counts requests; history totals include hidden application cards.
  const counts = {
    all: 0,
    unlinked: 0,
    completed: new Set<string>(),
    closed: new Set<string>(),
  };
  const historyGroups = new Map<
    string,
    { row: ApplicationRow | null; tasks: InboxAction[] }
  >();
  for (const action of data?.actions ?? []) {
    const row = action.application
      ? applicationFor(action.application, apps.data?.rows ?? [])
      : null;
    const key = row?.key ?? `unlinked:${action.id}`;
    const history = historyGroups.get(key) ?? { row, tasks: [] };
    history.tasks.push(action);
    historyGroups.set(key, history);
    if (
      (action.manuallyClosedAt || (row && isClosed(row))) &&
      !(action.state === "superseded" && action.resolution?.source === "user")
    )
      counts.closed.add(key);
    else if (action.state === "open") {
      // Unlinked tasks are decisions, not ready actions.
      if (unlinkedTask(action, recruiting.data)) counts.unlinked++;
      else counts.all++;
    } else if (action.state === "completed") counts.completed.add(key);
  }
  const appointmentOnlyRows = (apps.data?.rows ?? []).filter(
    (row) =>
      !isClosed(row) &&
      latestAppointmentEvidence(
        (recruiting.data?.events ?? []).filter(
          (e) => applicationFor(e, apps.data?.rows ?? [])?.key === row.key,
        ),
      ).some((e) => !e.appointment?.dismissed && isAheadAppointment(e)) &&
      !(data?.actions ?? []).some(
        (a) =>
          a.application &&
          applicationFor(a.application, apps.data?.rows ?? [])?.key ===
            row.key &&
          a.state === "completed",
      ),
  );
  for (const row of appointmentOnlyRows) counts.completed.add(row.key);
  const completionReviews = (recruiting.data?.events ?? []).filter(
    (e) =>
      e.evidenceRole === "contradiction" &&
      data?.actions.some(
        (a) =>
          a.id === e.taskId &&
          a.state === "completed" &&
          !a.dismissedSuggestions?.includes(e.id),
      ),
  );
  const decisions = decisionItems(data, recruiting.data, mailReviews);
  // Pick once per visit after all inputs load; manual tab changes and deep links win.
  useEffect(() => {
    if (defaultFilterApplied.current || !data || !apps.data || !recruiting.data)
      return;
    defaultFilterApplied.current = true;
    const params = new URLSearchParams(location.search);
    if (params.has("filter") || params.has("action")) return;
    setFilter(
      decisions.length + completionReviews.length > 0
        ? "decisions"
        : counts.all > 0
          ? "all"
          : "completed",
    );
  }, [
    data,
    apps.data,
    recruiting.data,
    counts.all,
    decisions.length,
    completionReviews.length,
  ]);
  const tabCounts: Record<string, number> = {
    // Open = ready-to-do tasks only; anything needing a decision lives in Decisions.
    all: counts.all,
    decisions: decisions.length + completionReviews.length,
    completed: counts.completed.size,
    closed: counts.closed.size,
  };
  const hiddenCardCount = [...historyGroups.values()].filter((g) => {
    const closed = !!g.row && isClosed(g.row);
    if (
      filter === "closed"
        ? !closed && !g.tasks.some((a) => a.manuallyClosedAt)
        : closed ||
          !g.tasks.some((a) => a.state === "completed" && !a.manuallyClosedAt)
    )
      return false;
    return (
      groupHidden(g.row, g.tasks[0]) ||
      g.tasks.some((a) => a.state === "completed" && a.hidden)
    );
  }).length;
  const searched = (list: InboxAction[]) =>
    list.filter((a) =>
      `${a.company} ${a.role} ${a.text}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <div className="space-y-4">
      <h1>Actions</h1>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Search actions"
          placeholder="Search actions…"
          name="actions-search"
          autoComplete="off"
          className="h-9 min-w-0 w-full sm:w-60 bg-background border rounded-md px-3 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div
          className="flex flex-wrap items-center gap-1"
          aria-label="Action filters"
        >
          {[
            // Decisions and Open are each offered only while they hold something (or are being viewed).
            ...(decisions.length + completionReviews.length ||
            filter === "decisions"
              ? [["decisions", "Decisions"]]
              : []),
            ...(counts.all > 0 || filter === "all" ? [["all", "Open"]] : []),
            ["completed", "Completed"],
            ["closed", "Closed"],
          ].map(([v, t]) => (
            <Button
              size="sm"
              className="h-9 px-3 text-sm"
              aria-pressed={v === filter}
              key={v}
              variant={v === filter ? "default" : "outline"}
              onClick={() => {
                setFilter(v);
                const url = new URL(location.href);
                url.searchParams.set("filter", v);
                history.replaceState(null, "", url);
              }}
            >
              {t}
              {tabCounts[v] > 0 && (
                <span className="ml-1.5 tabular-nums opacity-75">
                  {tabCounts[v]}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>
      {(error || failure || mail.error || apps.error || reports.error) && (
        <p role="alert">
          {error || failure || mail.error || apps.error || reports.error}
        </p>
      )}
      {!data && <p>Loading actions…</p>}
      {recruiting.data?.warnings?.map((warning) => (
        <p key={warning} role="status" className="text-sm text-warning">
          A recruiting follow-up is waiting: {warning}
        </p>
      ))}
      {data?.lastIncompleteAt && (
        <p role="status" className="text-sm text-warning">
          The latest check was incomplete. New markers reflect the last
          successful check.
        </p>
      )}
      {filter === "all" &&
        (() => {
          const linked = searched(
            active.filter((a) => {
              if (unlinkedTask(a, recruiting.data)) return false;
              const row = a.application
                ? applicationFor(a.application, apps.data?.rows ?? [])
                : null;
              return !row || !isClosed(row);
            }),
          );
          return (
            <>
              {decisions.length > 0 && (
                <p role="status" className="text-sm text-muted-foreground">
                  {decisions.length} item{decisions.length === 1 ? "" : "s"}{" "}
                  need your decision.{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => showDecisions()}
                  >
                    Review in Decisions
                  </button>
                </p>
              )}
              {linked.length > 0 && (
                <div className="space-y-3">
                  {(() => {
                    // One card per job; tasks keep their order (latest-check changes first).
                    const groups = new Map<string, InboxAction[]>();
                    for (const a of linked) {
                      const row = a.application
                        ? applicationFor(a.application, apps.data?.rows ?? [])
                        : null;
                      const key = row?.key ?? `unlinked:${a.id}`;
                      groups.set(key, [...(groups.get(key) ?? []), a]);
                    }
                    const deadline = (tasks: InboxAction[]) =>
                      tasks
                        .map((t) =>
                          t.deadline
                            ? Date.parse(
                                t.deadline.at ?? `${t.deadline.date}T23:59:59Z`,
                              )
                            : Infinity,
                        )
                        .sort((a, b) => a - b)[0];
                    const received = (tasks: InboxAction[]) =>
                      Math.max(
                        ...tasks.map((t) =>
                          Date.parse(t.email?.receivedAt ?? t.createdAt),
                        ),
                      );
                    return [...groups.values()]
                      .sort(
                        (a, b) =>
                          Number(b.some((t) => !!latestCheckChange(t, data))) -
                            Number(
                              a.some((t) => !!latestCheckChange(t, data)),
                            ) ||
                          deadline(a) - deadline(b) ||
                          received(b) - received(a),
                      )
                      .map((tasks) => openCard(tasks));
                  })()}
                </div>
              )}
              {data && search && !linked.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  No actions match your search.
                </p>
              )}
            </>
          );
        })()}
      {filter === "decisions" &&
        completionReviews.map((e) => {
          const row = applicationFor(e, apps.data?.rows ?? []);
          return (
            <section
              key={e.id}
              className="rounded-lg border border-warning p-4 text-warning"
            >
              <strong>⚠ Completed task needs attention · {row?.company}</strong>
              <p>{e.description}</p>
              {row && (
                <Button onClick={() => openJob(row, "activity")}>
                  Review completed task
                </Button>
              )}
            </section>
          );
        })}
      {filter === "decisions" &&
        recruiting.data &&
        (() => {
          const needle = search.toLowerCase();
          const text = (item: DecisionItem) =>
            item.kind === "unlinked-task"
              ? `${item.task.company} ${item.task.role} ${item.task.text}`
              : item.kind === "email-review"
                ? item.review.summary
                : `${item.pending.company ?? ""} ${item.pending.role ?? ""} ${item.pending.summary} ${typeof item.pending.action?.text === "string" ? item.pending.action.text : ""}`;
          const shown = decisions.filter((item) =>
            text(item).toLowerCase().includes(needle),
          );
          const important = shown.filter((item) => item.important);
          const routine = shown.filter((item) => !item.important);
          const badges = (item: DecisionItem) => (
            <>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${item.important ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}
              >
                {DECISION_LABELS[item.kind]}
              </span>
              {"issue" in item && item.issue && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {ISSUE_LABELS[item.issue]}
                </span>
              )}
            </>
          );
          const renderItem = (item: DecisionItem) => {
            if (item.kind === "unlinked-task")
              return (
                <div key={`task:${item.task.id}`} className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">{badges(item)}</div>
                  {card(item.task)}
                </div>
              );
            if (item.kind === "email-review") {
              const d = item.review;
              return (
                <section
                  key={d.messageId}
                  aria-labelledby={`mail-review-${d.messageId}`}
                  className="rounded-xl border bg-card p-4 space-y-2"
                >
                  <div className="flex flex-wrap gap-1.5">{badges(item)}</div>
                  <h3
                    id={`mail-review-${d.messageId}`}
                    className="font-sans text-sm font-semibold"
                  >
                    {d.summary}
                  </h3>
                  <p className="text-sm text-warning">{d.reviewReason}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="xs" variant="outline" asChild>
                      <a href={d.url} target="_blank" rel="noreferrer">
                        Open email
                      </a>
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!!saving}
                      onClick={() => void dismissMailReview(d.messageId)}
                    >
                      Dismiss request
                    </Button>
                  </div>
                </section>
              );
            }
            return (
              <PendingMatchCard
                key={item.pending.id}
                pending={item.pending}
                data={recruiting.data!}
                reload={recruiting.reload}
                onFailure={setFailure}
                badges={badges(item)}
              />
            );
          };
          return (
            <div id="needs-matching" className="space-y-4">
              {!decisions.length && !completionReviews.length && (
                <p className="py-8 text-sm text-muted-foreground" role="status">
                  Nothing needs your decision.
                </p>
              )}
              {decisions.length > 0 && !shown.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  No decisions match your search.
                </p>
              )}
              {important.length > 0 && (
                <section
                  aria-labelledby="needs-decision-title"
                  className="space-y-3 rounded-xl border border-l-4 border-warning/40 border-l-warning bg-warning/5 p-3.5"
                >
                  <div>
                    <h2 id="needs-decision-title" className="text-base">
                      Needs attention
                      <span className="ml-2 tabular-nums text-muted-foreground">
                        {important.length}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      These may be time-sensitive. Choose the application each
                      one belongs to, or dismiss it. Confirmed requests move to
                      Open.
                    </p>
                  </div>
                  {important.map(renderItem)}
                </section>
              )}
              {routine.length > 0 && (
                <details
                  className="space-y-3 rounded-xl border bg-card/50 p-3.5"
                  open={important.length === 0}
                >
                  <summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
                    Rejections to match
                    <span className="ml-2 tabular-nums text-muted-foreground">
                      {routine.length}
                    </span>
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Confirming only updates the tracker; no task is created.
                  </p>
                  <div className="mt-3 space-y-3">
                    {routine.map(renderItem)}
                  </div>
                </details>
              )}
            </div>
          );
        })()}
      {(filter === "completed" || filter === "closed") &&
        (() => {
          const groups = new Map<
            string,
            { row: ApplicationRow | null; tasks: InboxAction[] }
          >();
          for (const task of data?.actions ?? []) {
            const row = task.application
              ? applicationFor(task.application, apps.data?.rows ?? [])
              : null;
            if (
              filter === "closed" &&
              task.state === "superseded" &&
              task.resolution?.source === "user"
            )
              continue;
            if (
              filter === "closed"
                ? !task.manuallyClosedAt && (!row || !isClosed(row))
                : task.manuallyClosedAt ||
                  (row && isClosed(row)) ||
                  task.state !== "completed"
            )
              continue;
            const key = row?.key ?? `unlinked:${task.id}`;
            const group = groups.get(key) ?? { row, tasks: [] };
            group.tasks.push(task);
            groups.set(key, group);
          }
          const groupsToShow = [...groups.values()]
            .filter((g) =>
              `${g.row?.company ?? g.tasks[0]?.company ?? ""} ${g.row?.role ?? g.tasks[0]?.role ?? ""} ${g.tasks.map((t) => t.text).join(" ")}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .sort((a, b) => {
              const date = (g: typeof a) =>
                filter === "closed"
                  ? (recruiting.data?.workflows.find(
                      (w) =>
                        applicationFor(w, apps.data?.rows ?? [])?.key ===
                        g.row?.key,
                    )?.closedAt ?? "")
                  : ([...g.tasks]
                      .filter((t) => t.state === "completed")
                      .sort(completedNewest)[0]?.completedAt ?? "");
              return (
                (Date.parse(date(b)) || 0) - (Date.parse(date(a)) || 0) ||
                (a.row?.key ?? a.tasks[0].id).localeCompare(
                  b.row?.key ?? b.tasks[0].id,
                )
              );
            });
          // Closed groups older than 14 days are listed under "Dismissed & ready to delete".
          const closeTimes = closedTimes(
            data?.actions ?? [],
            apps.data?.rows ?? [],
            recruiting.data?.workflows ?? [],
          );
          const isArchivedGroup = (g: (typeof groupsToShow)[number]) =>
            filter === "closed" &&
            isArchivedClosure(closeTimes.get(g.tasks[0].id), new Date(now));
          const archivedGroups = groupsToShow.filter(isArchivedGroup);
          const displayedGroups = groupsToShow.filter(
            (g) =>
              !isArchivedGroup(g) &&
              (filter === "closed" || !groupHidden(g.row, g.tasks[0])) &&
              (filter === "closed" ||
                g.tasks.some((t) => t.state === "completed" && !t.hidden)),
          );
          const hiddenGroups = groupsToShow.filter(
            (g) =>
              groupHidden(g.row, g.tasks[0]) ||
              g.tasks.some((t) => t.state === "completed" && t.hidden),
          );
          const renderGroup = (
            g: (typeof groupsToShow)[number],
            hiddenSection: boolean,
          ) => {
            const completed = g.tasks
              .filter((t) => t.state === "completed")
              .sort(completedNewest);
            const hidden = groupHidden(g.row, g.tasks[0]);
            const visible = completed.filter((t) =>
              hiddenSection ? hidden || t.hidden : !t.hidden,
            );
            const row = g.row;
            const first = g.tasks[0];
            const workflow = recruiting.data?.workflows.find(
              (w) => applicationFor(w, apps.data?.rows ?? [])?.key === row?.key,
            );
            const closed = filter === "closed";
            return (
              <section
                key={row?.key ?? first.id}
                className="space-y-2 rounded-xl border bg-card p-3.5"
              >
                {closed && (
                  <p className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
                    <CircleXIcon className="size-4" />
                    {first.manuallyClosedAt
                      ? "Closed by you"
                      : row?.status === "unsuccessful"
                        ? "Unsuccessful"
                        : workflow?.closure === "rejected" ||
                            row?.status === "rejected"
                          ? "Rejected"
                          : "Closed — No response"}
                    {workflow?.closedAt
                      ? ` · ${recruiting.data?.events.some((e) => e.applicationKey === row?.key && e.kind === "rejected" && !e.id.startsWith("closure:")) ? "" : "Recorded closed "}${shortDate(workflow.closedAt)}`
                      : ""}
                  </p>
                )}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <h2>
                      {jobHeading(
                        row?.company ?? first.company,
                        row?.role ?? first.role,
                      )}
                    </h2>
                    {row && !closed && (
                      <ReminderChip row={row} data={recruiting.data} />
                    )}
                  </div>
                  <TintBadge
                    color="var(--success)"
                    className="px-2 py-1 text-xs"
                  >
                    {completed.length} completed
                  </TintBadge>
                </div>
                {metadata({ ...first, state: "completed" }, row)}
                {row && !closed && (
                  <RecruitingState row={row} data={recruiting.data} />
                )}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {completed[0]?.completedAt && (
                    <span>
                      Last completed {shortDate(completed[0].completedAt)}
                    </span>
                  )}
                  {completed.some((t) => t.hidden) && (
                    <span>
                      {completed.filter((t) => t.hidden).length} hidden
                    </span>
                  )}
                </div>
                {!closed && (
                  <ul className="ml-3 divide-y border-t sm:ml-5">
                    {(() => {
                      // Completed groups hold only completed tasks; look up the job's open work.
                      const stillOpen = row
                        ? open.filter(
                            (t) =>
                              t.application &&
                              applicationFor(
                                t.application,
                                apps.data?.rows ?? [],
                              )?.key === row.key,
                          )
                        : [];
                      return stillOpen.length ? (
                        <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                          <p className="flex items-start gap-2 font-sans text-sm font-medium text-warning">
                            <ListTodoIcon
                              aria-hidden="true"
                              className="mt-0.5 size-4 shrink-0"
                            />
                            {stillOpen.length} open task
                            {stillOpen.length === 1 ? "" : "s"}
                            {stillOpen.length === 1
                              ? ` · ${stillOpen[0].text}`
                              : ""}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto"
                            onClick={() => showOpenTask(stillOpen[0].id)}
                          >
                            View in Open
                          </Button>
                        </li>
                      ) : null;
                    })()}
                    {row && (
                      <AppointmentRows
                        row={row}
                        data={recruiting.data}
                        completed={completed}
                      />
                    )}
                    {visible.map((t) => (
                      <li
                        id={`action-${t.id}`}
                        tabIndex={-1}
                        key={t.id}
                        className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2"
                      >
                        <div className="min-w-0 flex-1 basis-48">
                          <h3 className="flex items-start gap-2 font-sans text-sm font-medium">
                            <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                            {t.text}
                          </h3>
                          <TaskEvidenceLinks task={t} data={recruiting.data} />
                          {known(t.explanation) && (
                            <p className="mt-1 pl-6 text-xs text-muted-foreground">
                              {t.explanation}
                            </p>
                          )}
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                          <time dateTime={t.completedAt}>
                            {shortDate(t.completedAt!)}
                          </time>
                          {emailButton(taskEmailUrl(t, recruiting.data))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {closed && workflow?.stage && (
                  <p className="text-xs text-muted-foreground">
                    Last stage: {workflow.stage}
                  </p>
                )}
                {closed && g.tasks.some((t) => t.state !== "completed") && (
                  <p className="text-xs text-muted-foreground">
                    {g.tasks.filter((t) => t.state !== "completed").length}{" "}
                    unfinished or dismissed · See activity
                  </p>
                )}
                {closed && deleting === (row?.key ?? first.id) && (
                  <div
                    role="group"
                    aria-label="Confirm delete"
                    className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs"
                  >
                    <p className="flex-1 basis-56">
                      Permanently delete this action history? The application
                      stays in the Tracker.
                    </p>
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      disabled={saving === first.id}
                      aria-label="Confirm delete"
                      title="Delete permanently"
                      onClick={() => void deleteGroup(row, first)}
                    >
                      <CheckIcon className="size-5!" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      disabled={saving === first.id}
                      aria-label="Cancel delete"
                      title="Cancel"
                      onClick={() => setDeleting(null)}
                    >
                      <XIcon className="size-5!" />
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                  <div className="flex flex-wrap gap-2">
                    {row ? (
                      jobButtons(row)
                    ) : (
                      <details>
                        <summary className="text-xs">Match application</summary>
                        <MatchPicker
                          action={first}
                          onDone={() => void reload()}
                        />
                      </details>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center">
                    {!closed && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={!!saving}
                        onClick={() => void transition(completed, "uncomplete")}
                      >
                        Uncomplete
                      </Button>
                    )}
                    {!closed && (
                      <Button
                        size="xs"
                        className="text-muted-foreground"
                        variant="ghost"
                        disabled={saving === first.id}
                        onClick={() =>
                          void hideGroup(
                            row,
                            first,
                            !(hidden || completed.some((t) => t.hidden)),
                          )
                        }
                      >
                        {hidden || completed.some((t) => t.hidden)
                          ? "Unhide"
                          : "Hide"}
                      </Button>
                    )}
                    {!closed && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={!!saving}
                        onClick={() => void transition(completed, "close")}
                      >
                        Close
                      </Button>
                    )}
                    {closed && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={!!saving}
                        onClick={() => setDeleting(row?.key ?? first.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            );
          };
          return (
            <div className="space-y-3">
              {filter === "closed" && (
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base">Closed</h2>
                  {purgeControl("closed", "closed history")}
                </div>
              )}
              {filter === "completed" &&
                appointmentOnlyRows
                  .filter((row) =>
                    `${row.company} ${row.role}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((row) => (
                    <section
                      key={row.key}
                      className="space-y-2 rounded-xl border bg-card p-3.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h2>{jobHeading(row.company, row.role)}</h2>
                        <TintBadge
                          color="var(--chart-1)"
                          className="px-2 py-1 text-xs"
                        >
                          Interview
                        </TintBadge>
                      </div>
                      <RecruitingState row={row} data={recruiting.data} />
                      <ul className="ml-3 divide-y border-t sm:ml-5">
                        <AppointmentRows row={row} data={recruiting.data} />
                      </ul>
                      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                        {jobButtons(row)}
                      </div>
                    </section>
                  ))}
              {displayedGroups.map((g) => renderGroup(g, false))}
              {!displayedGroups.length && (
                <p className="py-8 text-sm text-muted-foreground">
                  {hiddenCardCount && !showHidden
                    ? "History is hidden. Use View hidden below to restore it."
                    : `No ${filter} actions.`}
                </p>
              )}
              {filter !== "closed" && (
                <details
                  className="rounded-xl border bg-card p-4"
                  open={showHidden}
                  onToggle={(event) => setShowHidden(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
                    View hidden ({hiddenCardCount})
                  </summary>
                  <div
                    className="mt-3 space-y-3"
                    aria-label="Hidden action history"
                  >
                    {hiddenGroups.map((g) => renderGroup(g, true))}
                    {!hiddenGroups.length && (
                      <p className="text-sm text-muted-foreground">
                        No hidden history.
                      </p>
                    )}
                  </div>
                </details>
              )}
              {filter === "closed" && (
                <section
                  aria-label="Dismissed history"
                  className="space-y-3 border-t pt-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base">Dismissed</h2>
                    {purgeControl("dismissed", "dismissed")}
                  </div>
                  {(data?.actions ?? [])
                    .filter(
                      (a) =>
                        a.state === "superseded" &&
                        a.resolution?.source === "user",
                    )
                    .map((a) => (
                      <div key={a.id} className="rounded-lg border p-3">
                        <p>
                          {a.company} · {a.text}
                        </p>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => void purgeHistory("dismissed", a.id)}
                        >
                          {deleting === `purge:dismissed:${a.id}`
                            ? "Confirm delete"
                            : "Delete"}
                        </Button>
                      </div>
                    ))}
                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium">
                          Dismissed &amp; ready to delete
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Closed jobs move here after {ARCHIVE_AFTER_DAYS} days.
                        </p>
                      </div>
                      {archivedGroups.length > 0 &&
                        purgeControl("archived", "ready-to-delete history")}
                    </div>
                    {archivedGroups.map((g) => renderGroup(g, false))}
                    {!archivedGroups.length && (
                      <p className="text-sm text-muted-foreground">
                        Nothing ready to delete.
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>
          );
        })()}
      {data &&
        !search &&
        filter === "all" &&
        counts.all === 0 &&
        decisions.length === 0 &&
        mail.data &&
        recruiting.data && (
          <p className="py-12 text-center text-muted-foreground" role="status">
            You're all caught up!
          </p>
        )}
      {selected && (
        <AppSheet
          row={selected}
          initialView={selectedView}
          readOnly
          disabled={false}
          onClose={() => setSelected(null)}
          onEdited={(updated) => {
            setSelected(updated);
            void apps.reload();
            void reload();
          }}
          onMove={() => {}}
          onRemove={() => {}}
        />
      )}
    </div>
  );
}
