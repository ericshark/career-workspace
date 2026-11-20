import { localDate, TIME_ZONE } from "./config";

/**
 * The fixed set of labels a check picks from for an open action. First match wins when
 * a request fits several (e.g. "Schedule and complete the assessment" is an assessment).
 */
export const ACTION_CATEGORIES = [
  "assessment",
  "screening",
  "schedule",
  "reply",
  "application",
  "verify",
  "sign",
  "other",
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

/** Chip text and color (a CSS color, tinted by TintBadge) for each action category. */
export const ACTION_CATEGORY_STYLE: Record<
  ActionCategory,
  { label: string; color: string }
> = {
  // Blue: tasks the employer is waiting on you for. Amber: minor, admin or catch-all items.
  assessment: { label: "Assessment", color: "var(--color-blue-600)" },
  screening: { label: "Screening", color: "var(--color-blue-600)" },
  schedule: { label: "Schedule interview", color: "var(--color-blue-600)" },
  reply: { label: "Reply requested", color: "var(--color-blue-600)" },
  application: { label: "Application", color: "var(--color-blue-600)" },
  verify: { label: "Verify account", color: "var(--color-amber-600)" },
  sign: { label: "Sign / form", color: "var(--color-amber-600)" },
  other: { label: "Other", color: "var(--color-amber-600)" },
};

/**
 * Chip for a Dashboard update, from its event kind. Green is good news or done, red is a closed
 * application, amber is a nudge. A "requested" event has no chip: its task's category already
 * shows on the Actions page, so the chip would only repeat it.
 */
export function updateChip(event: {
  kind: string;
  wasInProgress?: boolean;
}): { label: string; color: string } | null {
  switch (event.kind) {
    case "interview":
      return {
        label: "Scheduled interview",
        color: "var(--color-emerald-600)",
      };
    case "rejected":
      return {
        label: event.wasInProgress ? "Unsuccessful" : "Rejected",
        color: "var(--color-red-600)",
      };
    case "response":
    case "stage":
      return { label: "Employer reply", color: "var(--color-emerald-600)" };
    case "completed":
      return { label: "Completed", color: "var(--color-emerald-600)" };
    case "followup":
      return { label: "Follow up", color: "var(--color-amber-600)" };
    case "no-response":
      return { label: "Auto-closed", color: "var(--color-red-600)" };
    case "requested":
      return null;
    default:
      return { label: "Update", color: "var(--color-amber-600)" };
  }
}

export interface ActionDeadline {
  kind?: "requested" | "expires";
  date: string;
  at?: string;
  wording: string;
}

export interface ActionApplication {
  recordId?: string;
  rowKey: string;
  expectedNext?: string;
}

export interface InboxAction {
  id: string;
  externalKeys: string[];
  revision: number;
  text: string;
  activity?: { id: string; type?: "first-request" | "follow-up"; at: string };
  recruitingEvents?: {
    id: string;
    kind: "requested" | "completed";
    at: string;
    title: string;
    description: string;
    email?: string;
  }[];
  hidden?: boolean;
  viewedActivityId?: string;
  dismissedNewActivityId?: string;
  reportedActivityId?: string;
  pendingCheckKind?: "new" | "updated";
  pendingQuickKind?: "new" | "updated";
  contactOrganization?: string;
  location?: string;
  manuallyClosedAt?: string;
  pendingTrackerRejection?: boolean;
  applicationConfirmed?: boolean;
  roleOverride?: string;
  publicLinkOverride?: string;
  publicLink?: { url: string; kind: "job" | "careers" | "company" };

  /** Chosen by the check when the action is created; shown as a chip on open actions. */
  category?: ActionCategory;
  requestKind?:
    | "scheduling"
    | "screening"
    | "submission"
    | "preparation"
    | "administrative";
  responseExpected?: boolean;
  explanation?: string;
  priority?: "high" | "medium" | "low";
  priorityOverride?: "high" | "medium" | "low";
  priorityReason?: string;
  relationship?: "direct" | "agency" | "consulting" | "unknown";
  advancesStatus?: boolean;
  effort?: string;
  latestEmployerAt?: string;
  reviewReason?: string;
  completionSuggestion?: {
    identity: string;
    reason: string;
    messageId: string;
    url: string;
    at: string;
  };
  dismissedSuggestion?: string;
  dismissedSuggestions?: string[];
  resolvedAt?: string;
  resolution?: {
    source: "user" | "email" | "system";
    reason: string;
    evidenceMessageId?: string;
  };

  company?: string;
  role?: string;
  application?: ActionApplication;
  deadline?: ActionDeadline;
  email?: {
    threadId: string;
    messageId: string;
    url: string;
    receivedAt?: string;
  };
  state: "open" | "completed" | "superseded";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  resolvedReason?: string;
  pendingNextClear?: boolean;
  syncWarning?: string;
}

export type ActionGroupRef =
  { application: ActionApplication } | { actionId: string };

export interface ActionsPayload {
  hiddenGroups?: ActionGroupRef[];
  version: 1;
  importedNext: boolean;
  lastCheck?: {
    runId: string;
    startedAt: string;
    completedAt: string;
    changes: {
      id: string;
      activityId: string;
      kind: "new" | "updated";
      /** Already counted by a Quick check; still shown, not counted again by Daily. */
      quickReported?: boolean;
    }[];
  };
  lastQuickCheck?: {
    runId: string;
    startedAt: string;
    completedAt: string;
    summary?: import("./checkSummary").CheckSummary;
  };
  quickChanges?: { id: string; activityId: string; kind: "new" | "updated" }[];
  lastIncompleteAt?: string;
  dismissed?: { id: string; externalKeys: string[] }[];
  actions: InboxAction[];
  fileHash: string;
}

/** Date-only deadlines expire at the end of the New York calendar date, not the 03:00 application boundary. */
export function isActionOverdue(
  action: InboxAction,
  now = new Date(),
): boolean {
  const due = action.deadline;
  return (
    !!due &&
    (due.at ? Date.parse(due.at) < now.getTime() : due.date < localDate(now))
  );
}

export function deadlineLabel(due: ActionDeadline): string {
  if (due.at)
    return new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(due.at));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${due.date}T12:00:00Z`));
}

export function sortOpenActions(actions: InboxAction[]): InboxAction[] {
  return actions
    .filter((a) => a.state === "open")
    .sort((a, b) => {
      if (!a.deadline && b.deadline) return 1;
      if (a.deadline && !b.deadline) return -1;
      const dates = (a.deadline?.date ?? "").localeCompare(
        b.deadline?.date ?? "",
      );
      const time =
        (a.deadline?.at ? Date.parse(a.deadline.at) : Infinity) -
        (b.deadline?.at ? Date.parse(b.deadline.at) : Infinity);
      return (
        dates ||
        (Number.isNaN(time) ? 0 : time) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      );
    });
}

/** Legacy tracker imports have only an added date; never label that as the email receipt time. */
export function actionReceivedLabel(action: InboxAction): string {
  const received = action.email?.receivedAt;
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(received ?? action.createdAt));
  return `${received ? "Received" : "Added"} ${date}`;
}

export const actionActivityId = (a: InboxAction) =>
  a.activity?.id ?? a.email?.messageId ?? a.id;
export const isUnreadAction = (a: InboxAction) =>
  a.state === "open" && a.viewedActivityId !== actionActivityId(a);

export const latestCheckChange = (
  a: InboxAction,
  data: ActionsPayload | null,
) =>
  [...(data?.quickChanges ?? []), ...(data?.lastCheck?.changes ?? [])].find(
    (c) => c.id === a.id && c.activityId === actionActivityId(a),
  );

export function hasNewActionMarker(
  a: InboxAction,
  data: ActionsPayload | null,
) {
  if (a.state !== "open" || a.dismissedNewActivityId === actionActivityId(a))
    return false;
  if (latestCheckChange(a, data)) return true;
  if (!a.externalKeys.some((key) => key.startsWith("manual:"))) return false;
  const lastStart = Math.max(
    data?.lastCheck ? Date.parse(data.lastCheck.startedAt) : 0,
    data?.lastQuickCheck ? Date.parse(data.lastQuickCheck.startedAt) : 0,
  );
  return Date.parse(a.activity?.at ?? a.createdAt) > lastStart;
}

export const needsActionConfirmation = (a: InboxAction) =>
  a.state === "open" &&
  !!(a.completionSuggestion || a.reviewReason || !a.application);

/** Email chronology stays stable when tasks are completed in a different order. */
export function compareReceivedNewest(a: InboxAction, b: InboxAction): number {
  return (
    Date.parse(b.email?.receivedAt ?? b.createdAt) -
      Date.parse(a.email?.receivedAt ?? a.createdAt) || a.id.localeCompare(b.id)
  );
}
