import { checkSummarySchema, summarizeCheck } from "./checkSummary";
import { readRecruiting } from "./recruiting";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { resolveExpected } from "./paths";
import { ConflictError, LockedError, sha256, withFileLock } from "./fileStore";
import {
  readActions,
  finalizeActionsCheck,
  actionsFinalizationSchema,
} from "./actions";
import {
  checkAttempt,
  checkMode,
  checkFailure,
  LEASE_MS,
  CHECK_HISTORY_LIMIT,
  type CheckAttempt,
} from "./checkJournal";
const instant = z.iso.datetime({ offset: true });
const discovery = z
  .object({
    messageId: z.string().trim().min(1),
    threadId: z.string().trim().min(1),
    url: z
      .url()
      .refine(
        (s) =>
          new URL(s).hostname === "mail.google.com" &&
          new URL(s).protocol === "https:",
      ),
    receivedAt: instant,
    company: z.string().optional(),
    role: z.string().optional(),
    applicationKey: z.string().optional(),
    kind: z.enum(["first-request", "follow-up", "closed", "uncertain"]),
    summary: z.string().min(1),
    reviewReason: z.string().optional(),
    acknowledgedAt: instant.optional(),
    dismissedAt: instant.optional(),
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    inboxAt: instant.optional(),
    inboxCompletedAt: instant.optional(),
    actionsAt: instant.optional(),
    lastCareerCheck: z
      .object({
        runId: z.string().trim().min(1),
        startedAt: instant,
        completedAt: instant,
        summary: checkSummarySchema.optional(),
      })
      .strict()
      .optional(),
    checkAttempts: z.array(checkAttempt).optional(),
    discoveries: z.array(discovery),
    interactions: z.record(z.string(), instant),
  })
  .strict();
export function readMailSync() {
  const file = resolveExpected("records/mail-sync.json");
  if (fs.existsSync(file))
    return schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  let inboxAt: string | undefined;
  const legacy = resolveExpected("records/inbox-last-check");
  if (fs.existsSync(legacy)) {
    const n = Number(fs.readFileSync(legacy, "utf8").trim());
    const date = new Date(n * 1000);
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(date.getTime()))
      throw new Error(
        "Invalid legacy inbox checkpoint; recover it before scanning",
      );
    inboxAt = date.toISOString();
  }
  return schema.parse({
    version: 1,
    inboxAt,
    discoveries: [],
    interactions: {},
  });
}
export const mailBatch = z
  .object({
    complete: z.boolean(),
    careerCheck: z.boolean().optional(),
    leaseId: z.uuid().optional(),
    startedAt: instant,
    runId: z.string().trim().min(1).optional(),
    mode: z.enum(["inbox", "actions"]),
    discoveries: z
      .array(discovery.omit({ acknowledgedAt: true, dismissedAt: true }))
      .default([]),
    interactions: z.record(z.string(), instant).default({}),
    acknowledge: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.careerCheck && (b.mode !== "actions" || !b.complete))
      ctx.addIssue({
        code: "custom",
        message: "Career completion requires successful Actions acknowledgment",
      });
    if (
      b.mode === "actions" &&
      (b.discoveries.length || Object.keys(b.interactions).length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Actions cannot write inbox discoveries or interactions",
      });
    if (b.mode === "inbox" && (b.acknowledge.length || b.runId))
      ctx.addIssue({
        code: "custom",
        message: "Inbox cannot acknowledge Actions work",
      });
    if (b.mode === "actions" && b.complete && !b.runId)
      ctx.addIssue({
        code: "custom",
        message: "Successful Actions handoff requires finalized runId",
      });
  });
