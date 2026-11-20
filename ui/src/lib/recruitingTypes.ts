import type { ApplicationRow } from "./types";
import type { InboxAction } from "./actionTypes";
export interface RecruitingEvent {
  id: string;
  applicationKey: string;
  recordId?: string;
  kind:
    | "submitted"
    | "requested"
    | "completed"
    | "response"
    | "interview"
    | "stage"
    | "followup"
    | "rejected"
    | "no-response";
  at: string;
  title: string;
  description: string;
  email?: string;
  notify: boolean;
  seen: boolean;
  viewedAt?: string;
  discoveredAt?: string;
  wasInProgress?: boolean;
  responseExpected?: boolean;
  responseDue?: string;
  scheduledAt?: string;
  scheduledEndAt?: string;
  taskId?: string;
  evidenceRole?: "sent" | "receipt" | "contradiction";
  closureSource?: "user" | "email" | "system";
  notificationEligible?: boolean;
  appointment?: {
    id: string;
    actionId?: string;
    sequence?: number;
    cancelled?: boolean;
    dismissed?: boolean;
    /** the workspace owner proposed or accepted this time in a Sent reply; the employer has not confirmed it. */
    proposed?: boolean;
    /** This proposal was confirmed under another appointment id (for example a calendar UID). */
    replacedBy?: string;
  };
  stage?: string;
}
export interface RecruitingWorkflow {
  applicationKey: string;
  recordId?: string;
  status: string;
  observedAt: string;
  statusAt: string;
  /** Observed transitions only; the initial snapshot is not activity. */
  statusHistory?: { status: string; at: string }[];
  reopenedAt?: string;
  waitingSince?: string;
  responseDue?: string;
  scheduledAt?: string;
  scheduledUntil?: string;
  stage?: string;
  closedAt?: string;
  closure?: "rejected" | "no-response";
}
/** Why a request could not be matched to one application automatically. */
export type MatchIssue =
  "not-in-tracker" | "several-candidates" | "role-differs" | "no-role";
export interface PendingMatch {
  id: string;
  company?: string;
  role?: string;
  summary: string;
  reason: string;
  email: string;
  receivedAt: string;
  event?: Omit<
    RecruitingEvent,
    "applicationKey" | "recordId" | "seen" | "wasInProgress"
  >;
  action?: Record<string, unknown>;
  suggestedApplication?: { rowKey: string; recordId?: string };
  matchIssue?: MatchIssue;
  resolvedKey?: string;
  processed?: boolean;
  dismissedAt?: string;
}
export interface RecruitingPayload {
  version: 1;
  startedAt: string;
  events: RecruitingEvent[];
  workflows: RecruitingWorkflow[];
  pending: PendingMatch[];
  fileHash: string;
}
export interface RecruitingView extends RecruitingPayload {
  rows: ApplicationRow[];
  actions: InboxAction[];
  /** Follow-ups that could not complete (e.g. their application was deleted); never fatal. */
  warnings?: string[];
}
// Lookup tables per rows array. Callers resolve hundreds of workflows/events/tasks against the same
// rows, so scanning the array for each one is quadratic (~2.5 s on the real tracker). The WeakMap lets
// the table live exactly as long as the rows array; `size` guards against an array mutated in place.
type RowIndex = {
  size: number;
  byKey: Map<string, ApplicationRow[]>;
  byRecordId: Map<string, ApplicationRow[]>;
};
const rowIndexes = new WeakMap<ApplicationRow[], RowIndex>();

function indexRows(rows: ApplicationRow[]): RowIndex {
  const cached = rowIndexes.get(rows);
  if (cached && cached.size === rows.length) return cached;
  const byKey = new Map<string, ApplicationRow[]>();
  const byRecordId = new Map<string, ApplicationRow[]>();
  const add = (
    map: Map<string, ApplicationRow[]>,
    k: string,
    r: ApplicationRow,
  ) => {
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  };
  for (const r of rows) {
    add(byKey, r.key, r);
    if (r.recordId) add(byRecordId, r.recordId, r);
  }
  const index = { size: rows.length, byKey, byRecordId };
  rowIndexes.set(rows, index);
  return index;
}

export function applicationFor(
  ref: { rowKey?: string; applicationKey?: string; recordId?: string },
  rows: ApplicationRow[],
) {
  const { byKey, byRecordId } = indexRows(rows);
  const key = ref.rowKey ?? ref.applicationKey;
  const exact = key ? (byKey.get(key) ?? []) : [];
  if (exact.length > 1) return null;
  if (!ref.recordId) return exact[0] ?? null;
  const byId = byRecordId.get(ref.recordId) ?? [];
  // A stale key can recover by ID after a row changes. A key that still points
  // at a different row is conflicting evidence.
  if (byId.length !== 1 || (exact[0] && exact[0] !== byId[0])) return null;
  return byId[0];
}
// Older interview events used one implicit appointment per application.
export function latestAppointmentEvidence(events: RecruitingEvent[]) {
  const current = new Map<string, RecruitingEvent>();
  for (const event of events) {
    if (!event.appointment && !event.scheduledAt) continue;
    const key = event.appointment?.id ?? "legacy";
    const previous = current.get(key);
    const revision = event.appointment?.sequence ?? 0;
    const priorRevision = previous?.appointment?.sequence ?? 0;
    if (
      !previous ||
      revision > priorRevision ||
      (revision === priorRevision &&
        Date.parse(event.at) >= Date.parse(previous.at))
    )
      current.set(key, event);
  }
  return [...current.values()];
}

