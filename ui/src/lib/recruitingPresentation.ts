import { isClosedStatus } from "./status";
import {
  applicationFor,
  currentAppointments,
  appointmentEnd,
  type MatchIssue,
  type PendingMatch,
  type RecruitingView,
} from "./recruitingTypes";
import {
  compareReceivedNewest,
  isActionOverdue,
  latestCheckChange,
  type ActionsPayload,
  type InboxAction,
} from "./actionTypes";
import { localDate } from "./config";
import type { ApplicationRow } from "./types";
export function completedNewest(a: InboxAction, b: InboxAction) {
  return (
    Date.parse(b.completedAt ?? "1970-01-01") -
      Date.parse(a.completedAt ?? "1970-01-01") || a.id.localeCompare(b.id)
  );
}
export function applicationClosed(
  row: ApplicationRow,
  recruiting: RecruitingView | null,
) {
  return (
    isClosedStatus(row.status) ||
    !!recruiting?.workflows.some(
      (w) => w.closure && applicationFor(w, recruiting.rows)?.key === row.key,
    )
  );
}

export function outstanding(
  data: ActionsPayload,
  recruiting: RecruitingView | null,
) {
  return data.actions.filter((a) => {
    if (a.state !== "open") return false;
    const row =
      a.application &&
      recruiting &&
      applicationFor(a.application, recruiting.rows);
    return !row || !applicationClosed(row, recruiting);
  });
}
/** A task whose application is missing or ambiguous: the workspace owner has to pick one before it is a normal action. */
export function unlinkedTask(
  task: InboxAction,
  recruiting: RecruitingView | null,
) {
  return (
    !task.application ||
    !recruiting ||
    !applicationFor(task.application, recruiting.rows)
  );
}

/** Requests waiting for the workspace owner to confirm or pick the application they belong to. */
export function pendingMatches(recruiting: RecruitingView | null) {
  return recruiting?.pending.filter((p) => !p.processed) ?? [];
}

export interface MailDiscoveryReview {
  messageId: string;
  summary: string;
  url: string;
  reviewReason?: string;
  acknowledgedAt?: string;
}

/**
 * Mail discoveries flagged for review that have no task and no matching record of their own.
 * A matching pending item owns the request, even after it has been dismissed or linked.
 */
export function mailReviewsFor(
  discoveries: MailDiscoveryReview[] | undefined,
  actions: ActionsPayload | null | undefined,
  recruiting: RecruitingView | null | undefined,
) {
  if (!discoveries || !actions || !recruiting) return [];
  return discoveries.filter(
    (d) =>
      d.reviewReason &&
      !d.acknowledgedAt &&
      !actions.actions.some((a) => a.email?.messageId === d.messageId) &&
      !recruiting.pending.some(
        (p) => p.id === `gmail:${d.messageId}:match` || p.email === d.url,
      ),
  );
}

/** Ready-to-do tasks: open, on a live application that resolves. Nothing here needs a decision. */
export function readyActions(
  actions: ActionsPayload,
  recruiting: RecruitingView | null,
) {
  return outstanding(actions, recruiting).filter(
    (a) => !unlinkedTask(a, recruiting),
  );
}

export type DecisionKind =
  "rejection" | "request" | "unlinked-task" | "email-review";

export const DECISION_LABELS: Record<DecisionKind, string> = {
  rejection: "Rejection to match",
  request: "Request to match",
  "unlinked-task": "Task needs an application",
  "email-review": "Email to review",
};

export const ISSUE_LABELS: Record<MatchIssue | "suggested", string> = {
  "not-in-tracker": "Not in tracker",
  "several-candidates": "Several candidates",
  "role-differs": "Role differs",
  "no-role": "No role in email",
  suggested: "Suggested match",
};

export type DecisionItem =
  | {
      kind: "rejection" | "request";
      important: boolean;
      issue?: MatchIssue | "suggested";
      pending: PendingMatch;
    }
  | { kind: "unlinked-task"; important: true; task: InboxAction }
  | { kind: "email-review"; important: true; review: MailDiscoveryReview };

/**
 * Everything that needs the workspace owner before it is a plain task, classified once. A held rejection with no
 * task of its own is routine bookkeeping; every other kind can hide something time-sensitive.
 */
export function decisionItems(
  actions: ActionsPayload | null | undefined,
  recruiting: RecruitingView | null,
  mailReviews: MailDiscoveryReview[],
): DecisionItem[] {
  const items: DecisionItem[] = [];
  for (const pending of pendingMatches(recruiting)) {
    const rejection = pending.event?.kind === "rejected" && !pending.action;
    const suggested =
      !!pending.suggestedApplication &&
      !!applicationFor(pending.suggestedApplication, recruiting?.rows ?? []);
    items.push({
      kind: rejection ? "rejection" : "request",
      important: !rejection,
      issue: pending.matchIssue ?? (suggested ? "suggested" : undefined),
      pending,
    });
  }
  if (actions)
    for (const task of outstanding(actions, recruiting))
      if (unlinkedTask(task, recruiting))
        items.push({ kind: "unlinked-task", important: true, task });
  for (const review of mailReviews)
    items.push({ kind: "email-review", important: true, review });
  return items;
}

/** The Open view counts only ready tasks; decisions have their own tab and count. */
export function openViewTotal(
  actions: ActionsPayload,
  recruiting: RecruitingView | null,
) {
  return readyActions(actions, recruiting).length;
}