export async function syncMail(input: unknown) {
  const b = mailBatch.parse(input);
  if (Date.parse(b.startedAt) > Date.now())
    throw new Error("Mail run start cannot be in the future");
  for (const at of [
    ...b.discoveries.map((d) => d.receivedAt),
    ...Object.values(b.interactions),
  ])
    if (Date.parse(at) > Date.parse(b.startedAt))
      throw new Error("Mail evidence must be within the run's upper bound");
  return editMail((d) => {
    const attempt = requireLease(d, b.leaseId);
    if (
      attempt &&
      (attempt.stage !== b.mode ||
        Date.parse(attempt.startedAt) !== Date.parse(b.startedAt) ||
        (b.mode === "actions" && attempt.runId !== b.runId) ||
        !!b.careerCheck !==
          (attempt.mode === "daily" && b.mode === "actions" && b.complete))
    )
      throw new ConflictError(
        "Mail batch does not belong to the active check stage",
      );
    if (
      attempt &&
      b.mode === "inbox" &&
      b.complete &&
      d.inboxAt &&
      Date.parse(b.startedAt) < Date.parse(d.inboxAt)
    )
      throw new ConflictError("Inbox checkpoint is newer than this scan");
    if (
      attempt &&
      b.mode === "actions" &&
      (!b.complete ||
        !attempt.acknowledge ||
        JSON.stringify(attempt.acknowledge) !== JSON.stringify(b.acknowledge))
    )
      throw new ConflictError("Use the saved acknowledgment from mail publish");
    // Use the same publication for validation and the combined summary,
    // even when another local writer runs between the initial read and lock.
    const actions =
      b.mode === "actions" && b.complete ? readActions() : undefined;
    const publication = actions?.lastCheck;
    if (
      actions &&
      (!publication ||
        publication.runId !== b.runId ||
        Date.parse(publication.startedAt) !== Date.parse(b.startedAt) ||
        actions.actions.some((a) => a.pendingNextClear || a.syncWarning))
    )
      throw new ConflictError(
        "Finalize this successful Actions Check before acknowledging it",
      );
    const byId = new Map(d.discoveries.map((item) => [item.messageId, item]));
    for (const item of b.discoveries) {
      const old = byId.get(item.messageId);
      if (!old) {
        d.discoveries.push(item);
        byId.set(item.messageId, item);
      } else {
        // Identity is immutable. Classification/matching corrections must be
        // reprocessed by Actions, while identical overlap preserves its ack.
        if (
          old.threadId !== item.threadId ||
          Date.parse(old.receivedAt) !== Date.parse(item.receivedAt)
        )
          throw new Error("Discovery provenance conflicts with saved message");
        const { acknowledgedAt, dismissedAt, ...previous } = old;
        const canonical = (value: typeof previous) =>
          JSON.stringify(
            Object.entries({
              ...value,
              receivedAt: new Date(value.receivedAt).toISOString(),
            }).sort(([a], [b]) => a.localeCompare(b)),
          );
        if (canonical(previous) !== canonical(item)) {
          if (d.inboxAt && Date.parse(b.startedAt) < Date.parse(d.inboxAt))
            throw new ConflictError(
              "A newer Inbox Check completed; re-read before correcting discoveries",
            );
          for (const key of Object.keys(old))
            delete (old as Record<string, unknown>)[key];
          Object.assign(old, item);
          if (dismissedAt)
            Object.assign(old, { dismissedAt, acknowledgedAt: dismissedAt });
        } else if (acknowledgedAt) old.acknowledgedAt = acknowledgedAt;
      }
    }
    for (const [key, at] of Object.entries(b.interactions))
      if (
        !d.interactions[key] ||
        Date.parse(at) > Date.parse(d.interactions[key])
      )
        d.interactions[key] = at;
    if (b.mode === "actions")
      for (const id of b.acknowledge) {
        const item = byId.get(id);
        if (!item) throw new Error("Unknown discovery");
        if (Date.parse(item.receivedAt) > Date.parse(b.startedAt))
          throw new Error(
            "Cannot acknowledge mail outside this run's upper bound",
          );
        item.acknowledgedAt ??= new Date().toISOString();
      }
    if (
      b.mode === "actions" &&
      b.complete &&
      d.discoveries.some(
        (item) =>
          !item.acknowledgedAt &&
          Date.parse(item.receivedAt) <= Date.parse(b.startedAt),
      )
    )
      throw new Error(
        "Unprocessed discoveries remain; keep this Actions run incomplete",
      );
    if (b.careerCheck) {
      // This marker commits atomically with acknowledgment, after both stages
      // have succeeded at the orchestrator's shared scan boundary.
      if (!d.inboxAt || Date.parse(d.inboxAt) !== Date.parse(b.startedAt))
        throw new ConflictError(
          "Complete Inbox at this run boundary before recording Career Check",
        );
      if (d.lastCareerCheck?.runId !== b.runId) {
        if (
          d.lastCareerCheck &&
          Date.parse(d.lastCareerCheck.startedAt) >= Date.parse(b.startedAt)
        )
          throw new ConflictError("A newer Career Check was already recorded");
        d.lastCareerCheck = {
          runId: b.runId!,
          startedAt: b.startedAt,
          completedAt: new Date().toISOString(),
          summary: careerCheckSummary(b.startedAt, publication!.changes),
        };
      } else if (
        Date.parse(d.lastCareerCheck!.startedAt) !== Date.parse(b.startedAt)
      )
        throw new ConflictError("Career Check run identity changed");
    }
    if (b.complete) {
      const key = b.mode === "inbox" ? "inboxAt" : "actionsAt";
      if (!d[key] || Date.parse(b.startedAt) > Date.parse(d[key]!)) {
        d[key] = b.startedAt;
        if (b.mode === "inbox" && !attempt) delete d.inboxCompletedAt;
      }
    }
    if (attempt && b.complete) {
      const now = new Date().toISOString();
      if (b.mode === "inbox") {
        attempt.inboxCompletedAt = now;
        d.inboxCompletedAt = now;
        if (attempt.mode === "daily") attempt.stage = "actions";
        else closeAttempt(attempt, now);
      } else if (attempt.mode === "daily") {
        attempt.stage = "maintenance";
        delete attempt.acknowledge;
      } else closeAttempt(attempt, now);
    }
  });
}

