"use client";
import {
  CircleCheckIcon,
  CircleXIcon,
  CircleSlashIcon,
  Clock3Icon,
  MailIcon,
  MailCheckIcon,
  ReplyIcon,
  CalendarDaysIcon,
  CalendarClockIcon,
  CalendarCheckIcon,
  CalendarXIcon,
  CircleAlertIcon,
  ListTodoIcon,
  BriefcaseBusinessIcon,
  HourglassIcon,
  InfoIcon,
  ChevronsUpDownIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { compactAge, activeRecruitingUpdates } from "@/lib/checkSummary";
import { useFetchJson, PROGRESS_CHANGED } from "./useFetchJson";
import { Button } from "./ui/button";
import {
  applicationFor,
  appointmentState,
  isAheadAppointment,
  mirrorsRequest,
  latestAppointmentEvidence,
  daysWaiting,
  workflowLabel,
} from "@/lib/recruitingTypes";
import type {
  RecruitingEvent,
  RecruitingView,
  PendingMatch,
} from "@/lib/recruitingTypes";
import { actionJobLink, applicationClosed } from "@/lib/recruitingPresentation";
import type { ApplicationRow, ApplicationsPayload } from "@/lib/types";
import { sourceColor } from "@/lib/sources";
import { localDate } from "@/lib/config";
import { CategoryChip, MetaSep, NewPill } from "./CategoryChip";
import {
  deadlineLabel,
  updateChip,
  type ActionsPayload,
  type InboxAction,
} from "@/lib/actionTypes";
import { normalizeCompany, titleSimilarity } from "@/lib/duplicates";
export function useRecruiting() {
  const result = useFetchJson<RecruitingView>("/api/recruiting", {
    events: true,
  });
  return result;
}
export const recruitingDate = (at: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(at.length > 10 ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(at.length === 10 ? `${at}T12:00:00Z` : at));
const appointmentTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/**
 * Sort key for a timeline entry. A date-only value has no time of day, so it sorts at midday New York
 * time instead of UTC midnight (which would put it before same-day events).
 */
function timelineTime(event: { at: string }) {
  return Date.parse(
    event.at.length === 10 ? `${event.at}T17:00:00Z` : event.at,
  );
}

/** The email a completed task should link to: a check's confirmation when there is one, else the request. */
export function taskEmailUrl(task: InboxAction, data: RecruitingView | null) {
  const confirmation = data?.events.find(
    (e) =>
      e.taskId === task.id && e.evidenceRole !== "contradiction" && e.email,
  )?.email;
  return confirmation ?? task.completionSuggestion?.url ?? task.email?.url;
}

const SCHEDULING_TASK = /schedul|book|choose.*time/i;
/** Structured request kind first; the title pattern only covers tasks saved before requestKind existed. */
const isSchedulingTask = (task: InboxAction) =>
  task.requestKind
    ? task.requestKind === "scheduling"
    : SCHEDULING_TASK.test(task.text);

/** "Changed from … to …" / "Originally scheduled for …" for a revised or cancelled interview. */
function appointmentChange(
  current: RecruitingEvent,
  events: RecruitingEvent[],
) {
  const prior = events
    .filter(
      (p) =>
        p.appointment?.id === current.appointment?.id &&
        p.id !== current.id &&
        p.scheduledAt,
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!prior) return undefined;
  if (current.appointment?.cancelled)
    return `Originally scheduled for ${recruitingDate(prior.scheduledAt!)}`;
  if (
    current.scheduledAt &&
    Date.parse(current.scheduledAt) !== Date.parse(prior.scheduledAt!)
  )
    return `Changed from ${recruitingDate(prior.scheduledAt!)} to ${recruitingDate(current.scheduledAt)}`;
  return undefined;
}

/**
 * Interview rows for a job card, laid out like task rows:
 * - an interview still ahead (blue calendar, date, View email), whether or not a task led to it; a time
 *   the workspace owner proposed that the employer has not confirmed yet is labeled Proposed;
 * - for a completed scheduling task with no interview details yet, a green-calendar "Scheduled
 *   interview" row that a later check replaces with the real details.
 * A past interview leaves the card and lives only in the Timeline.
 */
export function AppointmentRows({
  row,
  data,
  completed = [],
}: {
  row: ApplicationRow;
  data: RecruitingView | null;
  /** The card's completed tasks, to notice a scheduling task whose interview is not confirmed yet. */
  completed?: InboxAction[];
}) {
  if (!data) return null;
  const all = data.events.filter(
    (e) => applicationFor(e, data.rows)?.key === row.key,
  );
  const evidence = latestAppointmentEvidence(all);
  const ahead = evidence.filter(
    (e) => !e.appointment?.dismissed && isAheadAppointment(e),
  );
  const placeholders = ahead.length
    ? []
    : completed.filter(
        (t) =>
          isSchedulingTask(t) &&
          !evidence.some((e) => e.appointment?.actionId === t.id),
      );
  const rowClass =
    "flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2";
  const meta =
    "ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground";
  return (
    <>
      {ahead.map((e) => {
        const proposed = appointmentState(e) === "Proposed";
        const change = appointmentChange(e, all);
        const Icon = proposed ? CalendarClockIcon : CalendarDaysIcon;
        return (
          <li
            key={e.appointment?.id ?? e.id}
            aria-label={proposed ? "Proposed interview" : "Upcoming interview"}
            className={rowClass}
          >
            <div className="min-w-0 flex-1 basis-48">
              <h3 className="flex items-start gap-2 font-sans text-sm font-medium">
                <Icon
                  aria-hidden="true"
                  className={`mt-0.5 size-4 shrink-0 ${proposed ? "text-muted-foreground" : "text-chart-1"}`}
                />
                {e.title}
              </h3>
              {proposed && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Proposed by you · awaiting confirmation
                </p>
              )}
              {change && (
                <p className="mt-1 text-xs text-muted-foreground">{change}</p>
              )}
              {e.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {e.description}
                </p>
              )}
            </div>
            <div className={meta}>
              {e.scheduledAt && (
                <time dateTime={e.scheduledAt}>
                  {recruitingDate(e.scheduledAt)}
                </time>
              )}
              {e.email && (
                <Button size="sm" variant="outline" asChild>
                  <a href={e.email} target="_blank" rel="noreferrer">
                    View email
                  </a>
                </Button>
              )}
            </div>
          </li>
        );
      })}
      {placeholders.map((t) => (
        <li key={`scheduled:${t.id}`} className={rowClass}>
          <div className="min-w-0 flex-1 basis-48">
            <h3 className="flex items-start gap-2 font-sans text-sm font-medium">
              <CalendarDaysIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
              Scheduled interview
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Details appear after the next check.
            </p>
          </div>
          {t.completedAt && (
            <div className={meta}>
              <time dateTime={t.completedAt}>
                {recruitingDate(t.completedAt.slice(0, 10))}
              </time>
            </div>
          )}
        </li>
      ))}
    </>
  );
}

