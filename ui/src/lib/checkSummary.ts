import { z } from "zod";
import {
  mirrorsRequest,
  type RecruitingEvent,
  type RecruitingWorkflow,
} from "./recruitingTypes";
export const checkSummarySchema = z
  .object({
    newActions: z.number().int().nonnegative(),
    newUpdates: z.number().int().nonnegative(),
    newRejections: z.number().int().nonnegative(),
  })
  .strict();
export type CheckSummary = z.infer<typeof checkSummarySchema>;
export function isRecruitingUpdate(
  event: RecruitingEvent,
  events: RecruitingEvent[],
) {
  return (
    event.notify &&
    (!event.evidenceRole || event.evidenceRole === "contradiction") &&
    !mirrorsRequest(event, events) &&
    (["response", "interview", "stage", "followup", "no-response"].includes(
      event.kind,
    ) ||
      (event.kind === "requested" && event.id.includes(":activity:")))
  );
}
const TASK_ACTIVITY_ID = /^action:([^:]+):activity:/;
/**
 * Undismissed updates shown on the Dashboard (and counted in the sidebar), newest first.
 * News about a task that exists (a reminder or changed request on an action card) lives on that card
 * as "Updated", so it is left out here when the task ids are supplied.
 */
export function activeRecruitingUpdates(
  events: RecruitingEvent[],
  taskIds?: ReadonlySet<string>,
) {
  return events
    .filter(
      (e, index) =>
        e.notify &&
        !e.seen &&
        !(taskIds && taskIds.has(TASK_ACTIVITY_ID.exec(e.id)?.[1] ?? "")) &&
        (e.kind === "rejected"
          ? (e.notificationEligible ?? e.wasInProgress)
          : e.evidenceRole === "contradiction" ||
            isRecruitingUpdate(e, events)) &&
        events.findIndex((other) => other.id === e.id) === index,
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
/**
 * Count capture time, not the email's historical timestamp; old records stay unknown.
 * A rejection counts once per application: a rejection already captured before this run
 * (and not followed by a reopen) means the closure is not new, even if another
 * rejection email for it arrives now.
 */
export function summarizeCheck(
  events: RecruitingEvent[],
  startedAt: string,
  completedAt: string,
  newActions: number,
  workflows: Pick<
    RecruitingWorkflow,
    "applicationKey" | "recordId" | "reopenedAt"
  >[] = [],
): CheckSummary {
  const appKey = (e: { recordId?: string; applicationKey: string }) =>
    e.recordId ?? e.applicationKey;
  const reopenedAt = (e: RecruitingEvent) => {
    const w = workflows.find(
      (w) =>
        (e.recordId && w.recordId === e.recordId) ||
        w.applicationKey === e.applicationKey,
    );
    return w?.reopenedAt ? Date.parse(w.reopenedAt) : -Infinity;
  };
  const knownRejection = (e: RecruitingEvent) =>
    events.some(
      (prior) =>
        prior.kind === "rejected" &&
        prior.id !== e.id &&
        (appKey(prior) === appKey(e) ||
          prior.applicationKey === e.applicationKey) &&
        // Records captured before discoveredAt existed are earlier by definition.
        (!prior.discoveredAt ||
          Date.parse(prior.discoveredAt) < Date.parse(startedAt)) &&
        Date.parse(prior.at) > reopenedAt(e),
    );
  const found = [
    ...new Map(
      events
        .filter(
          (e) =>
            e.discoveredAt &&
            Date.parse(e.discoveredAt) >= Date.parse(startedAt) &&
            Date.parse(e.discoveredAt) <= Date.parse(completedAt),
        )
        .map((e) => [e.id, e]),
    ).values(),
  ];
  return {
    newActions,
    newUpdates: found.filter((e) => isRecruitingUpdate(e, events)).length,
    newRejections: new Set(
      found
        .filter((e) => e.kind === "rejected" && !knownRejection(e))
        .map(appKey),
    ).size,
  };
}
export function compactElapsed(at: string, now = new Date()) {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(at)) / 60000),
  );
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr`;
  return `${Math.floor(minutes / 1440)} d`;
}
export function compactAge(at: string, now = new Date()) {
  return `${compactElapsed(at, now)} ago · ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(at.length === 10 ? `${at}T12:00:00Z` : at))}`;
}