type MailDocument = z.infer<typeof schema>;

/** Daily counts: tasks Quick already reported as new are shown again but not counted twice. */
function careerCheckSummary(
  startedAt: string,
  changes: { kind: string; quickReported?: boolean }[],
) {
  const recruiting = readRecruiting();
  return summarizeCheck(
    recruiting.events,
    startedAt,
    new Date().toISOString(),
    changes.filter((c) => c.kind === "new" && !c.quickReported).length,
    recruiting.workflows,
  );
}

export async function dismissMailReview(messageId: string) {
  return editMail((doc) => {
    requireLease(doc);
    const item = doc.discoveries.find((d) => d.messageId === messageId);
    if (!item?.reviewReason)
      throw new ConflictError("This email no longer needs review");
    item.dismissedAt ??= new Date().toISOString();
    item.acknowledgedAt ??= item.dismissedAt;
  });
}

async function editMail(edit: (doc: MailDocument) => void) {
  const file = resolveExpected("records/mail-sync.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    // One snapshot supplies both the parsed document and optimistic hash.
    const raw = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8")
      : JSON.stringify(readMailSync());
    const initial = raw;
    try {
      const saved = await withFileLock(
        file,
        sha256(raw),
        (current) => {
          const d = schema.parse(JSON.parse(current));
          edit(d);
          return JSON.stringify(schema.parse(d), null, 2) + "\n";
        },
        {
          initialText: initial,
          lockPath: resolveExpected("ui/.cache/mail-sync.lock"),
        },
      );
      return schema.parse(JSON.parse(saved.text));
    } catch (e) {
      // Retry contention only. A rejected stage or batch must stay rejected.
      if (
        !(e instanceof ConflictError) ||
        e.message !== "file changed since it was last read" ||
        attempt >= 2
      )
        throw e;
    }
  }
}

function requireLease(doc: MailDocument, leaseId?: string) {
  const attempt = doc.checkAttempts?.at(-1);
  const active =
    attempt?.status === "running" && Date.parse(attempt.expiresAt) > Date.now()
      ? attempt
      : undefined;
  if (leaseId && active?.leaseId !== leaseId)
    throw new ConflictError(
      "Check lease expired or changed; begin the check again",
    );
  if (active && !leaseId)
    throw new LockedError(
      "A recruiting check is already running; wait for it to finish or its lease to expire",
    );
  return active;
}

function renew(attempt: CheckAttempt) {
  attempt.expiresAt = new Date(Date.now() + LEASE_MS).toISOString();
}

function closeAttempt(
  attempt: CheckAttempt,
  now: string,
  failure?: CheckAttempt["failure"],
) {
  attempt.endedAt = now;
  attempt.status = failure ? "failed" : "succeeded";
  attempt.failure = failure;
  if (!failure) delete attempt.acknowledge;
}