/** Follow-up reminders (day 10, then day 18): a small dismissible chip beside the job heading. */
export function ReminderChip({
  row,
  data,
}: {
  row: ApplicationRow;
  data: RecruitingView | null;
}) {
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  // Only the current 10- and 18-day milestones; older 5/14-day events are history.
  const reminder = data.events
    .filter(
      (e) =>
        e.id.startsWith("waiting:") &&
        (e.id.includes(":10:") || e.id.includes(":18:")) &&
        !e.seen &&
        applicationFor(e, data.rows)?.key === row.key,
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!reminder) return null;
  const days = /^Waiting (\d+) days/.exec(reminder.title)?.[1];
  const strong = reminder.id.includes(":18:");
  async function dismiss() {
    setBusy(true);
    try {
      const result = await fetch("/api/recruiting", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileHash: data!.fileHash,
          seen: [reminder!.id],
        }),
      });
      if (result.ok) window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-medium ${strong ? "border-warning/40 bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}
    >
      Waiting {days} days · {strong ? "follow up now" : "consider following up"}
      <button
        type="button"
        disabled={busy}
        aria-label={`Dismiss ${days}-day reminder`}
        className="rounded-full p-0.5 hover:bg-foreground/10"
        onClick={() => void dismiss()}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

/** The one status worth a glance on a card: a completed task whose evidence needs another look. */
export function RecruitingState({
  row,
  data,
}: {
  row: ApplicationRow;
  data: RecruitingView | null;
}) {
  if (!data) return null;
  const tasks = data.actions.filter(
    (a) =>
      a.application &&
      applicationFor(a.application, data.rows)?.key === row.key,
  );
  const pending = data.events.some(
    (e) =>
      e.evidenceRole === "contradiction" &&
      tasks.some(
        (a) =>
          a.id === e.taskId &&
          a.state === "completed" &&
          !a.dismissedSuggestions?.includes(e.id),
      ),
  );
  if (!pending) return null;
  return (
    <p className="text-xs font-semibold text-warning">
      ⚠ Completed task needs attention
    </p>
  );
}

/** What a Timeline entry is. Each kind has one icon and color, explained by the legend. */
type EntryKind =
  | "task-open"
  | "task-done"
  | "task-dismissed"
  | "replied"
  | "receipt"
  | "message"
  | "interview-ahead"
  | "interview-proposed"
  | "interview-done"
  | "interview-cancelled"
  | "applied"
  | "rejected"
  | "no-response";

const ENTRY_KINDS: Record<
  EntryKind,
  { icon: LucideIcon; color: string; label: string; meaning: string }
> = {
  "task-open": {
    icon: ListTodoIcon,
    color: "text-warning",
    label: "Task to do",
    meaning: "An employer asked you to do something; it is still open.",
  },
  "task-done": {
    icon: CircleCheckIcon,
    color: "text-success",
    label: "Task completed",
    meaning: "A task you marked completed.",
  },
  "task-dismissed": {
    icon: CircleSlashIcon,
    color: "text-muted-foreground",
    label: "Task dismissed",
    meaning: "A task you dismissed as no longer needed.",
  },
  replied: {
    icon: ReplyIcon,
    color: "text-muted-foreground",
    label: "You replied",
    meaning: "An email you sent, found by a check.",
  },
  receipt: {
    icon: MailCheckIcon,
    color: "text-muted-foreground",
    label: "Confirmation received",
    meaning: "The employer confirmed receiving what you sent.",
  },
  message: {
    icon: MailIcon,
    color: "text-muted-foreground",
    label: "Employer email",
    meaning: "News or a reply from the employer.",
  },
  "interview-ahead": {
    icon: CalendarDaysIcon,
    color: "text-chart-1",
    label: "Interview",
    meaning: "A confirmed interview that is still ahead.",
  },
  "interview-proposed": {
    icon: CalendarClockIcon,
    color: "text-muted-foreground",
    label: "Proposed interview",
    meaning: "A time you proposed; the employer has not confirmed it.",
  },
  "interview-done": {
    icon: CalendarCheckIcon,
    color: "text-muted-foreground",
    label: "Past interview",
    meaning: "The interview time has passed.",
  },
  "interview-cancelled": {
    icon: CalendarXIcon,
    color: "text-muted-foreground",
    label: "Cancelled interview",
    meaning: "An interview that was cancelled.",
  },
  applied: {
    icon: BriefcaseBusinessIcon,
    color: "text-muted-foreground",
    label: "Applied",
    meaning: "When you applied, and where.",
  },
  rejected: {
    icon: CircleXIcon,
    color: "text-destructive",
    label: "Closed by employer",
    meaning: "The employer rejected or closed the application.",
  },
  "no-response": {
    icon: HourglassIcon,
    color: "text-destructive",
    label: "No response",
    meaning: "Closed after 21 days without a reply.",
  },
};

type RailEntry = {
  id: string;
  at: string;
  kind: EntryKind;
  title: string;
  /** Small line under the title, such as the task a reply belongs to. */
  context?: string;
  description?: string;
  email?: string;
  emailLabel?: string;
  extra?: ReactNode;
};

function TimelineLegend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground"
          aria-label="What the timeline icons mean"
        >
          <InfoIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-3">
        <p className="mb-2 text-xs font-semibold">Timeline icons</p>
        <ul className="space-y-1.5">
          {Object.entries(ENTRY_KINDS).map(([kind, k]) => (
            <li key={kind} className="flex items-start gap-2 text-xs">
              <k.icon
                aria-hidden="true"
                className={`mt-px size-4 shrink-0 ${k.color}`}
              />
              <span>
                <span className="font-medium">{k.label}</span>
                <span className="text-muted-foreground"> · {k.meaning}</span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function ActivityPanel({
  row,
  data,
}: {
  row: ApplicationRow;
  data: RecruitingView | null;
}) {
  const [error, setError] = useState("");
  if (!data) return <p role="status">Loading activity…</p>;
  const w = data.workflows.find(
    (w) => applicationFor(w, data.rows)?.key === row.key,
  );
  const events = data.events.filter(
    (e) => applicationFor(e, data.rows)?.key === row.key,
  );
  const tasks = data.actions.filter(
    (a) =>
      a.application &&
      applicationFor(a.application, data.rows)?.key === row.key,
  );
  const taskText = new Map(tasks.map((t) => [t.id, t.text]));
  // The task's own request/completion records are drawn by its single task entry.
  const taskOwnIds = new Set(
    tasks.flatMap((a) => (a.recruitingEvents ?? []).map((e) => e.id)),
  );
  const news = events.filter(
    (e) =>
      e.kind !== "submitted" &&
      e.kind !== "completed" &&
      !e.appointment &&
      !e.scheduledAt &&
      e.evidenceRole !== "contradiction" &&
      !mirrorsRequest(e, events) &&
      !e.id.startsWith("waiting:") &&
      !taskOwnIds.has(e.id) &&
      !e.id.startsWith("action:") &&
      !e.id.startsWith("request:") &&
      // Evidence suggesting an open task is done is shown on that task's card until confirmed.
      !tasks.some(
        (t) => t.state === "open" && t.completionSuggestion?.url === e.email,
      ),
  );
  async function resolve(task: InboxAction, id: string, reopen = false) {
    try {
      const response = await fetch(
        reopen ? "/api/actions" : `/api/actions/${task.id}`,
        {
          method: reopen ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            reopen
              ? {
                  tasks: [{ id: task.id, revision: task.revision }],
                  operation: "uncomplete",
                }
              : { revision: task.revision, keepCompleted: id },
          ),
        },
      );
      if (!response.ok) throw new Error("Task changed; refresh and try again");
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (e) {
      setError(String(e));
    }
  }

  const entries: RailEntry[] = [];
  for (const e of news) {
    const kind: EntryKind =
      e.evidenceRole === "sent" || e.kind === "followup"
        ? "replied"
        : e.evidenceRole === "receipt"
          ? "receipt"
          : e.kind === "rejected"
            ? "rejected"
            : e.kind === "no-response"
              ? "no-response"
              : "message";
    const forTask = e.taskId ? taskText.get(e.taskId) : undefined;
    entries.push({
      id: e.id,
      at: e.at,
      kind,
      title: e.title,
      context: forTask ? `For: ${forTask}` : undefined,
      description: e.description,
      email: e.email,
    });
  }
  // One entry per interview, upcoming or past, showing its latest state.
  for (const e of latestAppointmentEvidence(events)) {
    const state = appointmentState(e);
    // A proposal the employer confirmed under another id is shown by that confirmation.
    if (state === "Replaced") continue;
    const change = appointmentChange(e, events);
    entries.push({
      id: `appointment:${e.appointment?.id ?? e.id}`,
      at: e.scheduledAt ?? e.at,
      kind:
        state === "Cancelled"
          ? "interview-cancelled"
          : state === "Completed"
            ? "interview-done"
            : state === "Proposed" || state === "Not confirmed"
              ? "interview-proposed"
              : "interview-ahead",
      title: e.title,
      context:
        state === "Proposed"
          ? "Proposed by you · awaiting confirmation"
          : state === "Not confirmed"
            ? "Proposed time passed · not confirmed"
            : state === "Completed"
              ? "Interview time passed"
              : state === "Cancelled"
                ? "Cancelled"
                : "Upcoming",
      description: change ?? e.description,
      email: e.email,
    });
  }
  // A task is one entry at the time it was requested; its icon and lines show where it stands now.
  for (const task of tasks) {
    const originalRequest = task.recruitingEvents?.find(
      (e) => e.kind === "requested",
    );
    const done = task.state === "completed";
    const dismissed = task.state !== "open" && !done;
    const review = done
      ? events.find(
          (e) =>
            e.taskId === task.id &&
            e.evidenceRole === "contradiction" &&
            !task.dismissedSuggestions?.includes(e.id),
        )
      : undefined;
    entries.push({
      id: `task:${task.id}`,
      at: task.email?.receivedAt ?? originalRequest?.at ?? task.createdAt,
      kind: done ? "task-done" : dismissed ? "task-dismissed" : "task-open",
      title: task.text,
      context:
        done && task.completedAt
          ? `Marked completed ${recruitingDate(task.completedAt)}`
          : dismissed
            ? `Dismissed${task.resolvedAt ? ` ${recruitingDate(task.resolvedAt)}` : ""}${(task.resolution?.reason ?? task.resolvedReason) ? ` · ${task.resolution?.reason ?? task.resolvedReason}` : ""}`
            : "Open task",
      description: task.explanation,
      email: task.email?.url ?? originalRequest?.email,
      emailLabel: "Request email",
      extra: (
        <>
          {task.state === "open" && task.deadline && (
            <p className="mt-1 text-xs text-warning">
              Due {deadlineLabel(task.deadline)}
            </p>
          )}
          {review && (
            <div className="mt-2 space-y-2 rounded-md bg-warning/10 p-3 text-xs">
              <p>
                <strong>⚠ Completed task needs attention.</strong>{" "}
                {review.description}
              </p>
              <div className="flex flex-wrap gap-2">
                {review.email && (
                  <Button size="xs" variant="outline" asChild>
                    <a href={review.email} target="_blank" rel="noreferrer">
                      View new email
                    </a>
                  </Button>
                )}
                <Button
                  size="xs"
                  onClick={() => void resolve(task, review.id, true)}
                >
                  Reopen task
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void resolve(task, review.id)}
                >
                  Keep completed
                </Button>
              </div>
            </div>
          )}
        </>
      ),
    });
  }
  entries.sort(
    (a, b) => timelineTime(b) - timelineTime(a) || a.id.localeCompare(b.id),
  );
  if (row.status !== "to apply")
    entries.push({
      id: `applied:${row.key}`,
      at: row.date,
      kind: "applied",
      title: "Applied",
    });

  const hasOpenAction = tasks.some((a) => a.state === "open");
  const StatusIcon = w?.closure
    ? CircleXIcon
    : hasOpenAction
      ? CircleAlertIcon
      : CircleCheckIcon;
  // The next interview may only be a time the workspace owner proposed; say so instead of "Upcoming interview".
  const nextInterview = latestAppointmentEvidence(events)
    .filter((e) => !e.appointment?.dismissed && isAheadAppointment(e))
    .sort(
      (a, b) =>
        Date.parse(a.scheduledAt ?? "") - Date.parse(b.scheduledAt ?? ""),
    )[0];
  const label = workflowLabel(w, Number(hasOpenAction));
  const status =
    label === "Upcoming interview" &&
    nextInterview &&
    appointmentState(nextInterview) === "Proposed"
      ? "Interview proposed · awaiting confirmation"
      : label;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 border-b pb-4 pt-1">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 font-sans text-sm font-semibold">
            <StatusIcon
              aria-hidden="true"
              className={`size-4 shrink-0 ${w?.closure ? "text-destructive" : hasOpenAction ? "text-warning" : "text-success"}`}
            />
            {status === "Application active" ? "Up to date" : status}
          </p>
          {w?.waitingSince &&
            !w.closure &&
            !hasOpenAction &&
            (!w.scheduledAt || Date.parse(w.scheduledAt) <= Date.now()) && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3Icon aria-hidden="true" className="size-3.5" />
                Waiting {daysWaiting(w.waitingSince)} days
              </p>
            )}
        </div>
        <TimelineLegend />
      </div>
      {error && <p role="alert">{error}</p>}
      <ol className="ml-1" aria-label="Activity timeline">
        {entries.map((event, index) => {
          const k = ENTRY_KINDS[event.kind];
          return (
            <li
              key={event.id}
              className="relative pl-8 pb-6 last:pb-0 sm:min-h-14 sm:pl-32"
            >
              {index < entries.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-[9px] sm:left-[105px] top-5 bottom-0 w-px bg-border"
                />
              )}
              <k.icon
                aria-label={k.label}
                className={`absolute left-0 sm:left-24 top-0.5 size-5 bg-card ${k.color}`}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-sans text-sm font-medium">{event.title}</h3>
                <div className="order-first w-full text-xs text-muted-foreground sm:absolute sm:left-0 sm:top-0.5 sm:w-20 sm:leading-5">
                  <time dateTime={event.at}>{recruitingDate(event.at)}</time>
                </div>
              </div>
              {event.kind === "applied" && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: sourceColor(row.source) }}
                  />
                  {row.source ? `Via ${row.source}` : "Source not recorded"}
                </p>
              )}
              {event.context && (
                <p
                  className={`mt-0.5 text-xs ${event.kind === "task-done" ? "text-success" : "text-muted-foreground"}`}
                >
                  {event.context}
                </p>
              )}
              {event.description && (
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                  {event.description}
                </p>
              )}
              {event.extra}
              {event.email && (
                <Button size="xs" variant="outline" className="mt-2" asChild>
                  <a href={event.email} target="_blank" rel="noreferrer">
                    {event.emailLabel ?? "View email"}
                  </a>
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {!entries.length && (
        <p className="text-sm text-muted-foreground">
          No recorded activity yet.
        </p>
      )}
    </div>
  );
}

/** A completed card row's only extra: the warning when a later email contradicts the completion. */
export function TaskEvidenceLinks({
  task,
  data,
}: {
  task: InboxAction;
  data: RecruitingView | null;
}) {
  const attention =
    task.state === "completed" &&
    !!data?.events.some(
      (e) =>
        e.taskId === task.id &&
        e.evidenceRole === "contradiction" &&
        !task.dismissedSuggestions?.includes(e.id),
    );
  return attention ? (
    <span className="text-xs font-semibold text-warning">
      ⚠ Completed task needs attention
    </span>
  ) : null;
}

export function MatchPicker({
  pending,
  action,
  editing = false,
  onDone,
  footer,
}: {
  footer?: ReactNode;
  pending?: PendingMatch;
  editing?: boolean;
  action?: InboxAction;
  onDone: () => void;
}) {
  const apps = useFetchJson<ApplicationsPayload>("/api/applications", {
    events: true,
  });
  const state = useRecruiting();
  const [query, setQuery] = useState(""),
    [selection, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [company, setCompany] = useState(pending?.company ?? action?.company ?? ""),
    [role, setRole] = useState(pending?.role ?? action?.role ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const suggestion = pending?.suggestedApplication;
  const suggestedRow =
    suggestion && applicationFor(suggestion, apps.data?.rows ?? []);
  const current =
    editing && action?.application
      ? applicationFor(action.application, apps.data?.rows ?? [])
      : null;
  const selected = selection ?? current?.key ?? suggestedRow?.key ?? "";
  const [roleOverride, setRoleOverride] = useState(action?.roleOverride ?? "");
  const [linkOverride, setLinkOverride] = useState(
    action?.publicLinkOverride ?? "",
  );
  const selectedRow = selected
    ? applicationFor({ rowKey: selected }, apps.data?.rows ?? [])
    : null;
  const [decision, setDecision] = useState<"later" | "submitted">("later");
  const [appliedOn, setAppliedOn] = useState(localDate());
  const employer = normalizeCompany(pending?.company ?? action?.company ?? "");
  const candidateRole = pending?.role ?? action?.role ?? "";
  const closed = selectedRow && applicationClosed(selectedRow, state.data);
  const candidates = (apps.data?.rows ?? [])
    .filter((row) => !editing || !applicationClosed(row, state.data))
    .filter((r) =>
      `${r.company} ${r.role}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(!!employer && normalizeCompany(b.company) === employer) -
          Number(!!employer && normalizeCompany(a.company) === employer) ||
        titleSimilarity(b.role, candidateRole) -
          titleSimilarity(a.role, candidateRole),
    );
  async function link() {
    if (!apps.data || !state.data || !selectedRow) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/recruiting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: pending ? "match" : editing ? "action-edit" : "action",
          input: pending
            ? {
                fileHash: state.data.fileHash,
                id: pending.id,
                applicationKey: selected,
                applicationsHash: apps.data.fileHash,
              }
            : {
                id: action!.id,
                revision: action!.revision,
                ...(editing
                  ? {
                      roleOverride: roleOverride.trim(),
                      publicLinkOverride: linkOverride.trim() || undefined,
                    }
                  : {}),
                applicationKey: selected,
                applicationsHash: apps.data.fileHash,
              },
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Could not link");
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
      onDone();
    } catch (e) {
      setError(String(e));
      void apps.reload();
      void state.reload();
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!apps.data || !company.trim() || !role.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileHash: apps.data.fileHash,
          decision,
          ...(decision === "submitted" ? { date: appliedOn } : {}),
          row: {
            company: company.trim(),
            role: role.trim(),
            lane: "tech",
            resume: "tech",
            fit: null,
            match: null,
            source: "Other",
          },
        }),
      });
      const b = await r.json();
      if (!r.ok)
        throw new Error(b.error?.message ?? "Could not create application");
      await apps.reload();
      setSelected(b.rowKey);
      setCreating(false);
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 pt-2">
      {apps.error && (
        <p role="alert" className="text-xs text-destructive">
          Could not load applications: {apps.error}
        </p>
      )}
      {!apps.data && <p className="text-xs">Loading applications…</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Popover
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          setQuery("");
          setActiveIndex(-1);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-auto min-h-9 w-full justify-between gap-3 px-3 py-2 text-left"
            aria-label={
              selectedRow && suggestion
                ? "Change suggested application"
                : "Choose matching application"
            }
          >
            <span className="min-w-0 truncate text-xs">
              {selectedRow
                ? `${selectedRow.company} — ${selectedRow.role}`
                : "Choose an application"}
            </span>
            <ChevronsUpDownIcon
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] gap-2 p-2 shadow-none data-open:animate-none data-closed:animate-none"
        >
          <input
            aria-label="Search applications"
            role="combobox"
            aria-expanded={pickerOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
            }
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Search company or role…"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const next =
                  candidates.length === 0
                    ? -1
                    : event.key === "ArrowDown"
                      ? (activeIndex + 1) % candidates.length
                      : (activeIndex <= 0 ? candidates.length : activeIndex) -
                        1;
                setActiveIndex(next);
                if (next >= 0)
                  document
                    .getElementById(`${listId}-${next}`)
                    ?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "Enter" && candidates[activeIndex]) {
                event.preventDefault();
                setSelected(candidates[activeIndex].key);
                setPickerOpen(false);
              }
            }}
          />
          <div
            id={listId}
            role="listbox"
            aria-label="Applications"
            className="max-h-60 overflow-y-auto overscroll-contain"
          >
            {candidates.map((row, index) => (
              <button
                type="button"
                role="option"
                aria-selected={selected === row.key}
                id={`${listId}-${index}`}
                key={row.key}
                tabIndex={-1}
                className={`block w-full rounded-md px-3 py-2 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${activeIndex === index || selected === row.key ? "bg-muted" : ""}`}
                onClick={() => {
                  setSelected(row.key);
                  setPickerOpen(false);
                }}
              >
                <span className="block font-medium">{row.company}</span>
                <span className="mt-0.5 block break-words text-muted-foreground">
                  {row.role} · {row.date} · {row.status}
                </span>
              </button>
            ))}
            {candidates.length === 0 && (
              <p
                role="status"
                className="px-3 py-4 text-xs text-muted-foreground"
              >
                {apps.data
                  ? "No matching applications."
                  : "Loading applications…"}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {editing && (
        <div className="space-y-2">
          <label className="block text-xs">
            Action title override
            <input
              value={roleOverride}
              placeholder={selectedRow?.role}
              onChange={(e) => setRoleOverride(e.target.value)}
              className="mt-1 block w-full rounded border bg-background p-2"
            />
          </label>
          <label className="block text-xs">
            Fallback job or company URL
            <input
              type="url"
              value={linkOverride}
              onChange={(e) => setLinkOverride(e.target.value)}
              className="mt-1 block w-full rounded border bg-background p-2"
            />
          </label>
          {selectedRow &&
            !actionJobLink(action!, selectedRow) &&
            !linkOverride && (
              <p className="text-xs text-warning">
                No verified job or company link.
              </p>
            )}
        </div>
      )}
      {creating && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Create a minimal tracker record, then confirm its association.
          </p>
          <label className="block text-xs">
            Tracker status
            <select
              aria-label="New application status"
              value={decision}
              onChange={(e) =>
                setDecision(e.target.value as "later" | "submitted")
              }
              className="block w-full rounded border p-2 bg-background"
            >
              <option value="later">
                Recruiter opportunity — not submitted
              </option>
              <option value="submitted">Already applied</option>
            </select>
          </label>
          {decision === "submitted" && (
            <label className="block text-xs">
              Applied on
              <input
                type="date"
                aria-label="Applied on"
                value={appliedOn}
                max={localDate()}
                onChange={(e) => setAppliedOn(e.target.value)}
                className="block rounded border p-2 bg-background"
              />
            </label>
          )}
          <input
            aria-label="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full border rounded p-2 bg-background"
          />
          <input
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full border rounded p-2 bg-background"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {creating && (
          <Button
            size="xs"
            disabled={busy || !company.trim() || !role.trim()}
            onClick={() => void create()}
          >
            Save application
          </Button>
        )}
        <Button
          size="xs"
          disabled={busy || !selectedRow || (editing && !!closed)}
          onClick={() => void link()}
        >
          {busy ? "Saving…" : "Confirm application"}
        </Button>
        {(pending || editing) && (
          <Button
            size="xs"
            variant="outline"
            aria-expanded={creating}
            onClick={() => setCreating(!creating)}
          >
            {creating ? "Cancel creation" : "Create application"}
          </Button>
        )}
        {footer}
      </div>
    </div>
  );
}
/** One held request: what it is, why it needs the workspace owner, and the controls to match or dismiss it. */
export function PendingMatchCard({
  pending: p,
  data,
  reload,
  onFailure,
  badges,
}: {
  pending: PendingMatch;
  data: RecruitingView;
  reload: () => Promise<unknown> | void;
  onFailure: (message: string) => void;
  badges?: ReactNode;
}) {
  // Lead with the task this request will become, not the email's summary.
  const task = typeof p.action?.text === "string" ? p.action.text : null;
  const detail =
    typeof p.action?.explanation === "string" ? p.action.explanation : null;
  const footer = (
    <>
      <Button size="xs" variant="outline" asChild>
        <a href={p.email} target="_blank" rel="noreferrer">
          <MailIcon aria-hidden="true" />
          Open email
        </a>
      </Button>
      <PendingPosting pending={p} />
      <Button
        variant="ghost"
        size="xs"
        className="ml-auto"
        onClick={() =>
          void fetch("/api/recruiting", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileHash: data.fileHash,
              dismissed: [p.id],
            }),
          })
            .then(async (r) => {
              if (!r.ok) throw new Error("Could not dismiss request");
              await reload();
              window.dispatchEvent(new Event(PROGRESS_CHANGED));
            })
            .catch((e) => onFailure(String(e)))
        }
      >
        Dismiss request
      </Button>
    </>
  );
  const matchedRow = p.resolvedKey
    ? applicationFor({ applicationKey: p.resolvedKey }, data.rows)
    : null;
  const matchedLabel = matchedRow
    ? `${matchedRow.company} — ${matchedRow.role}`
    : "your chosen application";
  return (
    <section className="rounded-xl border bg-card p-4">
      {badges && <div className="mb-2 flex flex-wrap gap-1.5">{badges}</div>}
      <h4 className="font-sans text-sm font-semibold">{task ?? p.summary}</h4>
      {detail && <p className="mt-1 text-sm">{detail}</p>}
      {task && task !== p.summary && (
        <p className="mt-1 text-xs text-muted-foreground">
          Email: <span>{p.summary}</span>
        </p>
      )}
      <p className="my-2 text-xs text-warning">
        <span className="font-medium">Why it needs you:</span> {p.reason}
      </p>
      {p.resolvedKey ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            Matched to {matchedLabel}. The next check will read the email and
            create the task.
          </p>
          <div className="flex flex-wrap items-center gap-2">{footer}</div>
        </>
      ) : (
        <MatchPicker pending={p} onDone={() => void reload()} footer={footer} />
      )}
    </section>
  );
}
function PendingPosting({ pending }: { pending: PendingMatch }) {
  const link = pending.action?.publicLink;
  if (
    !link ||
    typeof link !== "object" ||
    !("url" in link) ||
    typeof link.url !== "string" ||
    !URL.canParse(link.url) ||
    !["http:", "https:"].includes(new URL(link.url).protocol)
  )
    return null;
  return (
    <Button size="xs" variant="outline" asChild>
      <a href={link.url} target="_blank" rel="noreferrer">
        Open recruiting link
      </a>
    </Button>
  );
}

export function RecruitingUpdates({
  check,
  onSummary,
  limit,
  bare = false,
}: {
  check?: ReactNode;
  /** Render inside another card: no border, smaller heading. */
  bare?: boolean;
  onSummary: (row: ApplicationRow) => void;
  /** Show only the newest N updates, noting how many more remain. */
  limit?: number;
}) {
  const { data, error, reload } = useRecruiting();
  const tasks = useFetchJson<ActionsPayload>("/api/actions", { events: true });
  const [failure, setFailure] = useState("");
  const active = activeRecruitingUpdates(
    data?.events ?? [],
    new Set(tasks.data?.actions.map((a) => a.id)),
  );
  // Updates unread when this page opened keep their blue dot for this visit only: they are saved as
  // viewed straight away, so the dot is gone on the next visit. Viewed is not dismissed.
  const [visitUnread, setVisitUnread] = useState<ReadonlySet<string> | null>(
    null,
  );
  const ready = !!data && !!tasks.data;
  useEffect(() => {
    if (!ready || visitUnread || !data) return;
    const ids = active
      .slice(0, limit)
      .filter((e) => !e.viewedAt)
      .map((e) => e.id);
    setVisitUnread(new Set(ids));
    if (!ids.length) return;
    // A concurrent writer changes the hash; the next visit simply tries again.
    void fetch("/api/recruiting", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileHash: data.fileHash, viewed: ids }),
    })
      .then((r) => {
        if (r.ok) window.dispatchEvent(new Event(PROGRESS_CHANGED));
      })
      .catch(() => {});
  }, [ready, visitUnread, data, active, limit]);
  const unread = (e: { id: string; viewedAt?: string }) =>
    !e.viewedAt || !!visitUnread?.has(e.id);

  async function dismiss(id: string, viewed = false) {
    // Opening an update's email or summary reads it now, not just on the next visit.
    if (viewed)
      setVisitUnread((current) => {
        if (!current?.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    try {
      const response = await fetch("/api/recruiting", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileHash: data!.fileHash,
          ...(viewed ? { viewed: [id] } : { seen: [id] }),
        }),
      });
      if (!response.ok)
        throw new Error("Updates changed; refresh and try again");
      window.dispatchEvent(new Event(PROGRESS_CHANGED));
      await reload();
    } catch (e) {
      setFailure(String(e));
      void reload();
    }
  }
  function item(e: (typeof active)[number]) {
    const row = applicationFor(e, data!.rows);
    // The company and role sit on the second line, like Actions cards.
    const headline =
      e.kind === "rejected"
        ? e.wasInProgress || row?.status === "unsuccessful"
          ? "Unsuccessful"
          : "Rejected"
        : e.title;
    // A scheduled time belongs in the title ("Webinar confirmed · Nov 19, 11:00 AM EST").
    const title = e.scheduledAt
      ? `${headline} · ${appointmentTime.format(new Date(e.scheduledAt))}`
      : headline;
    const chip = updateChip(e);
    return (
      <li
        key={e.id}
        className="rounded-md border-b px-2 py-2 last:border-0 hover:bg-muted/40"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span
            aria-label={unread(e) ? "New update" : "Read update"}
            className={`mt-1.5 size-1.5 shrink-0 self-start rounded-full ${unread(e) ? "bg-chart-1" : "bg-transparent"}`}
          />
          <div className="min-w-0 flex-1 basis-40">
            <p className="text-sm font-medium break-words" title={title}>
              {title}
              {chip && <CategoryChip {...chip} />}
            </p>
            {e.kind === "rejected" && e.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {e.description}
              </p>
            )}
            <p className="mt-0.5 flex flex-wrap items-center gap-y-1 text-xs text-muted-foreground">
              {row?.company && (
                <>
                  {row.company}
                  <MetaSep />
                </>
              )}
              {row?.role && (
                <>
                  {row.role}
                  <MetaSep />
                </>
              )}
              <time dateTime={e.at}>{compactAge(e.at)}</time>
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
            {e.email ? (
              <Button
                size="xs"
                className="px-1.5 text-[11px]"
                variant="outline"
                asChild
              >
                <a
                  href={e.email}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => void dismiss(e.id, true)}
                >
                  View Email
                </a>
              </Button>
            ) : (
              <Button
                size="xs"
                className="px-1.5 text-[11px]"
                variant="outline"
                disabled
              >
                View Email
              </Button>
            )}
            {row && (
              <Button
                size="xs"
                className="px-1.5 text-[11px]"
                variant="outline"
                onClick={() => {
                  onSummary(row);
                  void dismiss(e.id, true);
                }}
              >
                Job Summary
              </Button>
            )}
            <Button
              size="xs"
              className="px-1.5 text-[11px]"
              variant="ghost"
              aria-label={`Dismiss ${e.title}`}
              onClick={() => void dismiss(e.id)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </li>
    );
  }
  return (
    <section
      aria-label="Recruiting updates"
      className={bare ? "min-w-0" : "rounded-xl border bg-card p-4"}
    >
      <div
        className={`mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${bare ? "" : "border-b pb-3"}`}
      >
        {bare ? (
          <h3 className="text-sm">Updates</h3>
        ) : (
          <h2 className="text-base">Updates</h2>
        )}
        {/* Unread when this page opened; saved as viewed right away, so it is gone next visit. */}
        <NewPill
          count={active.filter((e) => visitUnread?.has(e.id)).length}
          label="New updates"
        />
        {check}
      </div>
      {!data && !error && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Loading updates…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-warning">
          Could not refresh updates: {error}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}
      {data && !active.length && (
        <p className="text-sm text-muted-foreground mt-2">
          No new recruiting updates.
        </p>
      )}
      <ul className="space-y-2">{active.slice(0, limit).map(item)}</ul>
      {limit !== undefined && active.length > limit && (
        <p className="mt-2 text-xs text-muted-foreground">
          +{active.length - limit} more updates
        </p>
      )}
    </section>
  );
}