export function currentAppointments(events: RecruitingEvent[]) {
  return latestAppointmentEvidence(events).filter(
    (e) =>
      !e.appointment?.cancelled &&
      !e.appointment?.dismissed &&
      !e.appointment?.replacedBy &&
      e.scheduledAt,
  );
}

export function mirrorsRequest(
  event: RecruitingEvent,
  events: RecruitingEvent[],
) {
  return (
    event.kind === "interview" &&
    !event.scheduledAt &&
    !event.appointment &&
    !!event.email &&
    events.some(
      (request) =>
        request.kind === "requested" &&
        (request.recordId ?? request.applicationKey) ===
          (event.recordId ?? event.applicationKey) &&
        request.email === event.email &&
        Date.parse(request.at) === Date.parse(event.at),
    )
  );
}

export function daysWaiting(since: string, now = new Date()) {
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  return Math.max(
    0,
    Math.round(
      (Date.parse(day(now)) - Date.parse(day(new Date(since)))) / 86400000,
    ),
  );
}
export function followUpDue(w: RecruitingWorkflow, now: Date) {
  if (!w.waitingSince) return false;
  return (
    daysWaiting(w.waitingSince, now) >= 10 &&
    (!w.responseDue || Date.parse(w.responseDue) <= now.getTime())
  );
}

export function workflowLabel(
  w: RecruitingWorkflow | undefined,
  open: number,
  now = new Date(),
) {
  if (w?.closure)
    return w.closure === "rejected"
      ? "Rejected / Closed"
      : "Closed — No response";
  if (open) return `Action needed · ${open} tasks`;
  if (
    w?.scheduledAt &&
    Date.parse(w.scheduledUntil ?? w.scheduledAt) > now.getTime()
  )
    return "Upcoming interview";
  if (w?.waitingSince)
    return followUpDue(w, now)
      ? "Follow-up recommended"
      : "Awaiting employer response";
  return "No next step recorded";
}

function* actionHistoryKeys(data: RecruitingView | null) {
  if (!data) return;
  for (const action of data.actions) {
    if (!action.application) continue;
    const row = applicationFor(action.application, data.rows);
    if (row) yield row.key;
  }
  for (const event of data.events) {
    if (event.kind === "submitted" || event.id.startsWith("waiting:")) continue;
    const row = applicationFor(event, data.rows);
    if (row) yield row.key;
  }
}

/** Resolve activity links once when displaying a list of applications. */
export function applicationKeysWithActionHistory(data: RecruitingView | null) {
  return new Set(actionHistoryKeys(data));
}

/** A submitted-only row keeps its summary view until substantive activity exists. */
export function hasActionHistory(
  row: ApplicationRow,
  data: RecruitingView | null,
) {
  for (const key of actionHistoryKeys(data)) {
    if (key === row.key) return true;
  }
  return false;
}

/** End-of-day fallback respects New York DST without assuming a meeting duration. */
export function appointmentEnd(event: RecruitingEvent): number {
  if (event.scheduledEndAt) return Date.parse(event.scheduledEndAt);
  if (!event.scheduledAt) return Infinity;
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const day =
    event.scheduledAt.length === 10
      ? event.scheduledAt
      : date(new Date(event.scheduledAt));
  let low = Date.parse(`${day}T00:00:00Z`),
    high = low + 48 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (date(new Date(mid)) <= day) low = mid;
    else high = mid;
  }
  return high;
}
export function appointmentState(
  event: RecruitingEvent,
  now = new Date(),
):
  | "Replaced"
  | "Cancelled"
  | "Not confirmed"
  | "Completed"
  | "Proposed"
  | "Upcoming" {
  if (event.appointment?.replacedBy) return "Replaced";
  if (event.appointment?.cancelled) return "Cancelled";
  if (appointmentEnd(event) <= now.getTime())
    // A time the workspace owner proposed that the employer never confirmed is not a held interview.
    return event.appointment?.proposed ? "Not confirmed" : "Completed";
  return event.appointment?.proposed ? "Proposed" : "Upcoming";
}

/** Still ahead: confirmed or only proposed by the workspace owner. */
export const isAheadAppointment = (event: RecruitingEvent, now = new Date()) =>
  ["Upcoming", "Proposed"].includes(appointmentState(event, now));