export function rankedPreview(
  actions: InboxAction[],
  data: ActionsPayload,
  now = new Date(),
  limit = 3,
) {
  const rank = (a: InboxAction) =>
    isActionOverdue(a, now)
      ? 0
      : a.deadline &&
          (a.deadline.at
            ? localDate(new Date(a.deadline.at))
            : a.deadline.date) <= localDate(now, 7)
        ? 1
        : 2;
  return [...actions]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Number(!!latestCheckChange(b, data)) -
          Number(!!latestCheckChange(a, data)) ||
        (a.deadline?.date ?? "9999").localeCompare(
          b.deadline?.date ?? "9999",
        ) ||
        compareReceivedNewest(a, b),
    )
    .slice(0, limit);
}
export interface CalendarItem {
  id: string;
  date: string;
  at?: string;
  company: string;
  role: string;
  title: string;
  href: string;
  overdue: boolean;
  upcomingUntil?: number;
  /** An interview time the workspace owner proposed that the employer has not confirmed yet. */
  proposed?: boolean;
}

export function upcomingDeadlineItems(items: CalendarItem[], now: Date) {
  const today = localDate(now);
  return items.filter((item) =>
    item.upcomingUntil === undefined
      ? item.date >= today || item.overdue
      : now.getTime() < item.upcomingUntil,
  );
}

/**
 * Active deadlines and appointments in list order, numbered from 1 so the
 * calendar can label each highlighted day with the matching list number.
 * Past appointments drop out; overdue open tasks stay (they still need doing).
 */
export function numberedUpcoming(items: CalendarItem[], now: Date) {
  return upcomingDeadlineItems(items, now).map((item, index) => ({
    ...item,
    number: index + 1,
  }));
}

export function deadlineItems(
  data: ActionsPayload,
  recruiting: RecruitingView | null,
  now = new Date(),
): CalendarItem[] {
  const items: CalendarItem[] = outstanding(data, recruiting).flatMap((a) =>
    a.deadline
      ? [
          {
            id: a.id,
            date: a.deadline.at
              ? localDate(new Date(a.deadline.at))
              : a.deadline.date,
            at: a.deadline.at,
            company: a.company ?? "Company unknown",
            role: a.role ?? "Role unknown",
            title: a.text,
            href: `/actions?action=${encodeURIComponent(a.id)}&view=activity#action-${a.id}`,
            overdue: isActionOverdue(a, now),
          },
        ]
      : [],
  );
  for (const w of recruiting?.workflows ?? []) {
    if (w.closure) continue;
    const row = applicationFor(w, recruiting!.rows);
    if (!row) continue;
    const events = recruiting!.events.filter(
      (e) =>
        applicationFor(e, recruiting!.rows)?.key === row.key &&
        (e.appointment || e.scheduledAt === w.scheduledAt),
    );
    const appointments = currentAppointments(events);
    const schedules =
      appointments.length || events.some((e) => e.appointment)
        ? appointments.map((e) => ({ at: e.scheduledAt!, event: e }))
        : w.scheduledAt
          ? [{ at: w.scheduledAt, event: undefined }]
          : [];
    for (const { at, event } of schedules) {
      const actionId = event?.appointment?.actionId;
      // A date-only interview stays date-only: no invented time, and no UTC-midnight day shift.
      const dateOnly = at.length === 10;
      items.push({
        id: `schedule:${row.key}:${event?.appointment?.id ?? at}`,
        date: dateOnly ? at : localDate(new Date(at)),
        ...(dateOnly ? {} : { at }),
        ...(event?.appointment?.proposed ? { proposed: true } : {}),
        upcomingUntil: event ? appointmentEnd(event) : Date.parse(at),
        company: row.company,
        role: row.role,
        title: event?.title ?? "Scheduled recruiting event",
        href: actionId
          ? `/actions?action=${encodeURIComponent(actionId)}&view=activity#action-${actionId}`
          : `/actions?application=${encodeURIComponent(row.key)}&view=activity`,
        overdue: false,
      });
    }
  }
  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.at ? Date.parse(a.at) : 0) - (b.at ? Date.parse(b.at) : 0) ||
      a.id.localeCompare(b.id),
  );
}

export function actionJobLink(
  action: InboxAction,
  row?: ApplicationRow | null,
) {
  return [row?.link, action.publicLinkOverride, action.publicLink?.url].find(
    (url) =>
      url && URL.canParse(url) && /^https?:$/.test(new URL(url).protocol),
  );
}

/** Closed history older than this moves under "Dismissed & ready to delete". */
export const ARCHIVE_AFTER_DAYS = 14;

/**
 * When each action's job closed, as a time in ms. Actions of one application share
 * the latest of its workflow closure and any manual close, so a job moves between
 * Closed and ready-to-delete as a whole. Unknown close times are left out and stay Closed.
 */
export function closedTimes(
  actions: InboxAction[],
  rows: ApplicationRow[],
  workflows: {
    closedAt?: string;
    applicationKey?: string;
    rowKey?: string;
    recordId?: string;
  }[],
) {
  const byGroup = new Map<string, number>();
  const groupOf = (a: InboxAction) =>
    (a.application && applicationFor(a.application, rows)?.key) ||
    `unlinked:${a.id}`;
  const bump = (key: string, iso?: string) => {
    const t = Date.parse(iso ?? "");
    if (Number.isFinite(t))
      byGroup.set(key, Math.max(byGroup.get(key) ?? 0, t));
  };
  for (const w of workflows) {
    const key = applicationFor(w, rows)?.key;
    if (key) bump(key, w.closedAt);
  }
  for (const a of actions) bump(groupOf(a), a.manuallyClosedAt);
  const result = new Map<string, number>();
  for (const a of actions) {
    const t = byGroup.get(groupOf(a));
    if (t) result.set(a.id, t);
  }
  return result;
}

export function isArchivedClosure(closedMs: number | undefined, now: Date) {
  return (
    closedMs !== undefined &&
    now.getTime() - closedMs >= ARCHIVE_AFTER_DAYS * 86_400_000
  );
}
