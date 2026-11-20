import { checkSummarySchema, summarizeCheck } from "./checkSummary";
import { readRecruiting } from "./recruiting";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveExpected } from "./paths";
import { ConflictError, sha256, withFileLock } from "./fileStore";
import {
  NotFoundError,
  readApplications,
  updateRow,
  parseApplications,
} from "./applications";
import { localDate, localToday } from "./config";
import { statusColumn, isClosedStatus } from "./status";
import { applicationFor } from "./recruitingTypes";
import type { ApplicationRow } from "./types";
import { ACTION_CATEGORIES } from "./actionTypes";
import type { ActionsPayload, InboxAction } from "./actionTypes";

const line = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((s) => !/[\r\n]/.test(s), "Must be one line");
const isoDate = z.iso.date();
const deadlineSchema = z
  .object({
    kind: z.enum(["requested", "expires"]).optional(),
    date: isoDate,
    at: z.iso.datetime({ offset: true }).optional(),
    wording: line,
  })
  .strict()
  .refine(
    (d) => !d.at || localDate(new Date(d.at)) === d.date,
    "Deadline time must fall on its New York date",
  );
const applicationSchema = z
  .object({
    recordId: line.optional(),
    rowKey: line,
    expectedNext: line.optional(),
  })
  .strict();
const emailSchema = z
  .object({
    threadId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    messageId: line,
    receivedAt: z.iso.datetime({ offset: true }).optional(),
    url: z.url().refine((s) => {
      const u = new URL(s);
      return u.protocol === "https:" && u.hostname === "mail.google.com";
    }, "Expected a Gmail link"),
  })
  .strict();

const enrichment = {
  activity: z
    .object({
      id: line,
      type: z.enum(["first-request", "follow-up"]).optional(),
      at: z.iso.datetime({ offset: true }),
    })
    .strict()
    .optional(),
  contactOrganization: line.optional(),
  location: line.optional(),
  publicLink: z
    .object({
      url: z.url().refine((s) => /^https?:$/.test(new URL(s).protocol)),
      kind: z.enum(["job", "careers", "company"]),
    })
    .strict()
    .optional(),
  requestKind: z
    .enum([
      "scheduling",
      "screening",
      "submission",
      "preparation",
      "administrative",
    ])
    .optional(),
  category: z.enum(ACTION_CATEGORIES).optional(),
  responseExpected: z.boolean().optional(),
  explanation: line.optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  priorityReason: line.optional(),
  relationship: z
    .enum(["direct", "agency", "consulting", "unknown"])
    .optional(),
  effort: line.optional(),
  // false: confirming this request must not move the application to In progress (it only asks the workspace owner
  // to finish or repair his own submission, e.g. a delivery failure, not employer engagement).
  advancesStatus: z.boolean().optional(),
  latestEmployerAt: z.iso.datetime({ offset: true }).optional(),
  reviewReason: line.optional(),
  completionSuggestion: z
    .object({
      identity: line,
      reason: line,
      messageId: line,
      url: z
        .url()
        .refine(
          (s) =>
            new URL(s).hostname === "mail.google.com" &&
            new URL(s).protocol === "https:",
        ),
      at: z.iso.datetime({ offset: true }),
    })
    .strict()
    .optional(),
};