function publicationFor(attempt: CheckAttempt) {
  const actions = readActions();
  const publication =
    attempt.mode === "quick" ? actions.lastQuickCheck : actions.lastCheck;
  return publication?.runId === attempt.runId &&
    Date.parse(publication.startedAt) === Date.parse(attempt.startedAt)
    ? publication
    : undefined;
}

export async function beginMailCheck(input: unknown) {
  const { mode } = z.object({ mode: checkMode }).strict().parse(input);
  let step: CheckAttempt["stage"] | "finish";
  const saved = await editMail((d) => {
    requireLease(d);
    const now = new Date().toISOString();
    const attempts = (d.checkAttempts ??= []);
    const previous = attempts.at(-1);
    if (previous?.status === "running")
      closeAttempt(previous, now, "interrupted");
    const latest = attempts.findLast((attempt) => attempt.mode === mode);
    const newestActions =
      mode === "daily" && latest?.stage === "actions"
        ? readActions().lastCheck
        : undefined;
    const canResume =
      latest?.status === "failed" &&
      (latest.stage === "maintenance" ||
        (mode === "daily" &&
          latest.stage === "actions" &&
          latest.startedAt === d.inboxAt &&
          (!newestActions ||
            Date.parse(newestActions.startedAt) <=
              Date.parse(latest.startedAt))) ||
        ((mode === "actions" || mode === "quick") && !!publicationFor(latest)));
    // Move the acknowledgment plan into the new attempt. History keeps only metadata.
    const acknowledge = canResume ? latest.acknowledge : undefined;
    if (latest) delete latest.acknowledge;
    const attempt: CheckAttempt = {
      runId: canResume ? latest.runId : randomUUID(),
      leaseId: randomUUID(),
      mode,
      stage: canResume ? latest.stage : mode === "daily" ? "inbox" : mode,
      status: "running",
      startedAt: canResume ? latest.startedAt : now,
      attemptedAt: now,
      expiresAt: now,
      inboxCompletedAt: canResume ? latest.inboxCompletedAt : undefined,
      acknowledge,
    };
    renew(attempt);
    step =
      attempt.stage === "maintenance" ||
      (canResume && !!publicationFor(attempt))
        ? "finish"
        : attempt.stage;
    d.checkAttempts = [...attempts, attempt].slice(-CHECK_HISTORY_LIMIT);
  });
  return { ...saved.checkAttempts!.at(-1)!, step: step! };
}

const leaseInput = z.object({ leaseId: z.uuid() }).strict();

export async function heartbeatMailCheck(input: unknown) {
  const { leaseId } = leaseInput.parse(input);
  return (
    await editMail((d) => renew(requireLease(d, leaseId)!))
  ).checkAttempts!.at(-1)!;
}

/** CLI check writers share the guard. Browser-owned mutations keep their existing revision checks. */
export async function guardMailCheck(
  leaseId: string | undefined,
  stages: CheckAttempt["stage"][],
) {
  if (!leaseId) {
    requireLease(readMailSync());
    return;
  }
  await editMail((d) => {
    const attempt = requireLease(d, leaseId)!;
    if (!stages.includes(attempt.stage))
      throw new ConflictError(
        "Operation does not belong to the active check stage",
      );
    renew(attempt);
  });
}

export async function failMailCheck(input: unknown) {
  const { leaseId, failure } = leaseInput
    .extend({ failure: checkFailure })
    .parse(input);
  return editMail((d) =>
    closeAttempt(requireLease(d, leaseId)!, new Date().toISOString(), failure),
  );
}

