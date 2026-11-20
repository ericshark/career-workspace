import { isClosedStatus, isRejectedStatus } from "./status";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveExpected } from "./paths";
import { localDate } from "./config";
import { ConflictError, sha256, withFileLock } from "./fileStore";
import { summarizeCheck } from "./checkSummary";
import {
  applicationFor,
  appointmentEnd,
  currentAppointments,
  daysWaiting,
  followUpDue,
  latestAppointmentEvidence,
} from "./recruitingTypes";
import type {
  RecruitingEvent,
  RecruitingPayload,
  RecruitingView,
  RecruitingWorkflow,
} from "./recruitingTypes";
import type { ApplicationRow } from "./types";
export type { RecruitingEvent } from "./recruitingTypes";
const instant = z.iso.datetime({ offset: true });
const email = z
  .url()
  .refine(
    (v) =>
      new URL(v).protocol === "https:" &&
      new URL(v).hostname === "mail.google.com",
    "Expected Gmail URL",
  );
export const recruitingEventSchema = z
  .object({
    id: z.string().min(1),
    applicationKey: z.string().min(1),
    recordId: z.string().optional(),
    kind: z.enum([
      "submitted",
      "requested",
      "completed",
      "response",
      "interview",
      "stage",
      "followup",
      "rejected",
      "no-response",
    ]),
    at: z.union([instant, z.iso.date()]),
    title: z.string().min(1).max(2000),
    description: z.string().max(10000).default(""),
    email: email.optional(),
    notify: z.boolean().default(true),
    seen: z.boolean().default(false),
    viewedAt: instant.optional(),
    discoveredAt: instant.optional(),
    wasInProgress: z.boolean().optional(),
    responseExpected: z.boolean().optional(),
    responseDue: instant.optional(),
    scheduledAt: z.union([instant, z.iso.date()]).optional(),
    scheduledEndAt: instant.optional(),
    taskId: z.string().optional(),
    evidenceRole: z.enum(["sent", "receipt", "contradiction"]).optional(),
    closureSource: z.enum(["user", "email", "system"]).optional(),
    notificationEligible: z.boolean().optional(),
    appointment: z
      .object({
        id: z.string().min(1),
        actionId: z.string().min(1).optional(),
        sequence: z.number().int().nonnegative().optional(),
        cancelled: z.boolean().optional(),
        dismissed: z.boolean().optional(),
        // the workspace owner's own Sent reply proposed or accepted this time; the employer has not confirmed it.
        proposed: z.boolean().optional(),
        // Set by the service when a confirmation under another id answers this proposal.
        replacedBy: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    stage: z.string().optional(),
  })
  .strict();
const workflow = z
  .object({
    applicationKey: z.string(),
    recordId: z.string().optional(),
    status: z.string(),
    observedAt: instant,
    statusAt: instant,
    statusHistory: z
      .array(z.object({ status: z.string(), at: instant }).strict())
      .optional(),
    reopenedAt: instant.optional(),
    waitingSince: instant.optional(),
    responseDue: instant.optional(),
    scheduledAt: z.union([instant, z.iso.date()]).optional(),
    scheduledUntil: instant.optional(),
    stage: z.string().optional(),
    closedAt: instant.optional(),
    closure: z.enum(["rejected", "no-response"]).optional(),
  })
  .strict();
const pending = z
  .object({
    id: z.string().min(1),
    company: z.string().optional(),
    role: z.string().optional(),
    summary: z.string().min(1),
    reason: z.string().min(1),
    email,
    receivedAt: instant,
    event: recruitingEventSchema
      .omit({
        applicationKey: true,
        recordId: true,
        seen: true,
        wasInProgress: true,
      })
      .optional(),
    action: z.record(z.string(), z.unknown()).optional(),
    suggestedApplication: z
      .object({
        rowKey: z.string().min(1),
        recordId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    matchIssue: z
      .enum(["not-in-tracker", "several-candidates", "role-differs", "no-role"])
      .optional(),
    resolvedKey: z.string().optional(),
    processed: z.boolean().optional(),
    dismissedAt: instant.optional(),
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    startedAt: instant,
    events: z.array(recruitingEventSchema),
    workflows: z.array(workflow),
    pending: z.array(pending),
  })
  .strict();
type Doc = z.infer<typeof schema>;
const file = () => resolveExpected("records/recruiting.json");
// Missing reads are pure. The first write establishes the prospective capture boundary.
const empty = () => ({
  version: 1 as const,
  startedAt: new Date().toISOString(),
  events: [],
  workflows: [],
  pending: [],
});
export function readRecruiting(): RecruitingPayload {
  const raw = fs.existsSync(file()) ? fs.readFileSync(file(), "utf8") : "";
  return {
    ...schema.parse(raw ? JSON.parse(raw) : empty()),
    fileHash: sha256(raw),
  };
}
async function mutate(hash: string, fn: (doc: Doc) => void) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  await withFileLock(
    file(),
    hash,
    (raw) => {
      const d = schema.parse(raw ? JSON.parse(raw) : empty());
      fn(d);
      return JSON.stringify(schema.parse(d), null, 2) + "\n";
    },
    { initialText: "", lockPath: resolveExpected("ui/.cache/recruiting.lock") },
  );
  return readRecruiting();
}
async function fresh(fn: (doc: Doc) => void) {
  for (let n = 0; ; n++) {
    try {
      return await mutate(readRecruiting().fileHash, fn);
    } catch (e) {
      if (!(e instanceof ConflictError) || n >= 3) throw e;
    }
  }
}
/** Points recruiting history at an application's new row key after it was edited. */
export async function rekeyRecruitingReferences(
  oldKey: string,
  newKey: string,
  recordId: string,
) {
  if (!fs.existsSync(file())) return;
  const stale = (x: { applicationKey: string; recordId?: string }) =>
    x.applicationKey === oldKey && (!x.recordId || x.recordId === recordId);
  const current = readRecruiting();
  if (
    !current.events.some(stale) &&
    !current.workflows.some(stale) &&
    !current.pending.some(
      (p) =>
        p.resolvedKey === oldKey || p.suggestedApplication?.rowKey === oldKey,
    )
  )
    return;
  await fresh((d) => {
    for (const item of [...d.events, ...d.workflows]) {
      if (!stale(item)) continue;
      item.applicationKey = newKey;
      item.recordId = recordId;
    }
    for (const p of d.pending) {
      if (p.resolvedKey === oldKey) p.resolvedKey = newKey;
      if (p.suggestedApplication?.rowKey === oldKey)
        p.suggestedApplication = { rowKey: newKey, recordId };
    }
  });
}

/**
 * Drops the timeline events a task produced (its request, follow-ups, completions) when its action
 * history is deleted. Application-level events (rejection, interview, response) stay.
 */
export async function removeTaskEvents(
  taskIds: string[],
  externalKeys: string[],
) {
  const own = (id: string) =>
    externalKeys.some((key) => id === `request:${key}`) ||
    taskIds.some((task) => id.startsWith(`action:${task}:`));
  return fresh((d) => {
    d.events = d.events.filter(
      (e) => !own(e.id) && !taskIds.includes(e.taskId ?? ""),
    );
  });
}
/**
 * A confirmation may arrive under a different appointment id than the workspace owner's proposal (for example a
 * calendar UID). Replace the proposal when the match is unambiguous: the same scheduling task, or
 * the only open proposal for the application. With several candidates, keep them all and say so.
 */
function replaceAnsweredProposal(d: Doc, e: RecruitingEvent): RecruitingEvent {
  const app = (x: RecruitingEvent) => x.recordId ?? x.applicationKey;
  const actionId = e.appointment!.actionId;
  const open = latestAppointmentEvidence(
    d.events.filter(
      (p) =>
        app(p) === app(e) &&
        p.appointment &&
        p.appointment.id !== e.appointment!.id,
    ),
  ).filter(
    (p) =>
      p.appointment?.proposed &&
      !p.appointment.cancelled &&
      !p.appointment.replacedBy &&
      // A proposal for a different scheduling task is a different interview.
      !(
        actionId &&
        p.appointment.actionId &&
        p.appointment.actionId !== actionId
      ),
  );
  const sameTask = actionId
    ? open.filter((p) => p.appointment?.actionId === actionId)
    : [];
  const candidates = sameTask.length ? sameTask : open;
  if (candidates.length > 1)
    return {
      ...e,
      description:
        `${e.description} Several proposed times were open for this application; check which one this confirms.`.trim(),
    };
  const proposal = candidates[0];
  if (!proposal) return e;
  for (const revision of d.events)
    if (
      app(revision) === app(e) &&
      revision.appointment?.id === proposal.appointment!.id
    ) {
      revision.appointment.replacedBy = e.appointment!.id;
      revision.seen = true;
    }
  return {
    ...e,
    appointment: {
      ...e.appointment!,
      actionId: actionId ?? proposal.appointment!.actionId,
    },
  };
}
function insert(d: Doc, e: RecruitingEvent, previousStatus?: string) {
  if (e.appointment) {
    const linked = d.events.find(
      (prior) =>
        prior.appointment?.id === e.appointment?.id &&
        prior.appointment?.actionId &&
        (prior.recordId ?? prior.applicationKey) ===
          (e.recordId ?? e.applicationKey),
    )?.appointment?.actionId;
    if (linked && e.appointment.actionId && linked !== e.appointment.actionId)
      throw new ConflictError(
        "Appointment is already linked to a different task",
      );
    if (linked)
      e = { ...e, appointment: { ...e.appointment, actionId: linked } };
  }
  const old = d.events.find((x) => x.id === e.id);
  if (old) {
    if (
      (old.applicationKey !== e.applicationKey &&
        (!old.recordId || old.recordId !== e.recordId)) ||
      old.kind !== e.kind ||
      Date.parse(old.at) !== Date.parse(e.at)
    )
      throw new ConflictError("Event identity conflicts with saved provenance");
    if (e.kind === "interview" && (e.scheduledAt || e.appointment)) {
      if (
        (old.email && e.email !== old.email) ||
        (old.appointment && e.appointment?.id !== old.appointment.id) ||
        (old.appointment?.actionId &&
          e.appointment?.actionId !== old.appointment.actionId)
      )
        throw new ConflictError(
          "Appointment evidence conflicts with saved provenance",
        );
      const changed =
        (old.scheduledAt ? Date.parse(old.scheduledAt) : null) !==
          (e.scheduledAt ? Date.parse(e.scheduledAt) : null) ||
        !!old.appointment?.cancelled !== !!e.appointment?.cancelled ||
        !!old.appointment?.proposed !== !!e.appointment?.proposed;
      Object.assign(old, {
        scheduledAt: e.scheduledAt,
        scheduledEndAt: e.scheduledEndAt,
        appointment: e.appointment,
        title: e.title,
        description: e.description,
        ...(changed
          ? {
              seen: false,
              viewedAt: undefined,
              discoveredAt: new Date().toISOString(),
            }
          : {}),
      });
    }
    return;
  }
  // the workspace owner's own proposal is not employer news; the confirmation that follows is.
  let notify = e.notify && !e.appointment?.proposed;
  if (e.appointment) {
    const previous = latestAppointmentEvidence(
      d.events.filter(
        (prior) =>
          (prior.recordId ?? prior.applicationKey) ===
            (e.recordId ?? e.applicationKey) &&
          prior.appointment?.id === e.appointment?.id,
      ),
    )[0];
    if (previous) {
      // A proposal never replaces an employer-confirmed (or cancelled) appointment.
      if (e.appointment.proposed && !previous.appointment?.proposed) return;
      const confirmsProposal =
        !!previous.appointment?.proposed && !e.appointment.proposed;
      const isLatest = latestAppointmentEvidence([previous, e])[0] === e;
      const sameTime =
        (previous.scheduledAt ? Date.parse(previous.scheduledAt) : null) ===
        (e.scheduledAt ? Date.parse(e.scheduledAt) : null);
      if (
        previous.scheduledEndAt === e.scheduledEndAt &&
        !!previous.appointment?.cancelled === !!e.appointment.cancelled &&
        sameTime &&
        !confirmsProposal &&
        !!previous.appointment?.proposed === !!e.appointment.proposed &&
        (previous.appointment?.sequence ?? 0) === (e.appointment.sequence ?? 0)
      )
        return;
      notify &&=
        isLatest &&
        (!sameTime ||
          confirmsProposal ||
          !!previous.appointment?.cancelled !== !!e.appointment.cancelled ||
          previous.scheduledEndAt !== e.scheduledEndAt);
      if (previous.appointment?.dismissed) e.appointment.dismissed = true;
      if (notify) {
        for (const prior of d.events) {
          if (
            (prior.recordId ?? prior.applicationKey) ===
              (e.recordId ?? e.applicationKey) &&
            prior.appointment?.id === e.appointment.id
          )
            prior.seen = true;
        }
      }
    } else if (!e.appointment.proposed && !e.appointment.cancelled)
      e = replaceAnsweredProposal(d, e);
  }
  // Preserve the status observed before closure, even after the tracker changes
  // to Rejected or an overlapping check replays the same email.
  d.events.push({
    ...e,
    notify,
    wasInProgress:
      e.kind === "rejected" ? previousStatus === "in progress" : undefined,
    discoveredAt: new Date().toISOString(),
  });
}
export async function editRecruiting(
  hash: string,
  incoming: unknown[],
  seen: string[] = [],
  viewed: string[] = [],
  dismissed: string[] = [],
  dismissedAppointments: string[] = [],
) {
  const events = z.array(recruitingEventSchema).parse(incoming);
  const { readApplications } = await import("./applications");
  const rows = (await readApplications()).rows;
  for (const e of events) {
    if (!applicationFor(e, rows))
      throw new ConflictError("No unique application for event");
    if (Date.parse(e.at) > Date.now())
      throw new Error("Activity cannot occur in the future");
  }
  return mutate(hash, (d) => {
    events.forEach((e) => insert(d, e, applicationFor(e, rows)?.status));
    for (const id of dismissed) {
      const p = d.pending.find((p) => p.id === id);
      // A confirmed match with nothing to replay is only waiting for the next check, so it can go.
      if (!p || (p.resolvedKey && (p.action || p.event)))
        throw new Error("Request changed; refresh before dismissing");
      p.processed = true;
      p.dismissedAt = new Date().toISOString();
    }
    for (const id of dismissedAppointments) {
      const e = d.events.find((e) => e.id === id && e.appointment);
      if (!e?.appointment)
        throw new ConflictError(
          "Appointment changed; refresh before dismissing",
        );
      for (const revision of d.events.filter(
        (p) =>
          p.applicationKey === e.applicationKey &&
          p.appointment?.id === e.appointment?.id,
      ))
        revision.appointment!.dismissed = true;
    }
    for (const id of viewed) {
      const e = d.events.find((x) => x.id === id);
      if (!e) throw new Error("Unknown recruiting update");
      e.viewedAt ??= new Date().toISOString();
    }
    for (const id of seen) {
      const e = d.events.find((x) => x.id === id);
      if (!e) throw new Error("Unknown recruiting update");
      e.seen = true;
    }
  });
}
export const recruitingBatchSchema = z
  .object({
    fileHash: z.string(),
    events: z.array(recruitingEventSchema).default([]),
    pending: z
      .array(
        pending.omit({ resolvedKey: true, processed: true, dismissedAt: true }),
      )
      .default([]),
  })
  .strict();
type RecruitingBatch = z.infer<typeof recruitingBatchSchema>;

async function validateRecruitingBatch(
  b: RecruitingBatch,
  rows: ApplicationRow[],
  actions: import("./actionTypes").InboxAction[],
) {
  for (const e of b.events) {
    const retained = actions.filter(
      (a) =>
        a.application &&
        applicationFor(a.application, rows)?.key ===
          applicationFor(e, rows)?.key,
    );
    const closed = readRecruiting().workflows.some(
      (w) =>
        applicationFor(w, rows)?.key === applicationFor(e, rows)?.key &&
        w.closure,
    );
    if (
      closed ||
      (retained.length > 0 &&
        retained.every(
          (a) =>
            a.manuallyClosedAt ||
            (a.state === "superseded" && a.resolution?.source === "user"),
        ))
    )
      e.notify = false;

    if (e.kind === "rejected") {
      e.closureSource = "email";
      const linked = actions.filter(
        (a) =>
          a.application &&
          applicationFor(a.application, rows)?.key ===
            applicationFor(e, rows)?.key,
      );
      const alreadyClosed = readRecruiting().workflows.some(
        (w) =>
          applicationFor(w, rows)?.key === applicationFor(e, rows)?.key &&
          w.closure,
      );
      e.notificationEligible =
        !alreadyClosed &&
        linked.some((a) => a.state !== "superseded" && !a.manuallyClosedAt);
      e.notify = e.notify && e.notificationEligible;
    }
    if (e.evidenceRole && e.evidenceRole !== "contradiction") e.notify = false;
    if (
      e.scheduledEndAt &&
      (!e.scheduledAt ||
        Date.parse(e.scheduledEndAt) <= Date.parse(e.scheduledAt))
    )
      throw new ConflictError("Appointment end must follow its start");
    if (
      e.taskId &&
      !actions.some(
        (a) =>
          a.id === e.taskId &&
          a.application &&
          applicationFor(a.application, rows)?.key ===
            applicationFor(e, rows)?.key,
      )
    )
      throw new ConflictError(
        "Evidence must link to a task on the same application",
      );
    if (
      e.appointment &&
      (e.kind !== "interview" ||
        (e.appointment.cancelled ? !!e.scheduledAt : !e.scheduledAt))
    )
      throw new ConflictError(
        "Appointment evidence requires an interview time or explicit cancellation",
      );
    if (e.appointment?.actionId) {
      const action = actions.find((a) => a.id === e.appointment?.actionId);
      if (
        !action?.application ||
        applicationFor(action.application, rows)?.key !==
          applicationFor(e, rows)?.key
      )
        throw new ConflictError(
          "Appointment must link to a task on the same application",
        );
    }
    if (!applicationFor(e, rows) || Date.parse(e.at) > Date.now())
      throw new ConflictError(
        "Verify application and event time before publishing",
      );
  }
  for (const p of b.pending) {
    if (p.action) {
      const { actionSyncSchema } = await import("./actions");
      actionSyncSchema.parse({
        fileHash: "0".repeat(64),
        complete: false,
        actions: [p.action],
      });
    }
    if (
      Date.parse(p.receivedAt) > Date.now() ||
      (p.event && Date.parse(p.event.at) > Date.now())
    )
      throw new Error("Future mail evidence");
  }
}

function mergeRecruitingBatch(
  d: Doc,
  b: RecruitingBatch,
  rows: ApplicationRow[],
) {
  b.events.forEach((e) => insert(d, e, applicationFor(e, rows)?.status));
  for (const p of b.pending) {
    const old = d.pending.find((x) => x.id === p.id);
    if (!old) d.pending.push(p);
    else if (
      old.email !== p.email ||
      Date.parse(old.receivedAt) !== Date.parse(p.receivedAt)
    )
      throw new ConflictError("Pending mail provenance changed");
    else if (!old.processed)
      Object.assign(old, p, { receivedAt: old.receivedAt });
  }
}

export async function syncRecruiting(input: unknown) {
  const b = recruitingBatchSchema.parse(input);
  const { readApplications } = await import("./applications");
  const { rows } = await readApplications();
  const { readActions } = await import("./actions");
  await validateRecruitingBatch(b, rows, readActions().actions);
  await mutate(b.fileHash, (d) => mergeRecruitingBatch(d, b, rows));
  return reconcileRecruiting();
}

export async function previewRecruiting(input: unknown, now = new Date()) {
  const { actionPreviewSnapshotSchema, readActions } =
    await import("./actions");
  const { readApplications } = await import("./applications");
  const { readMailSync } = await import("./mailSync");
  const b = recruitingBatchSchema
    .safeExtend({
      actionSnapshot: actionPreviewSnapshotSchema.optional(),
    })
    .parse(input);
  const { fileHash, ...doc } = readRecruiting();
  const savedActions = readActions();
  if (
    b.fileHash !== fileHash ||
    (b.actionSnapshot && b.actionSnapshot.fileHash !== savedActions.fileHash)
  )
    throw new ConflictError("Preview state changed; re-read before previewing");
  const { rows } = await readApplications();
  await validateRecruitingBatch(
    b,
    rows,
    (b.actionSnapshot ?? savedActions).actions,
  );
  const { events: before } = structuredClone(doc);
  // Projected events are stamped discoveredAt = now, so counting from here gives the Dry Run report.
  const previewStart = new Date().toISOString();
  mergeRecruitingBatch(doc, b, rows);
  projectRecruiting(
    doc,
    rows,
    (b.actionSnapshot ?? savedActions).actions,
    readMailSync().interactions,
    now,
  );
  const previous = new Map(before.map((event) => [event.id, event]));
  const savedIds = new Set(savedActions.actions.map((a) => a.id));
  const newActions = (b.actionSnapshot?.actions ?? []).filter(
    (a) => a.pendingCheckKind === "new" && !savedIds.has(a.id),
  ).length;
  return {
    fileHash,
    preview: true,
    /** Counts the Dry Run reports, using the same rules as a saved Daily summary. */
    summary: summarizeCheck(
      doc.events,
      previewStart,
      new Date().toISOString(),
      newActions,
      doc.workflows,
    ),
    events: doc.events.filter(
      (event) =>
        JSON.stringify(event) !== JSON.stringify(previous.get(event.id)),
    ),
    pending: doc.pending.filter((p) => !p.processed),
  };
}

export async function resolveRecruiting(input: unknown) {
  const b = z
    .object({
      fileHash: z.string(),
      id: z.string(),
      applicationKey: z.string(),
      applicationsHash: z.string(),
      lineIndex: z.number().int().optional(),
    })
    .strict()
    .parse(input);
  const { readApplications } = await import("./applications");
  const apps = await readApplications();
  if (apps.fileHash !== b.applicationsHash)
    throw new ConflictError("Applications changed; refresh before linking");
  const matches = apps.rows.filter(
    (r) =>
      r.key === b.applicationKey &&
      (b.lineIndex === undefined || r.lineIndex === b.lineIndex),
  );
  if (
    matches.length !== 1 ||
    apps.rows.filter((r) => r.key === b.applicationKey).length !== 1
  )
    throw new ConflictError("Application identity is ambiguous");
  await mutate(b.fileHash, (d) => {
    const p = d.pending.find((x) => x.id === b.id);
    if (!p) throw new Error("Pending email not found");
    if (p.dismissedAt) throw new ConflictError("Request was dismissed");
    if (p.resolvedKey && p.resolvedKey !== b.applicationKey)
      throw new ConflictError("Email already linked");
    p.resolvedKey = b.applicationKey;
  });
  return resumePending(b.id);
}
/**
 * Replay confirmed matches. Write paths call this with `id` and need failures surfaced. The polled
 * view passes `onItemError` instead, so one unresolvable item is reported as a warning rather than
 * failing every request that reads recruiting data.
 */
async function resumePending(
  id?: string,
  onItemError?: (message: string) => void,
) {
  const { readApplications, updateRow } = await import("./applications");
  const { syncActions, readActions } = await import("./actions");
  const replayed: Doc["pending"] = [];
  for (const p of readRecruiting().pending.filter(
    (x) => x.resolvedKey && !x.processed && (id === undefined || x.id === id),
  )) {
    try {
      if (!p.action && !p.event) continue; // Identity confirmation alone cannot resolve an unclassified email.
      const apps = await readApplications();
      const row = applicationFor({ applicationKey: p.resolvedKey }, apps.rows);
      if (p.action && row && isClosedStatus(row.status))
        throw new ConflictError(
          "Reopen the application in Tracker before restoring actions",
        );
      if (!row)
        throw new ConflictError(
          "Confirmed application no longer uniquely exists",
        );
      if (p.action)
        await syncActions({
          fileHash: readActions().fileHash,
          complete: false,
          requireMatch: true,
          actions: [
            {
              ...p.action,
              company: row.company,
              role: row.role,
              application: {
                rowKey: row.key,
                ...(row.recordId ? { recordId: row.recordId } : {}),
              },
            },
          ],
        });
      if (p.event) {
        await fresh((d) =>
          insert(
            d,
            {
              ...p.event!,
              applicationKey: row.key,
              recordId: row.recordId,
              seen: false,
            },
            row.status,
          ),
        );
      }
      // Use one guarded transition when the same discovery carries a request and
      // closure. A retry after the action or event write uses the same identities.
      const status =
        p.event?.kind === "rejected"
          ? !isRejectedStatus(row.status) && row.status !== "to apply"
            ? "rejected"
            : undefined
          : p.action &&
              p.action.advancesStatus !== false &&
              ["applied", "no response"].includes(row.status)
            ? "in progress"
            : undefined;
      if (status)
        await updateRow(
          apps.fileHash,
          row.key,
          { status },
          localDate(new Date()),
        );
      replayed.push(p);
    } catch (e) {
      if (!onItemError) throw e;
      onItemError(e instanceof Error ? e.message : String(e));
    }
  }
  const view = await reconcileRecruiting();
  if (!replayed.length) return view;
  // A failed projection leaves the confirmed evidence available for replay.
  const saved = await fresh((d) => {
    for (const p of replayed) {
      const item = d.pending.find((x) => x.id === p.id);
      if (
        item &&
        item.resolvedKey === p.resolvedKey &&
        JSON.stringify(item.action) === JSON.stringify(p.action) &&
        JSON.stringify(item.event) === JSON.stringify(p.event)
      )
        item.processed = true;
    }
  });
  return { ...view, ...saved };
}
export async function linkHistoricalAction(input: unknown) {
  const b = z
    .object({
      id: z.string(),
      revision: z.number().int(),
      applicationKey: z.string(),
      applicationsHash: z.string(),
    })
    .strict()
    .parse(input);
  const { readApplications } = await import("./applications");
  const apps = await readApplications();
  if (apps.fileHash !== b.applicationsHash)
    throw new ConflictError("Applications changed");
  const row = applicationFor({ applicationKey: b.applicationKey }, apps.rows);
  if (!row) throw new ConflictError("Select one unique application");
  const { associateAction } = await import("./actions");
  await associateAction(b.id, b.revision, {
    rowKey: row.key,
    ...(row.recordId ? { recordId: row.recordId } : {}),
  });
  return reconcileRecruiting();
}
export async function editOpenAction(input: unknown) {
  const b = z
    .object({
      id: z.string().min(1),
      revision: z.number().int().positive(),
      applicationKey: z.string(),
      applicationsHash: z.string(),
      roleOverride: z.string().trim().max(2000).optional(),
      publicLinkOverride: z.url({ protocol: /^https?$/ }).optional(),
    })
    .strict()
    .parse(input);
  const { readApplications } = await import("./applications");
  const { correctOpenAction } = await import("./actions");
  const apps = await readApplications();
  if (apps.fileHash !== b.applicationsHash)
    throw new ConflictError("Applications changed; refresh before editing");
  const row = applicationFor({ applicationKey: b.applicationKey }, apps.rows);
  if (
    !row ||
    (row.recordId &&
      !applicationFor(
        { applicationKey: row.key, recordId: row.recordId },
        apps.rows,
      ))
  )
    throw new ConflictError("Select one unique application");
  if (
    isClosedStatus(row.status) ||
    readRecruiting().workflows.some(
      (w) => w.closure && applicationFor(w, apps.rows)?.key === row.key,
    )
  )
    throw new ConflictError("Choose an application with an open workflow");
  await correctOpenAction(
    b.id,
    b.revision,
    row,
    apps.fileHash,
    b.roleOverride || undefined,
    b.publicLinkOverride,
  );
  return reconcileRecruiting();
}

function latest(values: (string | undefined)[]) {
  return values
    .filter((x): x is string => !!x)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
export function expectsResponse(text: string) {
  return (
    /assessment|questionnaire|recruiter|additional information|take.home|technical test|interview|screen/i.test(
      text,
    ) && !/schedul|choose.*time|arrange|prepare|verify.*account/i.test(text)
  );
}
export function waitingEligible(
  w: RecruitingWorkflow,
  open: number,
  now: Date,
) {
  return (
    !open &&
    !w.closure &&
    !!w.waitingSince &&
    (!w.scheduledAt ||
      Date.parse(w.scheduledUntil ?? w.scheduledAt) <= now.getTime()) &&
    (!w.responseDue || Date.parse(w.responseDue) <= now.getTime())
  );
}
function projectRecruiting(
  d: Doc,
  rows: ApplicationRow[],
  tasks: import("./actionTypes").InboxAction[],
  interactions: Record<string, string>,
  now: Date,
) {
  // The action owns these event IDs. Reproject them after an explicit correction
  // while retaining their original timestamps and notification state.
  for (const task of tasks) {
    if (!task.applicationConfirmed || !task.application) continue;
    const row = applicationFor(task.application, rows);
    if (!row) continue;
    for (const captured of task.recruitingEvents ?? []) {
      const event = d.events.find((e) => e.id === captured.id);
      if (
        event &&
        event.kind === captured.kind &&
        Date.parse(event.at) === Date.parse(captured.at)
      ) {
        event.applicationKey = row.key;
        event.recordId = row.recordId;
      }
    }
  }
  for (const row of rows) {
    if (
      !applicationFor({ applicationKey: row.key, recordId: row.recordId }, rows)
    )
      continue;
    let w = d.workflows.find((x) => applicationFor(x, rows)?.key === row.key);
    const linked = tasks.filter(
      (a) =>
        a.application && applicationFor(a.application, rows)?.key === row.key,
    );
    if (!w) {
      w = {
        applicationKey: row.key,
        recordId: row.recordId,
        status: row.status,
        observedAt: now.toISOString(),
        statusAt: now.toISOString(),
      };
      d.workflows.push(w);
    }
    w.applicationKey = row.key;
    w.recordId = row.recordId;
    const previousStatus = w.status;
    if (w.status !== row.status) {
      if (isClosedStatus(w.status) && !isClosedStatus(row.status))
        w.reopenedAt = now.toISOString();
      // Retain a known pre-upgrade transition, but never count the initial observation.
      w.statusHistory ??=
        w.statusAt !== w.observedAt
          ? [{ status: w.status, at: w.statusAt }]
          : [];
      w.statusHistory.push({ status: row.status, at: now.toISOString() });
      w.statusAt = now.toISOString();
      w.status = row.status;
    }
    // Capture only prospective task events; existing completions seed waiting without invented history.
    for (const a of linked) {
      for (const captured of a.recruitingEvents ?? [])
        insert(d, {
          ...captured,
          applicationKey: row.key,
          recordId: row.recordId,
          // Only a changed request on an existing task can be news; the original request
          // (request:<key>) is never an Update, it is the task itself.
          notify: captured.id.includes(":activity:"),
          seen: false,
        });
    }
    const events = d.events
      .filter(
        (e) =>
          applicationFor(e, rows)?.key === row.key &&
          !e.id.startsWith("waiting:"),
      )
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const last = events.at(-1);
    const expectation = events
      .filter((e) => e.responseExpected !== undefined)
      .at(-1);
    const lastCompletion = linked
      .filter((a) => a.state === "completed")
      .sort(
        (a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!),
      )[0];
    // Completion clicks are observations, not newer employer evidence. Scheduling alone
    // does not imply that the employer owes a reply before the interview happens.
    const substantive = linked.filter(
      (a) =>
        a.state === "completed" &&
        a.responseExpected !== false &&
        (a.requestKind
          ? ["screening", "submission"].includes(a.requestKind)
          : !/schedul|book|choose.*time|verify.*account/i.test(a.text)),
    );
    const completed = substantive.sort(
      (a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!),
    )[0];
    const responseExpected = expectation?.responseExpected ?? !!completed;
    const timing = events
      .filter((e) => e.responseDue || e.responseExpected === false)
      .at(-1);
    w.responseDue = timing?.responseDue;
    const appointments = currentAppointments(events);
    const upcoming = appointments
      .filter((e) => appointmentEnd(e) > now.getTime())
      .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
    // An unconfirmed proposal whose time passed is not an interview that happened.
    const ended = appointments
      .filter(
        (e) => appointmentEnd(e) <= now.getTime() && !e.appointment?.proposed,
      )
      .map((e) => new Date(appointmentEnd(e)).toISOString());
    w.scheduledAt = upcoming[0]?.scheduledAt;
    w.scheduledUntil = upcoming[0]
      ? new Date(appointmentEnd(upcoming[0])).toISOString()
      : undefined;
    if (responseExpected || ended.length) {
      const evidenceAt = latest([
        expectation?.at,
        interactions[row.key],
        interactions[row.recordId ?? ""],
        ...ended,
        ...events
          .filter((e) => ["response", "stage", "followup"].includes(e.kind))
          .map((e) => e.at),
      ]);
      // The first completion is the fallback only; reopen/recomplete must not reset it.
      w.waitingSince =
        evidenceAt ??
        completed?.recruitingEvents?.find((e) => e.kind === "completed")?.at ??
        completed?.completedAt;
      if (
        w.responseDue &&
        w.waitingSince &&
        Date.parse(w.responseDue) > Date.parse(w.waitingSince)
      )
        w.waitingSince = w.responseDue;
    } else delete w.waitingSince;
    w.stage =
      events.filter((e) => e.stage).at(-1)?.stage ?? completed?.text ?? w.stage;
    const confirmedRejection = events
      .filter(
        (e) =>
          e.kind === "rejected" &&
          (!w!.reopenedAt || Date.parse(e.at) > Date.parse(w!.reopenedAt)),
      )
      .at(-1);
    const followed =
      linked.some((a) => a.state !== "superseded" && !a.manuallyClosedAt) ||
      appointments.length > 0;
    const closure = confirmedRejection
      ? "rejected"
      : isRejectedStatus(row.status)
        ? "rejected"
        : row.status === "no response"
          ? "no-response"
          : undefined;
    // the workspace owner closed the application himself (Actions → Close): that is his own decision, so it is
    // recorded in the timeline as "Closed by you" and never raised as a Dashboard Update.
    const closedByUser =
      !confirmedRejection && linked.some((a) => a.manuallyClosedAt);
    if (closure) {
      if (w.closure !== closure) {
        w.closure = closure;
        w.closedAt =
          events.filter((e) => e.kind === closure).at(-1)?.at ??
          now.toISOString();
        if (
          ((closure === "rejected" && previousStatus === "in progress") ||
            linked.length ||
            events.some(
              (e) => e.kind !== "rejected" && e.kind !== "no-response",
            )) &&
          !events.some((e) => e.kind === closure)
        )
          insert(
            d,
            {
              id: `closure:${row.key}:${closure}:${w.statusAt}`,
              applicationKey: row.key,
              recordId: row.recordId,
              kind: closure,
              at: w.closedAt,
              title: closedByUser
                ? "Closed by you"
                : closure === "rejected"
                  ? previousStatus === "in progress" ||
                    row.status === "unsuccessful"
                    ? "Unsuccessful"
                    : "Rejected"
                  : "Closed — No response",
              description: `${linked.filter((a) => a.state === "completed").length} completed actions${w.stage ? ` · Last stage: ${w.stage}` : ""}`,
              closureSource: closedByUser ? "user" : "system",
              notificationEligible: followed && !closedByUser,
              notify: followed && !closedByUser,
              seen: closedByUser,
            },
            previousStatus,
          );
      }
    } else {
      delete w.closure;
      delete w.closedAt;
    }
    const waitingDays = w.waitingSince ? daysWaiting(w.waitingSince, now) : 0;
    const milestone = waitingDays >= 18 ? 18 : 10;
    const waitingId = `waiting:${row.key}:${milestone}:${w.waitingSince}`;
    const reviewPending = events.some(
      (e) =>
        e.evidenceRole === "contradiction" &&
        linked.some(
          (a) =>
            a.id === e.taskId &&
            a.state === "completed" &&
            !a.dismissedSuggestions?.includes(e.id),
        ),
    );
    const eligible =
      followed &&
      !reviewPending &&
      waitingEligible(
        w,
        linked.filter((a) => a.state === "open").length,
        now,
      ) &&
      followUpDue(w, now);
    for (const e of d.events.filter(
      (e) => e.applicationKey === row.key && e.id.startsWith("waiting:"),
    )) {
      if (
        !eligible ||
        !e.id.endsWith(w.waitingSince ?? "") ||
        (milestone === 18 && e.id !== waitingId)
      )
        e.seen = true;
    }
    if (
      eligible &&
      waitingDays < 21 &&
      !d.events.some((e) => e.id === waitingId)
    )
      insert(d, {
        id: waitingId,
        applicationKey: row.key,
        recordId: row.recordId,
        kind: "response",
        at: now.toISOString(),
        title: `Waiting ${waitingDays} days · ${row.company}`,
        description: `You’ve been waiting ${waitingDays} days for a response. ${milestone === 18 ? "Follow up now" : "Consider following up"}. Automatically closes as No response in ${21 - waitingDays} days.`,
        // The reminder shows as a dismissible chip on the application's card, not in Updates.
        notify: false,
        seen: false,
        notificationEligible: true,
      });
    // An explicit response event clears any older waiting recommendation immediately.
    if (last?.kind === "rejected")
      for (const e of d.events.filter(
        (e) => e.applicationKey === row.key && e.id.startsWith("waiting:"),
      ))
        e.seen = true;
  }
}
// reconcileRecruiting runs on every Tracker edit and every recruiting poll, yet its output only
// changes when one of its inputs does. The signature covers each input file (inode, mtime, size, so
// an atomic rename always differs) plus the current minute, because waiting/appointment state also
// depends on `now`.
const inputSignature = (now: Date) =>
  ["records/applications.md", "records/actions.json", "records/mail-sync.json"]
    .map((rel) => {
      try {
        const file = resolveExpected(rel);
        const st = fs.statSync(file);
        return `${file}:${st.ino}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${rel}:-`;
      }
    })
    .concat(String(Math.floor(now.getTime() / 60_000)))
    .join("|");
const recruitingSignature = () => {
  try {
    const st = fs.statSync(file());
    return `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    return "-";
  }
};
type ReconcileView = RecruitingView;
let reconcileMemo: { signature: string; view: ReconcileView } | null = null;

export async function reconcileRecruiting(
  now = new Date(),
): Promise<ReconcileView> {
  const inputs = inputSignature(now);
  if (reconcileMemo?.signature === `${inputs}#${recruitingSignature()}`)
    return reconcileMemo.view;
  const { readApplications } = await import("./applications");
  const { readActions, closeApplicationActions } = await import("./actions");
  const { readMailSync } = await import("./mailSync");
  const apps = await readApplications();
  // Parse the other inputs once, outside the lock, so the locked section only projects and writes.
  const tasks = readActions().actions;
  const interactions = readMailSync().interactions;
  await fresh((d) => {
    if (
      sha256(
        fs.readFileSync(resolveExpected("records/applications.md"), "utf8"),
      ) !== apps.fileHash
    )
      throw new ConflictError("Applications changed during recruiting refresh");
    projectRecruiting(d, apps.rows, tasks, interactions, now);
  });
  // Only applications that still have an open task need closing; most closed workflows have none.
  const withOpenTask = new Set(
    tasks
      .filter((a) => a.state === "open" && a.application)
      .map((a) => applicationFor(a.application!, apps.rows)?.key),
  );
  for (const w of readRecruiting().workflows.filter((w) => w.closure)) {
    const row = applicationFor(w, apps.rows);
    if (row && withOpenTask.has(row.key))
      await closeApplicationActions(row, w.closure!, w.closedAt!);
  }
  const view = {
    ...readRecruiting(),
    rows: apps.rows,
    actions: readActions().actions,
  };
  // Remember the result only if nothing but this refresh's own recruiting write touched the inputs;
  // otherwise a concurrent writer's change could be hidden behind a stale entry.
  reconcileMemo =
    inputSignature(now) === inputs
      ? { signature: `${inputs}#${recruitingSignature()}`, view }
      : null;
  return view;
}
/**
 * What GET /api/recruiting serves. It also retries unfinished follow-ups, but a follow-up that
 * cannot complete (its application was deleted or is ambiguous) is reported in `warnings` and must
 * never take the Dashboard, Actions and Tracker down with it.
 */
export async function recruitingView(): Promise<
  RecruitingView & { warnings?: string[] }
> {
  const warnings: string[] = [];
  const note = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const { retryTrackerRejections } = await import("./actions");
  await retryTrackerRejections(note);
  const view = await resumePending(undefined, note);
  return warnings.length ? { ...view, warnings } : view;
}
export async function recordSubmission(row: ApplicationRow) {
  await fresh((d) =>
    insert(d, {
      id: `submitted:${row.key}`,
      applicationKey: row.key,
      recordId: row.recordId,
      kind: "submitted",
      at: row.date,
      title: "Applied",
      description: "Application submitted",
      notify: false,
      seen: false,
    }),
  );
}

/** Snapshot status before a guarded tracker edit, without inventing historical transitions. */
export async function observeStatus(key: string) {
  const { readApplications } = await import("./applications");
  const { rows } = await readApplications();
  return fresh((d) => {
    for (const row of rows.filter((r) => r.key === key))
      if (!d.workflows.some((w) => applicationFor(w, rows)?.key === row.key))
        d.workflows.push({
          applicationKey: row.key,
          recordId: row.recordId,
          status: row.status,
          statusAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
        });
  });
}

export async function holdActionRequests(
  actions: {
    externalKey: string;
    text: string;
    company?: string;
    role?: string;
    reviewReason?: string | null;
    email: { url: string; receivedAt?: string };
  }[],
) {
  const { readActions } = await import("./actions");
  const saved = readActions();
  return fresh((d) => {
    for (const action of actions) {
      if (
        saved.actions.some(
          (a) =>
            a.externalKeys.includes(action.externalKey) && a.state !== "open",
        ) ||
        saved.dismissed?.some((a) =>
          a.externalKeys.includes(action.externalKey),
        )
      )
        continue;
      if (!action.email.receivedAt)
        throw new Error(
          "Verified email receipt time is required to hold an unmatched request",
        );
      if (!d.pending.some((p) => p.id === action.externalKey))
        d.pending.push({
          id: action.externalKey,
          company: action.company,
          role: action.role,
          summary: action.text,
          reason:
            action.reviewReason ??
            "Confirm the application before creating this task",
          email: action.email.url,
          receivedAt: action.email.receivedAt,
          action: action as unknown as Record<string, unknown>,
        });
    }
  });
}