const actionSchema = z
  .object({
    id: z.uuid(),
    externalKeys: z.array(line).min(1),
    revision: z.number().int().positive(),
    text: line,
    ...enrichment,
    recruitingEvents: z
      .array(
        z
          .object({
            id: line,
            kind: z.enum(["requested", "completed"]),
            at: z.iso.datetime({ offset: true }),
            title: line,
            description: z.string(),
            email: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    pendingTrackerRejection: z.boolean().optional(),
    manuallyClosedAt: z.iso.datetime().optional(),
    applicationConfirmed: z.boolean().optional(),
    roleOverride: line.optional(),
    publicLinkOverride: enrichment.publicLink.unwrap().shape.url.optional(),
    hidden: z.boolean().optional(),
    viewedActivityId: line.optional(),
    dismissedNewActivityId: line.optional(),
    reportedActivityId: line.optional(),
    pendingCheckKind: z.enum(["new", "updated"]).optional(),
    pendingQuickKind: z.enum(["new", "updated"]).optional(),
    priorityOverride: z.enum(["high", "medium", "low"]).optional(),
    dismissedSuggestion: line.optional(),
    dismissedSuggestions: z.array(line).optional(),
    resolvedAt: z.iso.datetime().optional(),
    resolution: z
      .object({
        source: z.enum(["user", "email", "system"]),
        reason: line,
        evidenceMessageId: line.optional(),
      })
      .strict()
      .optional(),
    company: line.optional(),
    role: line.optional(),
    application: applicationSchema.optional(),
    deadline: deadlineSchema.optional(),
    email: emailSchema.optional(),
    state: z.enum(["open", "completed", "superseded"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
    resolvedReason: line.optional(),
    pendingNextClear: z.boolean().optional(),
    syncWarning: line.optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (action.state === "completed" && !action.completedAt)
      ctx.addIssue({
        code: "custom",
        message: "Completed action needs a completion timestamp",
      });
    if (
      action.pendingNextClear &&
      (action.state !== "completed" || !action.application)
    )
      ctx.addIssue({
        code: "custom",
        message: "Only a completed, linked action can need tracker cleanup",
      });
  });
export const actionGroupSchema = z.union([
  z.object({ application: applicationSchema }).strict(),
  z.object({ actionId: z.uuid() }).strict(),
]);
const documentSchema = z
  .object({
    version: z.literal(1),
    importedNext: z.boolean(),
    lastQuickCheck: z
      .object({
        runId: line,
        startedAt: z.iso.datetime({ offset: true }),
        completedAt: z.iso.datetime({ offset: true }),
        summary: checkSummarySchema.optional(),
      })
      .strict()
      .optional(),
    quickChanges: z
      .array(
        z
          .object({
            id: z.uuid(),
            activityId: line,
            kind: z.enum(["new", "updated"]),
          })
          .strict(),
      )
      .optional(),
    lastIncompleteAt: z.iso.datetime({ offset: true }).optional(),
    lastCheck: z
      .object({
        runId: line,
        startedAt: z.iso.datetime({ offset: true }),
        completedAt: z.iso.datetime({ offset: true }),
        changes: z.array(
          z
            .object({
              id: z.uuid(),
              activityId: line,
              kind: z.enum(["new", "updated"]),
              /** Already counted as new by a Quick check; Daily shows it but does not count it again. */
              quickReported: z.boolean().optional(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    dismissed: z
      .array(z.object({ id: z.uuid(), externalKeys: z.array(line) }).strict())
      .default([]),
    hiddenGroups: z.array(actionGroupSchema).optional(),
    actions: z.array(actionSchema),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const a of [...doc.actions, ...doc.dismissed]) {
      if (
        ids.has(a.id) ||
        new Set(a.externalKeys).size !== a.externalKeys.length ||
        a.externalKeys.some((key) => keys.has(key))
      )
        ctx.addIssue({ code: "custom", message: "Duplicate action identity" });
      ids.add(a.id);
      a.externalKeys.forEach((key) => keys.add(key));
    }
  });
type ActionDocument = z.infer<typeof documentSchema>;

/** Count calendar days from receipt in New York; receipt day is day zero, even across DST. */
export function relativeActionDeadline(
  receivedAt: string,
  days: number,
  wording: string,
  kind: "requested" | "expires" = "requested",
) {
  z.iso.datetime({ offset: true }).parse(receivedAt);
  z.number().int().min(0).max(3650).parse(days);
  const date = new Date(`${localDate(new Date(receivedAt))}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return deadlineSchema.parse({
    date: date.toISOString().slice(0, 10),
    wording,
    kind,
  });
}
const empty: ActionDocument = {
  version: 1,
  importedNext: false,
  actions: [],
  dismissed: [],
};
const encode = (doc: ActionDocument) => JSON.stringify(doc, null, 2) + "\n";
const initialText = encode(empty);
const actionPath = () => resolveExpected("records/actions.json");
const lockPath = () => resolveExpected("ui/.cache/actions.lock");

export function readActions(): ActionsPayload {
  let raw: string;
  try {
    raw = fs.readFileSync(actionPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    raw = initialText;
  }
  return { ...documentSchema.parse(JSON.parse(raw)), fileHash: sha256(raw) };
}

async function editActions(
  hash: string,
  mutate: (doc: ActionDocument) => void,
) {
  const file = actionPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await withFileLock(
    file,
    hash,
    (raw) => {
      const doc = documentSchema.parse(JSON.parse(raw));
      mutate(doc);
      doc.dismissed ??= [];
      // Full resolved records remain canonical history; legacy tombstones stay separate.
      return encode(documentSchema.parse(doc));
    },
    { lockPath: lockPath(), initialText },
  );
  return readActions();
}

async function freshEdit(mutate: (doc: ActionDocument) => void) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await editActions(readActions().fileHash, mutate);
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt >= 2) throw e;
    }
  }
}

/** Manual tasks have no mail provenance and do not advance recruiting-check history. */
export async function createManualAction(input: unknown) {
  const request = z
    .object({
      fileHash: z.string().regex(/^[a-f0-9]{64}$/),
      applicationKey: line,
      text: line,
      explanation: line.optional(),
      priority: enrichment.priority,
      relationship: enrichment.relationship,
      deadline: deadlineSchema.optional(),
    })
    .strict()
    .parse(input);
  const application = applicationFor(
    { rowKey: request.applicationKey },
    (await readApplications()).rows,
  );
  if (!application) throw new NotFoundError("Application not found");
  const now = new Date().toISOString();
  const id = randomUUID();
  const action = actionSchema.parse({
    id,
    externalKeys: [`manual:${id}`],
    revision: 1,
    text: request.text,
    explanation: request.explanation,
    company: application.company,
    role: application.role,
    application: {
      rowKey: application.key,
      ...(application.recordId ? { recordId: application.recordId } : {}),
    },
    relationship: request.relationship ?? "unknown",
    deadline: request.deadline,
    activity: { id, type: "first-request", at: now },
    state: "open",
    createdAt: now,
    updatedAt: now,
  });
  return editActions(request.fileHash, (doc) => {
    doc.actions.unshift(action);
  });
}

/** Only machine-readable YYYY-MM-DD dates are imported; the original task retains any precise time wording. */
export function deadlineFromNext(text: string) {
  const match = text.match(/\bby (\d{4}-\d{2}-\d{2})\b/);
  if (!match || !isoDate.safeParse(match[1]).success) return undefined;
  const date = match[1];
  const time = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s+(?:ET|EST|EDT)\b/i,
  );
  if (
    time &&
    Number(time[1]) >= 1 &&
    Number(time[1]) <= 12 &&
    Number(time[2] ?? 0) < 60
  ) {
    const hour =
      (Number(time[1]) % 12) + (time[3].toUpperCase() === "PM" ? 12 : 0);
    const minute = Number(time[2] ?? 0);
    const wall = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    // Only adopt a unique New York instant; skipped/repeated DST times remain date-only with original wording.
    const candidates = [4, 5]
      .map(
        (offset) =>
          new Date(Date.parse(`${date}T${wall}:00Z`) + offset * 3_600_000),
      )
      .filter((d) => localDate(d) === date && formatter.format(d) === wall);
    if (candidates.length === 1)
      return { date, at: candidates[0].toISOString(), wording: text };
  }
  return { date, wording: text };
}

export async function importNextActions() {
  const apps = await readApplications();
  if (apps.readOnly) throw new Error(apps.readOnly.reason);
  return freshEdit((doc) => {
    if (doc.importedNext) return;
    const now = new Date().toISOString();
    for (const row of apps.rows.filter(
      (r) => statusColumn(r.status).column === "in progress" && r.next.trim(),
    )) {
      const key = `tracker:${row.recordId || row.key}`;
      if (
        doc.dismissed.some((a) => a.externalKeys.includes(key)) ||
        doc.actions.some(
          (a) =>
            a.externalKeys.includes(key) ||
            (a.application?.rowKey === row.key &&
              a.application.expectedNext === row.next),
        )
      )
        continue;
      doc.actions.push({
        id: randomUUID(),
        externalKeys: [key],
        revision: 1,
        text: row.next,
        company: row.company,
        role: row.role,
        application: {
          rowKey: row.key,
          ...(row.recordId ? { recordId: row.recordId } : {}),
          expectedNext: row.next,
        },
        deadline: deadlineFromNext(row.next),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
    }
    doc.importedNext = true;
  });
}

// Priority was removed from Actions (Nov 18, 2026): saved values are tolerated, but checks may not send it.
const {
  priority: _priority,
  priorityReason: _priorityReason,
  ...checkEnrichment
} = enrichment;
export const actionSyncSchema = z
  .object({
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    complete: z.boolean(),
    scope: z.literal("quick").optional(),
    requireMatch: z.boolean().optional(),
    actions: z
      .array(
        z
          .object({
            externalKey: line,
            text: line,
            ...checkEnrichment,
            company: line.optional(),
            role: line.optional(),
            application: applicationSchema.optional(),
            deadline: deadlineSchema.nullable().optional(),
            reviewReason: line.nullable().optional(),
            completionSuggestion: enrichment.completionSuggestion
              .unwrap()
              .nullable()
              .optional(),
            email: emailSchema,
          })
          .strict(),
      )
      .max(1000),
    retire: z
      .array(
        z
          .object({ id: z.uuid(), reason: line, evidenceMessageId: line })
          .strict(),
      )
      .default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (!input.complete && input.retire.length)
      ctx.addIssue({
        code: "custom",
        message: "Partial runs cannot retire actions",
      });
    if (
      new Set(input.actions.map((a) => a.externalKey)).size !==
      input.actions.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate external keys" });
    for (const a of input.actions)
      if (
        !a.externalKey.startsWith(`gmail:${a.email.threadId}:`) ||
        !a.externalKey.slice(`gmail:${a.email.threadId}:`.length).trim()
      )
        ctx.addIssue({
          code: "custom",
          message: "Action key must be gmail:<threadId>:<stable-action-key>",
        });
  });

export async function syncActions(input: unknown) {
  const batch = actionSyncSchema.parse(input);
  if (batch.requireMatch) {
    const snapshot = readActions();
    if (snapshot.fileHash !== batch.fileHash)
      throw new ConflictError("Actions changed; reconcile before retrying");
    const rows = (await readApplications()).rows;
    const held = prepareMatchedActions(batch, snapshot, rows);
    if (held.length) {
      const { holdActionRequests } = await import("./recruiting");
      await holdActionRequests(held);
    }
  }
  await editActions(batch.fileHash, (doc) => mergeActionBatch(doc, batch));
  return batch.scope === "quick" ? readActions() : retryPendingNextClears();
}

export const actionPreviewSnapshotSchema = documentSchema.safeExtend({
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  pendingMatches: z.array(z.record(z.string(), z.unknown())).optional(),
});

function prepareMatchedActions(
  batch: z.infer<typeof actionSyncSchema>,
  snapshot: Pick<ActionsPayload, "actions" | "dismissed">,
  rows: ApplicationRow[],
) {
  const pending = readRecruiting().pending;
  const held: typeof batch.actions = [];
  batch.actions = batch.actions.flatMap((incoming) => {
    if (
      incoming.email.receivedAt &&
      Date.parse(incoming.email.receivedAt) > Date.now()
    )
      throw new Error("Future email receipt time");
    const saved = snapshot.actions.find((a) =>
      a.externalKeys.includes(incoming.externalKey),
    );
    const match = pending.find(
      (p) =>
        p.id === incoming.externalKey ||
        p.action?.externalKey === incoming.externalKey,
    );
    if (
      match?.dismissedAt ||
      snapshot.dismissed?.some((a) =>
        a.externalKeys.includes(incoming.externalKey),
      )
    )
      return [];
    const existing =
      saved?.application ??
      (match?.resolvedKey ? { rowKey: match.resolvedKey } : undefined);
    const linked = existing && applicationFor(existing, rows);
    const proposed =
      incoming.application && applicationFor(incoming.application, rows);
    if (
      !saved?.applicationConfirmed &&
      linked &&
      proposed &&
      linked.key !== proposed.key
    )
      throw new ConflictError(
        "Request already linked to a different application",
      );
    const row = linked ?? (!existing && !match ? proposed : undefined);
    if (row && !saved && !match?.resolvedKey) {
      const prior = snapshot.actions.filter(
        (a) =>
          a.application && applicationFor(a.application, rows)?.key === row.key,
      );
      if (
        isClosedStatus(row.status) ||
        (prior.length > 0 &&
          prior.every((a) => a.state === "superseded" || a.manuallyClosedAt))
      ) {
        if (!incoming.email.receivedAt)
          throw new ConflictError(
            "Verified receipt time required for reactivation review",
          );
        held.push({
          ...incoming,
          reviewReason:
            "Previously dismissed or closed work: confirm this new request and reopen the application before restoring actions.",
        });
        return [];
      }
    }
    if (!row) {
      if (saved?.state !== undefined && saved.state !== "open") return [];
      if (!incoming.email.receivedAt)
        throw new Error(
          "Verified email receipt time is required to hold an unmatched request",
        );
      held.push(incoming);
      return [];
    }
    return [
      {
        ...incoming,
        ...(saved?.applicationConfirmed &&
        proposed &&
        linked?.key !== proposed.key
          ? { publicLink: saved.publicLink }
          : {}),
        company: row.company,
        role: row.role,
        application: {
          ...incoming.application,
          rowKey: row.key,
          recordId: row.recordId || undefined,
          expectedNext: saved?.application
            ? saved.application.expectedNext
            : incoming.application?.expectedNext,
        },
      },
    ];
  });
  return held;
}

export function previewActions(input: unknown) {
  const batch = actionSyncSchema
    .safeExtend({
      snapshot: actionPreviewSnapshotSchema.optional(),
    })
    .parse(input);
  const snapshot = readActions();
  if (snapshot.fileHash !== batch.fileHash)
    throw new ConflictError("Actions changed; re-read before previewing");
  if (batch.snapshot && batch.snapshot.fileHash !== batch.fileHash)
    throw new ConflictError("Preview snapshot belongs to a different base");
  const { fileHash, ...doc } = batch.snapshot ?? snapshot;
  delete (doc as Record<string, unknown>).pendingMatches;
  const projected = documentSchema.parse(doc);
  const pendingMatches = [...(batch.snapshot?.pendingMatches ?? [])];
  if (batch.requireMatch) {
    const rows = parseApplications(
      fs.readFileSync(resolveExpected("records/applications.md"), "utf8"),
    ).rows;
    const held = prepareMatchedActions(batch, projected, rows);
    for (const a of held)
      if (!pendingMatches.some((p) => p.externalKey === a.externalKey))
        pendingMatches.push(a);
  }
  mergeActionBatch(projected, batch);
  return {
    ...documentSchema.parse(projected),
    fileHash,
    ...(pendingMatches.length ? { pendingMatches } : {}),
  };
}

function mergeActionBatch(
  doc: ActionDocument,
  batch: z.infer<typeof actionSyncSchema>,
) {
  const now = new Date().toISOString();
  for (const incoming of batch.actions) {
    const { externalKey, ...fields } = incoming;
    // Normalize explicit clears before comparing, so replaying them is a no-op.
    for (const key of [
      "deadline",
      "reviewReason",
      "completionSuggestion",
    ] as const)
      if (fields[key] === null) fields[key] = undefined;
    if (doc.dismissed?.some((a) => a.externalKeys.includes(externalKey)))
      continue;
    const existing = doc.actions.find((a) =>
      a.externalKeys.includes(externalKey),
    );
    if (
      fields.activity &&
      existing?.activity &&
      Date.parse(fields.activity.at) < Date.parse(existing.activity.at)
    )
      delete fields.activity;
    if (
      fields.completionSuggestion &&
      (fields.completionSuggestion.identity === existing?.dismissedSuggestion ||
        existing?.dismissedSuggestions?.includes(
          fields.completionSuggestion.identity,
        ))
    )
      delete fields.completionSuggestion;
    if (
      fields.latestEmployerAt &&
      existing?.latestEmployerAt &&
      Date.parse(fields.latestEmployerAt) <
        Date.parse(existing.latestEmployerAt)
    )
      delete fields.latestEmployerAt;
    if (
      fields.completionSuggestion &&
      existing?.completionSuggestion &&
      Date.parse(fields.completionSuggestion.at) <
        Date.parse(existing.completionSuggestion.at)
    )
      delete fields.completionSuggestion;
    // Promote an imported tracker task when email supplies provenance; never merge two unrelated requests.
    let found = existing;
    if (!found && incoming.application?.expectedNext) {
      const candidates = doc.actions.filter(
        (a) =>
          !a.email &&
          a.application &&
          (incoming.application!.recordId
            ? a.application.recordId === incoming.application!.recordId
            : a.application.rowKey === incoming.application!.rowKey) &&
          a.application.expectedNext === incoming.application!.expectedNext,
      );
      if (candidates.length > 1)
        throw new ConflictError("Legacy action match is ambiguous");
      found = candidates[0];
    }
    if (found) {
      if (found.applicationConfirmed) {
        if (
          fields.application &&
          fields.application.rowKey !== found.application?.rowKey &&
          (!fields.application.recordId ||
            fields.application.recordId !== found.application?.recordId)
        )
          delete fields.publicLink;
        fields.application = found.application;
        fields.company = found.company;
        fields.role = found.role;
      }
      if (!found.externalKeys.includes(externalKey))
        found.externalKeys.push(externalKey);
      // Request provenance and guarded legacy cleanup belong to the original ask.
      if (found.email) {
        fields.email = { ...found.email };
        if (
          found.email.messageId === incoming.email.messageId &&
          incoming.email.receivedAt
        )
          fields.email.receivedAt = incoming.email.receivedAt;
      }
      if (
        found.application &&
        fields.application &&
        (found.application.recordId
          ? found.application.recordId === fields.application.recordId
          : found.application.rowKey === fields.application.rowKey) &&
        found.application.expectedNext !== fields.application.expectedNext
      )
        fields.application = {
          ...fields.application,
          expectedNext: found.application.expectedNext,
        };
      // Completion freezes the request that the workspace owner confirmed, even if a reminder changes its wording.
      if (found.state !== "open") {
        if (!found.email) found.email = incoming.email;
        else if (
          found.email.messageId === incoming.email.messageId &&
          !found.email.receivedAt &&
          incoming.email.receivedAt
        )
          found.email.receivedAt = incoming.email.receivedAt;
        continue;
      }
      if (
        Object.entries(fields).some(
          ([key, value]) =>
            JSON.stringify(found![key as keyof InboxAction]) !==
            JSON.stringify(value),
        )
      ) {
        const previousActivity =
          found.activity?.id ?? found.email?.messageId ?? found.id;
        if (fields.activity && fields.activity.id !== previousActivity) {
          found.recruitingEvents ??= [];
          found.recruitingEvents.push({
            id: `action:${found.id}:activity:${fields.activity.id}`,
            kind: "requested",
            at: fields.activity.at,
            title: fields.text,
            description: fields.explanation ?? fields.text,
            email: fields.email.url,
          });
        }
        Object.assign(found, fields, {
          revision: found.revision + 1,
          updatedAt: now,
        });
        if (fields.activity && fields.activity.id !== previousActivity) {
          found.pendingCheckKind ??= "updated";
          if (batch.scope === "quick") found.pendingQuickKind ??= "updated";
        }
      }
    } else
      doc.actions.push({
        ...fields,
        deadline: fields.deadline ?? undefined,
        reviewReason: fields.reviewReason ?? undefined,
        completionSuggestion: fields.completionSuggestion ?? undefined,
        pendingCheckKind: "new",
        ...(batch.scope === "quick"
          ? { pendingQuickKind: "new" as const }
          : {}),
        recruitingEvents: [
          {
            id: `request:${externalKey}`,
            kind: "requested",
            at: incoming.email.receivedAt ?? now,
            title: incoming.text,
            description: incoming.explanation ?? incoming.text,
            email: incoming.email.url,
          },
        ],
        id: randomUUID(),
        externalKeys: [externalKey],
        revision: 1,
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
  }
  for (const retired of batch.retire) {
    const action = doc.actions.find((a) => a.id === retired.id);
    if (!action) {
      if (doc.dismissed.some((a) => a.id === retired.id)) continue;
      throw new NotFoundError("Action to retire was not found");
    }
    if (action.state === "open")
      Object.assign(action, {
        state: "superseded",
        resolvedAt: now,
        resolution: {
          source: "email",
          reason: retired.reason,
          evidenceMessageId: retired.evidenceMessageId,
        },
        resolvedReason: `${retired.reason} (message ${retired.evidenceMessageId})`,
        revision: action.revision + 1,
        updatedAt: now,
      });
  }
}

export async function completeAction(id: string, revision: number) {
  await freshEdit((doc) => {
    const action = doc.actions.find((a) => a.id === id);
    if (!action) throw new NotFoundError("Action not found");
    if (action.state === "completed") return;
    if (action.state !== "open" || action.revision !== revision)
      throw new ConflictError(
        "This action changed. Refresh and review it before completing it.",
      );
    const now = new Date().toISOString();
    Object.assign(action, {
      recruitingEvents: [
        ...(action.recruitingEvents ?? []),
        {
          id: `action:${action.id}:completed:${action.revision}`,
          kind: "completed",
          at: now,
          title: `${action.text} — Completed`,
          description: action.explanation ?? action.text,
          email: action.email?.url,
        },
      ],
      state: "completed",
      completedAt: now,
      updatedAt: now,
      revision: action.revision + 1,
      pendingNextClear: !!action.application?.expectedNext,
    });
  });
  return retryPendingNextClears();
}

/** Durable completion comes first. Tracker cleanup is idempotent and retries on a later sync/completion. */
export async function retryPendingNextClears() {
  for (const action of readActions().actions.filter(
    (a) => a.state === "completed" && a.pendingNextClear && a.application,
  )) {
    let warning: string | undefined;
    try {
      const apps = await readApplications();
      if (apps.readOnly) throw new Error(apps.readOnly.reason);
      const ref = action.application!;
      const matches = apps.rows.filter((r) =>
        ref.recordId ? r.recordId === ref.recordId : r.key === ref.rowKey,
      );
      if (matches.length > 1) throw new Error("Application match is ambiguous");
      const row = matches[0];
      // The file hash also guards the read/check/write interval against another writer.
      if (row && ref.expectedNext && row.next === ref.expectedNext)
        await updateRow(apps.fileHash, row.key, { next: "" }, localToday());
    } catch (e) {
      warning = `Completed; tracker Next could not sync: ${e instanceof Error ? e.message : "try again"}`;
    }
    await freshEdit((doc) => {
      const current = doc.actions.find((a) => a.id === action.id);
      if (current) {
        current.pendingNextClear = !!warning;
        current.syncWarning = warning;
      }
    });
  }
  return readActions();
}

/** UI-only mutations cannot be submitted by agent sync. */
export async function changeAction(
  id: string,
  revision: number,
  change: {
    dismiss?: boolean;
    reason?: string;
    hidden?: boolean;
    viewedActivityId?: string;
    dismissNew?: boolean;
    remove?: boolean;
    keepCompleted?: string;
  },
) {
  if (change.keepCompleted) {
    const { readRecruiting } = await import("./recruiting");
    if (
      !readRecruiting().events.some(
        (e) =>
          e.id === change.keepCompleted &&
          e.taskId === id &&
          e.evidenceRole === "contradiction",
      )
    )
      throw new ConflictError(
        "Review evidence changed; refresh before resolving",
      );
  }
  return freshEdit((doc) => {
    const a = doc.actions.find((a) => a.id === id);
    if (!a) throw new NotFoundError("Action not found");
    if (a.revision !== revision)
      throw new ConflictError("Action changed; refresh before editing");
    if (change.hidden !== undefined) {
      if (a.state !== "completed")
        throw new ConflictError("Only completed tasks can be hidden");
      a.hidden = change.hidden;
    }
    if (change.dismissNew)
      a.dismissedNewActivityId = a.activity?.id ?? a.email?.messageId ?? a.id;
    if (change.viewedActivityId) a.viewedActivityId = change.viewedActivityId;
    if (change.keepCompleted) {
      a.dismissedSuggestions = [
        ...new Set([...(a.dismissedSuggestions ?? []), change.keepCompleted]),
      ];
    }
    if (change.remove) {
      if (a.state !== "open")
        throw new ConflictError("Completed tasks must be preserved");
      a.state = "superseded";
      a.resolvedAt = new Date().toISOString();
      a.resolution = { source: "user", reason: "Dismissed / No longer needed" };
      a.revision++;
      a.updatedAt = a.resolvedAt;
      return;
    }
    if (change.dismiss) {
      const identity = a.completionSuggestion?.identity;
      if (identity) {
        a.dismissedSuggestions = [
          ...new Set([
            ...(a.dismissedSuggestions ?? []),
            ...(a.dismissedSuggestion ? [a.dismissedSuggestion] : []),
            identity,
          ]),
        ];
        a.dismissedSuggestion = identity;
      }
      delete a.completionSuggestion;
    }
    if (change.reason) {
      if (a.state !== "open")
        throw new ConflictError("Action is already resolved");
      a.state = "superseded";
      a.resolvedReason = change.reason;
      a.resolution = { source: "user", reason: change.reason };
      a.resolvedAt = new Date().toISOString();
    }
    a.revision++;
    a.updatedAt = new Date().toISOString();
  });
}

/** Publishing a successful check is separate from individually retryable task upserts. */
export const actionsFinalizationSchema = z
  .object({
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    runId: line,
    startedAt: z.iso.datetime({ offset: true }),
    complete: z.boolean(),
    scope: z.literal("quick").optional(),
    changes: z
      .array(
        z
          .object({
            id: z.uuid(),
            activityId: line,
            kind: z.enum(["new", "updated"]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export async function finalizeActionsCheck(input: unknown) {
  const batch = actionsFinalizationSchema.parse(input);
  return editActions(batch.fileHash, (doc) => {
    if (batch.scope === "quick") {
      if (!batch.complete) return;
      if (Date.parse(batch.startedAt) > Date.now())
        throw new ConflictError("Quick check start cannot be in the future");
      if (
        doc.lastQuickCheck?.runId === batch.runId &&
        Date.parse(doc.lastQuickCheck.startedAt) === Date.parse(batch.startedAt)
      )
        return;
      if (
        doc.lastQuickCheck &&
        (doc.lastQuickCheck.runId === batch.runId ||
          Date.parse(batch.startedAt) <=
            Date.parse(doc.lastQuickCheck.startedAt))
      )
        throw new ConflictError("A newer Quick check was already recorded");
      const newCount = new Set([
        ...batch.changes.filter((c) => c.kind === "new").map((c) => c.id),
        ...doc.actions
          .filter((a) => a.state === "open" && a.pendingQuickKind === "new")
          .map((a) => a.id),
      ]).size;
      const changes = new Map((doc.quickChanges ?? []).map((c) => [c.id, c]));
      for (const c of batch.changes) {
        const a = doc.actions.find((a) => a.id === c.id);
        if (
          !a ||
          a.state !== "open" ||
          (a.activity?.id ?? a.email?.messageId ?? a.id) !== c.activityId
        )
          throw new ConflictError(
            "Check activity changed; re-read tasks before finalizing",
          );
        const previous =
          changes.get(c.id) ??
          doc.lastCheck?.changes.find((x) => x.id === c.id);
        changes.set(c.id, {
          ...c,
          kind: previous?.kind === "new" ? "new" : c.kind,
        });
      }
      // Recover Quick-only work even if a prior upsert succeeded but its caller
      // lost the response. Do not sweep unrelated Daily pending discoveries.
      for (const a of doc.actions) {
        if (a.state === "open" && a.pendingQuickKind) {
          const activityId = a.activity?.id ?? a.email?.messageId ?? a.id;
          const previous =
            changes.get(a.id) ??
            doc.lastCheck?.changes.find((c) => c.id === a.id);
          changes.set(a.id, {
            id: a.id,
            activityId,
            kind: previous?.kind === "new" ? "new" : a.pendingQuickKind,
          });
        }
        delete a.pendingQuickKind;
      }
      if (changes.size) doc.quickChanges = [...changes.values()];
      doc.lastQuickCheck = {
        runId: batch.runId,
        startedAt: batch.startedAt,
        completedAt: new Date().toISOString(),
        summary: summarizeCheck(
          readRecruiting().events,
          batch.startedAt,
          new Date().toISOString(),
          newCount,
          readRecruiting().workflows,
        ),
      };
      return;
    }
    if (!batch.complete) {
      if (
        doc.lastCheck &&
        Date.parse(batch.startedAt) <= Date.parse(doc.lastCheck.startedAt)
      )
        return;
      doc.lastIncompleteAt = new Date().toISOString();
      return;
    }
    if (
      doc.lastCheck?.runId === batch.runId &&
      Date.parse(doc.lastCheck.startedAt) === Date.parse(batch.startedAt)
    )
      return;
    if (
      doc.lastCheck &&
      (doc.lastCheck.runId === batch.runId ||
        Date.parse(batch.startedAt) <= Date.parse(doc.lastCheck.startedAt))
    )
      throw new ConflictError(
        "A newer check was already published; re-read before finalizing",
      );
    if (doc.actions.some((a) => a.pendingNextClear || a.syncWarning))
      throw new ConflictError(
        "Tracker cleanup is pending; retry before finalizing",
      );
    const seen = new Set<string>();
    const published: typeof batch.changes = [];
    for (const c of batch.changes) {
      const a = doc.actions.find((a) => a.id === c.id);
      if (
        !a ||
        a.state !== "open" ||
        (a.activity?.id ?? a.email?.messageId ?? a.id) !== c.activityId ||
        seen.has(c.id)
      )
        throw new ConflictError(
          "Check activity changed; re-read tasks before finalizing",
        );
      seen.add(c.id);
      if (a.reportedActivityId !== c.activityId) {
        published.push(c);
        a.reportedActivityId = c.activityId;
      }
    }
    // Carry verified work across a failed attempt, even when its caller lost the response.
    for (const a of doc.actions) {
      if (a.state !== "open" || !a.pendingCheckKind) continue;
      const activityId = a.activity?.id ?? a.email?.messageId ?? a.id;
      if (!seen.has(a.id) && a.reportedActivityId !== activityId) {
        published.push({ id: a.id, activityId, kind: a.pendingCheckKind });
        a.reportedActivityId = activityId;
      }
      delete a.pendingCheckKind;
      delete a.pendingQuickKind;
    }
    // A task Quick already reported as new keeps its marker but is not counted twice.
    for (const c of published) {
      if (
        c.kind === "new" &&
        doc.quickChanges?.some(
          (q) =>
            q.id === c.id && q.activityId === c.activityId && q.kind === "new",
        )
      )
        (c as typeof c & { quickReported?: boolean }).quickReported = true;
    }
    doc.lastCheck = {
      runId: batch.runId,
      startedAt: batch.startedAt,
      completedAt: new Date().toISOString(),
      changes: published,
    };
    delete doc.quickChanges;
    delete doc.lastIncompleteAt;
  });
}

/** System closure preserves the original request and never fabricates completion. */
export async function closeApplicationActions(
  row: import("./types").ApplicationRow,
  reason: string,
  at: string,
) {
  const { applicationFor } = await import("./recruitingTypes");
  const { rows } = await readApplications();
  if (
    !readActions().actions.some(
      (a) =>
        a.state === "open" &&
        a.application &&
        applicationFor(a.application, rows)?.key === row.key,
    )
  )
    return;
  return freshEdit((doc) => {
    for (const a of doc.actions) {
      if (
        a.state !== "open" ||
        !a.application ||
        applicationFor(a.application, rows)?.key !== row.key
      )
        continue;
      a.state = "superseded";
      a.resolvedAt = new Date(at).toISOString();
      a.resolution = { source: "system", reason };
      a.resolvedReason = reason;
      a.revision++;
      a.updatedAt = new Date().toISOString();
    }
  });
}
export async function correctOpenAction(
  id: string,
  revision: number,
  row: import("./types").ApplicationRow,
  applicationsHash: string,
  roleOverride?: string,
  publicLinkOverride?: string,
) {
  return freshEdit((doc) => {
    const a = doc.actions.find((a) => a.id === id);
    if (!a || a.state !== "open" || a.revision !== revision)
      throw new ConflictError("Action changed; refresh before editing");
    if (
      sha256(
        fs.readFileSync(resolveExpected("records/applications.md"), "utf8"),
      ) !== applicationsHash
    )
      throw new ConflictError("Applications changed; refresh before editing");
    const sameApplication =
      a.application?.rowKey === row.key ||
      (!!row.recordId && row.recordId === a.application?.recordId);
    if (!sameApplication) {
      delete a.pendingNextClear;
      delete a.publicLink;
    }
    a.application = {
      rowKey: row.key,
      recordId: row.recordId || undefined,
      expectedNext: sameApplication ? a.application?.expectedNext : undefined,
    };
    a.company = row.company;
    a.role = row.role;
    a.applicationConfirmed = true;
    a.roleOverride = roleOverride;
    a.publicLinkOverride = publicLinkOverride;
    a.revision++;
    a.updatedAt = new Date().toISOString();
  });
}

/**
 * One-off and repair path: label open actions with a category without touching revisions
 * (the label is display metadata, so open pages stay valid). Non-open actions are skipped.
 */
export async function setActionCategories(
  labels: { id: string; category: (typeof ACTION_CATEGORIES)[number] }[],
) {
  const byId = new Map(labels.map((l) => [l.id, l.category]));
  return freshEdit((doc) => {
    for (const a of doc.actions)
      if (a.state === "open" && byId.has(a.id)) a.category = byId.get(a.id);
  });
}

export async function associateAction(
  id: string,
  revision: number,
  application: import("./actionTypes").ActionApplication,
) {
  return freshEdit((doc) => {
    const a = doc.actions.find((a) => a.id === id);
    if (!a || a.revision !== revision)
      throw new ConflictError("Task changed; refresh before linking");
    if (a.application) throw new ConflictError("Task already linked");
    a.application = application;
    a.revision++;
    a.updatedAt = new Date().toISOString();
  });
}

/** Group visibility is UI-owned; hiding history never changes task state. */
/** Points task and hidden-group references at an application's new row key after it was edited. */
export async function rekeyActionReferences(
  oldKey: string,
  newKey: string,
  recordId: string,
) {
  if (!fs.existsSync(actionPath())) return;
  const stale = (ref?: { rowKey: string; recordId?: string }) =>
    !!ref &&
    ref.rowKey === oldKey &&
    (!ref.recordId || ref.recordId === recordId);
  const snapshot = readActions();
  if (
    !snapshot.actions.some((a) => stale(a.application)) &&
    !snapshot.hiddenGroups?.some(
      (g) => "application" in g && stale(g.application),
    )
  )
    return;
  await freshEdit((doc) => {
    const move = (ref?: { rowKey: string; recordId?: string }) => {
      if (!ref || !stale(ref)) return;
      ref.rowKey = newKey;
      ref.recordId = recordId;
    };
    for (const action of doc.actions) move(action.application);
    for (const group of doc.hiddenGroups ?? [])
      if ("application" in group) move(group.application);
  });
}

/**
 * Permanently deletes one application's (or one unlinked task's) action history. The tracker row,
 * saved reviews and application-level recruiting events stay. Each removed request keeps a
 * dismissal tombstone so a later check never re-creates it.
 */
export async function deleteActionGroup(input: unknown) {
  const request = z
    .object({
      fileHash: z.string().regex(/^[a-f0-9]{64}$/),
      group: actionGroupSchema,
    })
    .strict()
    .parse(input);
  const rows = (await readApplications()).rows;
  const target =
    "application" in request.group
      ? applicationFor(request.group.application, rows)
      : null;
  if ("application" in request.group && !target)
    throw new ConflictError(
      "Application changed; refresh before deleting history",
    );
  const belongs = (a: InboxAction) =>
    "actionId" in request.group
      ? a.id === request.group.actionId &&
        (!a.application || !applicationFor(a.application, rows))
      : !!a.application &&
        applicationFor(a.application, rows)?.key === target?.key;
  const removed: InboxAction[] = [];
  await editActions(request.fileHash, (doc) => {
    removed.push(
      ...doc.actions.filter(
        (a) =>
          belongs(a) &&
          !(a.state === "superseded" && a.resolution?.source === "user"),
      ),
    );
    if (!removed.length) throw new NotFoundError("Action group not found");
    doc.actions = doc.actions.filter(
      (a) => !removed.some((r) => r.id === a.id),
    );
    doc.dismissed ??= [];
    for (const task of removed)
      doc.dismissed.push({ id: task.id, externalKeys: task.externalKeys });
    doc.hiddenGroups = (doc.hiddenGroups ?? []).filter((g) =>
      "actionId" in g
        ? !(
            "actionId" in request.group && g.actionId === request.group.actionId
          )
        : !(target && applicationFor(g.application, rows)?.key === target.key),
    );
  });
  const { removeTaskEvents, reconcileRecruiting } =
    await import("./recruiting");
  await removeTaskEvents(
    removed.map((task) => task.id),
    removed.flatMap((task) => task.externalKeys),
  );
  await reconcileRecruiting();
  return readActions();
}

/**
 * Acknowledge New/Updated markers once the Actions page has shown them. Each item names the activity
 * that was on screen, so a newer activity that arrived meanwhile stays New. This is view state only:
 * it does not bump task revisions, so cards that are open for editing keep working.
 */
export async function markActionsSeen(input: unknown) {
  const { items } = z
    .object({
      operation: z.literal("seen-new"),
      items: z
        .array(z.object({ id: z.uuid(), activityId: line }).strict())
        .min(1)
        .max(500),
    })
    .strict()
    .parse(input);
  return freshEdit((doc) => {
    for (const item of items) {
      const a = doc.actions.find((a) => a.id === item.id);
      if (!a || a.state !== "open") continue;
      if ((a.activity?.id ?? a.email?.messageId ?? a.id) !== item.activityId)
        continue;
      a.dismissedNewActivityId = item.activityId;
    }
  });
}

export async function changeGroupVisibility(input: unknown) {
  const request = z
    .object({
      fileHash: z.string().regex(/^[a-f0-9]{64}$/),
      group: actionGroupSchema,
      hidden: z.boolean(),
    })
    .strict()
    .parse(input);
  const rows = (await readApplications()).rows;
  const target =
    "application" in request.group
      ? applicationFor(request.group.application, rows)
      : null;
  if ("application" in request.group && !target)
    throw new ConflictError(
      "Application changed; refresh before hiding history",
    );
  const belongs = (a: InboxAction) =>
    "actionId" in request.group
      ? a.id === request.group.actionId &&
        (!a.application || !applicationFor(a.application, rows))
      : !!a.application &&
        applicationFor(a.application, rows)?.key === target?.key;
  return editActions(request.fileHash, (doc) => {
    if (!doc.actions.some(belongs))
      throw new NotFoundError("Action group not found");
    doc.hiddenGroups = (doc.hiddenGroups ?? []).filter((g) =>
      "actionId" in g
        ? !(
            "actionId" in request.group && g.actionId === request.group.actionId
          )
        : !(target && applicationFor(g.application, rows)?.key === target.key),
    );
    if (request.hidden) doc.hiddenGroups.push(request.group);
    else
      for (const action of doc.actions.filter(belongs)) {
        if (action.hidden) {
          action.hidden = false;
          action.revision++;
        }
      }
  });
}

export async function transitionCompletedActions(input: unknown) {
  const { tasks, operation } = z
    .object({
      tasks: z
        .array(
          z
            .object({ id: z.uuid(), revision: z.number().int().positive() })
            .strict(),
        )
        .min(1),
      operation: z.enum(["uncomplete", "close"]),
    })
    .strict()
    .parse(input);
  const rows = operation === "close" ? (await readApplications()).rows : [];
  const result = await freshEdit((doc) => {
    const now = new Date().toISOString();
    for (const ref of tasks) {
      const task = doc.actions.find((a) => a.id === ref.id);
      if (
        !task ||
        task.revision !== ref.revision ||
        task.state !== "completed" ||
        task.manuallyClosedAt
      )
        throw new ConflictError(
          "Completed actions changed; refresh before editing",
        );
      if (operation === "close") {
        if (task.application && !applicationFor(task.application, rows))
          throw new ConflictError(
            "The linked Tracker application could not be identified",
          );
        task.pendingTrackerRejection = task.application ? true : undefined;
        task.manuallyClosedAt = now;
        task.hidden = false;
        doc.hiddenGroups = doc.hiddenGroups?.filter((group) =>
          "actionId" in group
            ? group.actionId !== task.id
            : !task.application ||
              (group.application.rowKey !== task.application.rowKey &&
                (!task.application.recordId ||
                  group.application.recordId !== task.application.recordId)),
        );
      } else {
        task.state = "open";
        delete task.completedAt;
        delete task.hidden;
        delete task.pendingNextClear;
        delete task.syncWarning;
      }
      task.revision++;
      task.updatedAt = now;
    }
  });
  return operation === "close" ? retryTrackerRejections() : result;
}

// The saved intent lets a refresh finish the Tracker update if a write was interrupted.
export async function retryTrackerRejections(
  onItemError?: (message: string) => void,
) {
  const snapshot = readActions();
  const pending = snapshot.actions.filter(
    (task) => task.pendingTrackerRejection,
  );
  if (!pending.length) return snapshot;
  for (const task of pending) {
    try {
      const apps = await readApplications();
      const row =
        task.application && applicationFor(task.application, apps.rows);
      if (!row)
        throw new ConflictError(
          "The linked Tracker application could not be identified",
        );
      // Closing a completed task means the process got somewhere before it
      // ended, so the application is Unsuccessful rather than a plain rejection.
      if (row.status.trim().toLowerCase() !== "unsuccessful")
        await updateRow(
          apps.fileHash,
          row.key,
          { status: "unsuccessful" },
          localToday(),
        );
      await freshEdit((doc) => {
        const current = doc.actions.find((a) => a.id === task.id);
        if (current?.manuallyClosedAt === task.manuallyClosedAt && current)
          delete current.pendingTrackerRejection;
      });
    } catch (e) {
      if (!onItemError) throw e;
      onItemError(e instanceof Error ? e.message : String(e));
    }
  }
  return readActions();
}

/** Delete only the selected history category; keep Tracker rows and request tombstones. */
export async function deleteHistoryCategory(input: unknown) {
  const request = z
    .object({
      fileHash: z.string().regex(/^[a-f0-9]{64}$/),
      category: z.enum(["closed", "dismissed", "archived"]),
      id: z.uuid().optional(),
    })
    .strict()
    .parse(input);
  const rows = (await readApplications()).rows;
  const { readRecruiting, removeTaskEvents, reconcileRecruiting } =
    await import("./recruiting");
  const recruiting = readRecruiting();
  const removed: InboxAction[] = [];
  const { closedTimes, isArchivedClosure } =
    await import("./recruitingPresentation");
  await editActions(request.fileHash, (doc) => {
    doc.dismissed ??= [];
    const closed = closedTimes(doc.actions, rows, recruiting.workflows);
    const now = new Date();
    const select = (a: InboxAction) => {
      if (request.id && a.id !== request.id) return false;
      const dismissed =
        a.state === "superseded" && a.resolution?.source === "user";
      if (request.category === "dismissed") return dismissed;
      const row = a.application && applicationFor(a.application, rows);
      // Closed and "ready to delete" are one population split by age.
      const archived = isArchivedClosure(closed.get(a.id), now);
      if ((request.category === "archived") !== archived) return false;
      return (
        !dismissed &&
        !!(
          a.manuallyClosedAt ||
          (row &&
            (isClosedStatus(row.status) ||
              recruiting.workflows.some(
                (w) => applicationFor(w, rows)?.key === row.key && w.closure,
              )))
        )
      );
    };
    removed.push(...doc.actions.filter(select));
    if (request.id && !removed.length)
      throw new ConflictError("History changed; refresh before deleting");
    doc.actions = doc.actions.filter((a) => !select(a));
    for (const a of removed)
      doc.dismissed.push({ id: a.id, externalKeys: a.externalKeys });
  });
  await removeTaskEvents(
    removed.map((a) => a.id),
    removed.flatMap((a) => a.externalKeys),
  );
  await reconcileRecruiting();
  return readActions();
}