const publishInput = actionsFinalizationSchema
  .pick({ fileHash: true, changes: true })
  .extend({
    leaseId: z.uuid(),
    acknowledge: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export async function publishMailCheck(input: unknown) {
  const { leaseId, fileHash, changes, acknowledge } = publishInput.parse(input);
  const saved = await editMail((d) => {
    const attempt = requireLease(d, leaseId)!;
    if (attempt.stage !== "actions" && attempt.stage !== "quick")
      throw new ConflictError("Complete Inbox before publishing Actions");
    if (publicationFor(attempt))
      throw new ConflictError("Actions is already published; run mail finish");
    if (attempt.mode === "quick") {
      if (acknowledge.length) throw new Error("Quick cannot acknowledge mail");
    } else {
      const eligible = d.discoveries.filter(
        (item) => Date.parse(item.receivedAt) <= Date.parse(attempt.startedAt),
      );
      const ids = new Set(acknowledge);
      if (
        acknowledge.some(
          (id) => !eligible.some((item) => item.messageId === id),
        ) ||
        eligible.some(
          (item) => !item.acknowledgedAt && !ids.has(item.messageId),
        )
      )
        throw new Error(
          "Acknowledgment must cover every pending discovery inside the scan boundary",
        );
      attempt.acknowledge = [...ids];
    }
    renew(attempt);
  });
  const attempt = saved.checkAttempts!.at(-1)!;
  // Capture each task's request/activity events before counting, so the summary does not
  // depend on whether the UI happened to refresh during the check.
  const { reconcileRecruiting } = await import("./recruiting");
  await reconcileRecruiting();
  await finalizeActionsCheck({
    fileHash,
    changes,
    runId: attempt.runId,
    startedAt: attempt.startedAt,
    complete: true,
    ...(attempt.mode === "quick" ? { scope: "quick" } : {}),
  });
  return finishMailCheck({ leaseId });
}

export async function finishMailCheck(input: unknown) {
  const { leaseId } = leaseInput.parse(input);
  const attempt = await heartbeatMailCheck({ leaseId });
  if (attempt.stage !== "maintenance") {
    if (attempt.stage === "inbox" || !publicationFor(attempt))
      throw new ConflictError("Actions has not been published for this check");
    if (attempt.stage === "quick")
      return editMail((d) =>
        closeAttempt(requireLease(d, leaseId)!, new Date().toISOString()),
      );
    if (!attempt.acknowledge)
      throw new ConflictError(
        "Saved acknowledgment is missing; reconcile Actions again",
      );
    const result = await syncMail({
      leaseId,
      complete: true,
      mode: "actions",
      startedAt: attempt.startedAt,
      runId: attempt.runId,
      acknowledge: attempt.acknowledge,
      ...(attempt.mode === "daily" ? { careerCheck: true } : {}),
    });
    if (attempt.mode !== "daily") return result;
  }
  const { ageApplications, maintenanceWarning } = await import("./maintenance");
  // A resumed scan may be days old. Age only through the boundary covered by Inbox.
  await ageApplications(new Date(attempt.startedAt));
  if (maintenanceWarning())
    return failMailCheck({ leaseId, failure: "maintenance" });
  const publication = readActions().lastCheck;
  return editMail((d) => {
    // Maintenance can add No response closures after the success was recorded; recount so
    // they appear in this Daily's report. completedAt stays the recorded success time.
    if (
      d.lastCareerCheck?.runId === attempt.runId &&
      publication?.runId === attempt.runId
    )
      d.lastCareerCheck.summary = careerCheckSummary(
        attempt.startedAt,
        publication.changes,
      );
    closeAttempt(requireLease(d, leaseId)!, new Date().toISOString());
  });
}

/** Read-only bounds: completion time is display metadata, never a scan watermark. */
export function quickMailWindow(input: unknown) {
  const { startedAt } = z.object({ startedAt: instant }).strict().parse(input);
  const upper = Date.parse(startedAt);
  if (upper > Date.now())
    throw new Error("Quick run start cannot be in the future");
  const mail = readMailSync();
  const actions = readActions();
  const checkpoints = [
    mail.lastCareerCheck?.startedAt,
    actions.lastQuickCheck?.startedAt,
  ]
    .filter((at): at is string => !!at)
    .map(Date.parse);
  if (checkpoints.some((at) => at > upper))
    throw new ConflictError("A newer check exists; capture a fresh run start");
  const lower = checkpoints.length
    ? Math.max(...checkpoints) - 60 * 60 * 1000
    : upper - 2 * 24 * 60 * 60 * 1000;
  return {
    startedAt,
    lowerBound: new Date(lower).toISOString(),
    upperBound: new Date(upper).toISOString(),
    initialCoverage: !checkpoints.length,
    query: `in:anywhere -in:trash -in:drafts after:${Math.floor(lower / 1000)} before:${Math.ceil(upper / 1000)}`,
  };
}
