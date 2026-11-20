import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  appointmentState,
  currentAppointments,
  isAheadAppointment,
} from "@/lib/recruitingTypes";
let root: string;
let service: typeof import("@/lib/recruiting");
let apps: typeof import("@/lib/applications");
let tasks: typeof import("@/lib/actions");
const now = new Date("2026-11-03T17:00:00Z");
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-lifecycle-"));
  fs.mkdirSync(path.join(root, "records"));
  fs.copyFileSync(
    path.join(import.meta.dirname, "fixtures/applications.one-row.md"),
    path.join(root, "records/applications.md"),
  );
  vi.stubEnv("CAREER_ROOT", root);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.resetModules();
  service = await import("@/lib/recruiting");
  apps = await import("@/lib/applications");
  tasks = await import("@/lib/actions");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
async function row() {
  return (await apps.readApplications()).rows[0];
}
async function task(text = "Complete assessment") {
  const r = await row();
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: true,
    actions: [
      {
        externalKey: "gmail:thread:assessment",
        text,
        application: { rowKey: r.key },
        email: {
          threadId: "thread",
          messageId: "request",
          url: "https://mail.google.com/mail/u/0/#all/thread",
          receivedAt: now.toISOString(),
        },
      },
    ],
  });
  return tasks.readActions().actions[0];
}
async function complete(text?: string) {
  const a = await task(text);
  await tasks.completeAction(a.id, a.revision);
  return a;
}
async function event(extra: Record<string, unknown> = {}) {
  const r = await row();
  return {
    id: "message:confirmed",
    applicationKey: r.key,
    kind: "response",
    at: now.toISOString(),
    title: "Assessment received",
    description: "Awaiting next steps",
    responseExpected: true,
    ...extra,
  };
}
it("keeps missing reads pure and refuses corrupt history", () => {
  expect(service.readRecruiting().events).toEqual([]);
  expect(fs.existsSync(path.join(root, "records/recruiting.json"))).toBe(false);
  fs.writeFileSync(path.join(root, "records/recruiting.json"), "broken");
  expect(() => service.readRecruiting()).toThrow();
});
it("deduplicates events and keeps seen state without changing task completion", async () => {
  await complete();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event()],
  });
  let d = await service.reconcileRecruiting();
  expect(d.events.filter((e) => e.id === "message:confirmed")).toHaveLength(1);
  await service.editRecruiting(d.fileHash, [], ["message:confirmed"]);
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event()],
  });
  expect(
    service.readRecruiting().events.find((e) => e.id === "message:confirmed")
      ?.seen,
  ).toBe(true);
  expect(tasks.readActions().actions[0].state).toBe("completed");
});
it("uses ten calendar days and never repeats a dismissed waiting episode", async () => {
  await complete();
  await service.reconcileRecruiting(now);
  let d = await service.reconcileRecruiting(new Date("2026-11-13T17:00:00Z"));
  const suggestion = d.events.find((e) => e.id.startsWith("waiting:"));
  expect(suggestion).toBeDefined();
  // Reminders are a card chip, not a feed entry.
  expect(suggestion!.notify).toBe(false);
  await service.editRecruiting(d.fileHash, [], [suggestion!.id]);
  d = await service.reconcileRecruiting(new Date("2026-11-14T17:00:00Z"));
  expect(d.events.filter((e) => e.id.startsWith("waiting:"))).toHaveLength(1);
  expect(d.events.find((e) => e.id === suggestion!.id)?.seen).toBe(true);
});
it("does not suggest follow-up for scheduling tasks or outstanding work", async () => {
  await complete("Choose interview time");
  let d = await service.reconcileRecruiting(new Date("2026-11-10T17:00:00Z"));
  expect(d.events.some((e) => e.id.startsWith("waiting:"))).toBe(false);
});
it("honors explicit response dates and scheduled interviews", async () => {
  await complete();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      await event({
        responseDue: "2026-11-15T17:00:00Z",
        scheduledAt: "2026-11-14T17:00:00Z",
      }),
    ],
  });
  const d = await service.reconcileRecruiting(new Date("2026-11-10T17:00:00Z"));
  expect(d.events.some((e) => e.id.startsWith("waiting:"))).toBe(false);
});
it("new employer replies retire old suggestions and reset waiting", async () => {
  await complete();
  await service.reconcileRecruiting(new Date("2026-11-08T17:00:00Z"));
  vi.setSystemTime(new Date("2026-11-09T17:00:00Z"));
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event({ at: new Date().toISOString() })],
  });
  const d = await service.reconcileRecruiting();
  expect(d.workflows[0].waitingSince).toBe(new Date().toISOString());
  expect(
    d.events.filter((e) => e.id.startsWith("waiting:")).every((e) => e.seen),
  ).toBe(true);
});
it("closes without completing obsolete requests and retains hidden completion history", async () => {
  const a = await complete();
  await tasks.changeAction(a.id, tasks.readActions().actions[0].revision, {
    hidden: true,
  });
  const r = await row();
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: true,
    actions: [
      {
        externalKey: "gmail:thread:other",
        text: "Reply to recruiter",
        application: { rowKey: r.key },
        email: {
          threadId: "thread",
          messageId: "other",
          url: "https://mail.google.com/mail/u/0/#all/thread",
        },
      },
    ],
  });
  await apps.updateRow(
    (await apps.readApplications()).fileHash,
    r.key,
    { status: "rejected" },
    "2026-11-03",
  );
  const d = await service.reconcileRecruiting();
  expect(d.actions.find((x) => x.id === a.id)).toMatchObject({
    state: "completed",
    hidden: true,
  });
  expect(d.actions.find((x) => x.id !== a.id)).toMatchObject({
    state: "superseded",
    resolution: { source: "system" },
  });
  expect(d.actions.find((x) => x.id !== a.id)?.completedAt).toBeUndefined();
  expect(d.events.filter((e) => e.kind === "rejected")).toHaveLength(1);
  await service.reconcileRecruiting();
  expect(
    service.readRecruiting().events.filter((e) => e.kind === "rejected"),
  ).toHaveLength(1);
});
it("resolves held requests exactly once and preserves source provenance", async () => {
  const r = await row();
  const email = {
    threadId: "thread",
    messageId: "request",
    receivedAt: now.toISOString(),
    url: "https://mail.google.com/mail/u/0/#all/thread",
  };
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    pending: [
      {
        id: "unknown",
        summary: "Assessment requested",
        reason: "Choose role",
        email: "https://mail.google.com/mail/u/0/#all/thread",
        receivedAt: now.toISOString(),
        action: {
          externalKey: "gmail:thread:assessment",
          text: "Complete assessment",
          email,
        },
      },
    ],
  });
  expect(tasks.readActions().actions).toHaveLength(0);
  const input = {
    fileHash: service.readRecruiting().fileHash,
    id: "unknown",
    applicationKey: r.key,
    applicationsHash: (await apps.readApplications()).fileHash,
  };
  const view = await service.resolveRecruiting(input);
  expect(tasks.readActions().actions).toHaveLength(1);
  expect(view.actions[0]).toMatchObject({
    application: { rowKey: r.key },
    company: r.company,
    role: r.role,
    email,
    externalKeys: ["gmail:thread:assessment"],
  });
  expect(view.events).toContainEqual(
    expect.objectContaining({
      id: "request:gmail:thread:assessment",
      applicationKey: r.key,
      at: email.receivedAt,
      email: email.url,
    }),
  );
  expect(view.pending[0].processed).toBe(true);
  await service.resolveRecruiting({
    ...input,
    fileHash: service.readRecruiting().fileHash,
    applicationsHash: (await apps.readApplications()).fileHash,
  });
  expect(tasks.readActions().actions).toHaveLength(1);
  expect(service.readRecruiting().pending[0].processed).toBe(true);
});
it("retries a failed projection without losing the confirmed request or duplicating the card", async () => {
  const initial = await apps.readApplications();
  const key = initial.rows[0].key;
  const active = await apps.updateRow(
    initial.fileHash,
    key,
    { status: "in progress" },
    "2026-11-03",
  );
  const externalKey = "gmail:thread:verify";
  const email = {
    threadId: "thread",
    messageId: "verify",
    url: "https://mail.google.com/mail/u/0/#all/thread",
    receivedAt: now.toISOString(),
  };
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: false,
    requireMatch: true,
    actions: [
      { externalKey, text: "Verify email to submit application", email },
    ],
  });
  expect(tasks.readActions().actions).toHaveLength(0);
  const mailFile = path.join(root, "records/mail-sync.json");
  fs.writeFileSync(mailFile, "invalid");
  await expect(
    service.resolveRecruiting({
      fileHash: service.readRecruiting().fileHash,
      id: externalKey,
      applicationKey: key,
      applicationsHash: active.fileHash,
    }),
  ).rejects.toThrow(SyntaxError);
  const [pending] = service.readRecruiting().pending;
  expect(pending.resolvedKey).toBe(key);
  expect(pending.processed).not.toBe(true);
  expect(pending.action?.email).toEqual(email);
  const [card] = tasks.readActions().actions;
  expect(card.application?.rowKey).toBe(key);
  fs.unlinkSync(mailFile);
  const view = await service.recruitingView();
  expect(view.pending[0].processed).toBe(true);
  expect(view.actions.map((action) => action.id)).toEqual([card.id]);
  expect(
    view.events.filter((event) => event.id === `request:${externalKey}`),
  ).toMatchObject([{ applicationKey: key, at: email.receivedAt }]);
});
it("refuses stale matching and conflicting event provenance atomically", async () => {
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event()],
  });
  const before = fs.readFileSync(
    path.join(root, "records/recruiting.json"),
    "utf8",
  );
  await expect(
    service.syncRecruiting({
      fileHash: service.readRecruiting().fileHash,
      events: [await event({ kind: "rejected" })],
    }),
  ).rejects.toThrow();
  expect(
    fs.readFileSync(path.join(root, "records/recruiting.json"), "utf8"),
  ).toBe(before);
  await expect(
    service.editRecruiting("0".repeat(64), [], ["message:confirmed"]),
  ).rejects.toThrow();
});
it("ages In Progress from observation/status and meaningful activity, never application date", async () => {
  const r = await row();
  await apps.updateRow(
    (await apps.readApplications()).fileHash,
    r.key,
    { status: "in progress" },
    "2026-11-03",
  );
  await complete();
  const { ageApplications } = await import("@/lib/maintenance");
  await ageApplications(now);
  expect((await row()).status).toBe("in progress");
  await ageApplications(new Date("2026-11-23T17:00:00Z"));
  expect((await row()).status).toBe("in progress");
  await ageApplications(new Date("2026-11-24T17:00:00Z"));
  expect((await row()).status).toBe("no response");
  const d = await service.reconcileRecruiting();
  expect(d.workflows[0].closure).toBe("no-response");
});
it("protects active user work from 21-day aging", async () => {
  const r = await row();
  await apps.updateRow(
    (await apps.readApplications()).fileHash,
    r.key,
    { status: "in progress" },
    "2026-11-03",
  );
  await task();
  const { ageApplications } = await import("@/lib/maintenance");
  await ageApplications(new Date("2026-12-03T17:00:00Z"));
  expect((await row()).status).toBe("in progress");
});
it("does not backfill preexisting task events or unrelated historical closure alerts", async () => {
  await complete();
  const file = path.join(root, "records/actions.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const a of saved.actions) {
    delete a.recruitingEvents;
    a.createdAt = "2026-10-01T12:00:00Z";
    a.completedAt = "2026-10-02T12:00:00Z";
  }
  fs.writeFileSync(file, JSON.stringify(saved));
  await service.reconcileRecruiting(now);
  expect(
    service
      .readRecruiting()
      .events.filter((e) => ["requested", "completed"].includes(e.kind)),
  ).toHaveLength(0);
});
it("captures one request/completion and recovers projections from durable task events", async () => {
  await complete();
  let d = await service.reconcileRecruiting();
  expect(d.events.filter((e) => e.kind === "requested")).toHaveLength(1);
  expect(d.events.filter((e) => e.kind === "completed")).toHaveLength(1);
  await service.reconcileRecruiting();
  d = await service.reconcileRecruiting();
  expect(d.events.filter((e) => e.kind === "requested")).toHaveLength(1);
  expect(d.events.filter((e) => e.kind === "completed")).toHaveLength(1);
});
it("holds unmatched safe-mode sync requests instead of creating cards", async () => {
  const action = {
    externalKey: "gmail:thread:unmatched",
    text: "Complete assessment",
    reviewReason: "Multiple roles",
    email: {
      threadId: "thread",
      messageId: "unmatched",
      receivedAt: now.toISOString(),
      url: "https://mail.google.com/mail/u/0/#all/thread",
    },
  };
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: true,
    requireMatch: true,
    actions: [action],
  });
  expect(tasks.readActions().actions).toHaveLength(0);
  expect(service.readRecruiting().pending).toHaveLength(1);
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: true,
    requireMatch: true,
    actions: [action],
  });
  expect(service.readRecruiting().pending).toHaveLength(1);
});
it("never changes a completed identity when a later reminder arrives, but allows a new ask", async () => {
  const a = await complete();
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: true,
    actions: [
      {
        externalKey: "gmail:thread:assessment",
        text: "Reminder",
        email: {
          threadId: "thread",
          messageId: "reminder",
          url: "https://mail.google.com/mail/u/0/#all/thread",
        },
      },
    ],
  });
  expect(tasks.readActions().actions[0].text).toBe(a.text);
  expect(tasks.readActions().actions[0].state).toBe("completed");
  await task("Complete assessment");
  expect(tasks.readActions().actions).toHaveLength(1);
});
it("legacy linkage preserves hidden completion and guards concurrent revisions", async () => {
  const a = await complete();
  const file = path.join(root, "records/actions.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  delete saved.actions[0].application;
  saved.actions[0].hidden = true;
  fs.writeFileSync(file, JSON.stringify(saved));
  const r = await row();
  await service.linkHistoricalAction({
    id: a.id,
    revision: tasks.readActions().actions[0].revision,
    applicationKey: r.key,
    applicationsHash: (await apps.readApplications()).fileHash,
  });
  expect(tasks.readActions().actions[0]).toMatchObject({
    state: "completed",
    hidden: true,
    application: { rowKey: r.key },
  });
  await expect(
    service.linkHistoricalAction({
      id: a.id,
      revision: a.revision,
      applicationKey: r.key,
      applicationsHash: (await apps.readApplications()).fileHash,
    }),
  ).rejects.toThrow();
});
it("Quick rejection closes the workflow without writing tracker status", async () => {
  await task();
  const r = await row();
  const before = fs.readFileSync(
    path.join(root, "records/applications.md"),
    "utf8",
  );
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      await event({
        kind: "rejected",
        title: "Rejected",
        responseExpected: false,
      }),
    ],
  });
  expect(
    fs.readFileSync(path.join(root, "records/applications.md"), "utf8"),
  ).toBe(before);
  const d = await service.reconcileRecruiting();
  expect(d.workflows.find((w) => w.applicationKey === r.key)?.closure).toBe(
    "rejected",
  );
  expect(d.actions[0].state).toBe("superseded");
  expect(d.events.filter((e) => e.kind === "rejected")).toMatchObject([
    { wasInProgress: false },
  ]);
});
it("keeps an In Progress rejection eligible after the tracker closes and the email replays", async () => {
  const setStatus = async (status: "in progress" | "rejected") => {
    const { fileHash, rows } = await apps.readApplications();
    await apps.updateRow(fileHash, rows[0].key, { status }, "2026-11-03");
  };
  await setStatus("in progress");
  const rejection = await event({ kind: "rejected" });
  const sync = () =>
    service.syncRecruiting({
      fileHash: service.readRecruiting().fileHash,
      events: [rejection],
    });
  await sync();
  await setStatus("rejected");
  const d = await sync();
  // Rejected after reaching In progress is stored as Unsuccessful, not plain Rejected.
  expect(d.rows[0].status).toBe("unsuccessful");
  expect(d.events.filter((e) => e.kind === "rejected")).toMatchObject([
    { id: rejection.id, wasInProgress: true },
  ]);
});
it("records a tracker rejection from In Progress even without prior task history", async () => {
  const initial = await apps.readApplications();
  const key = initial.rows[0].key;
  const active = await apps.updateRow(
    initial.fileHash,
    key,
    { status: "in progress" },
    "2026-11-03",
  );
  await apps.updateRow(
    active.fileHash,
    key,
    { status: "rejected" },
    "2026-11-03",
  );
  expect(service.readRecruiting().events).toMatchObject([
    { kind: "rejected", wasInProgress: true },
  ]);
});
it("does not notify for unrelated legacy application aging", async () => {
  const { ageApplications } = await import("@/lib/maintenance");
  await ageApplications(new Date("2026-12-10T17:00:00Z"));
  expect((await row()).status).toBe("no response");
  expect(service.readRecruiting().events).toHaveLength(0);
});
it("identity-only confirmation remains pending until classification can resume", async () => {
  const r = await row();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    pending: [
      {
        id: "needs-evidence",
        summary: "Recruiting mail",
        reason: "Classification requires review",
        email: "https://mail.google.com/mail/u/0/#all/thread",
        receivedAt: now.toISOString(),
      },
    ],
  });
  await service.resolveRecruiting({
    fileHash: service.readRecruiting().fileHash,
    id: "needs-evidence",
    applicationKey: r.key,
    applicationsHash: (await apps.readApplications()).fileHash,
  });
  expect(service.readRecruiting().pending[0].processed).not.toBe(true);
  expect(tasks.readActions().actions).toHaveLength(0);
});
it("lets the workspace owner dismiss a confirmed match that is only waiting for the next check", async () => {
  const r = await row();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    pending: [
      {
        id: "waiting-for-check",
        summary: "Recruiting mail",
        reason: "Classification requires review",
        email: "https://mail.google.com/mail/u/0/#all/thread",
        receivedAt: now.toISOString(),
      },
    ],
  });
  await service.resolveRecruiting({
    fileHash: service.readRecruiting().fileHash,
    id: "waiting-for-check",
    applicationKey: r.key,
    applicationsHash: (await apps.readApplications()).fileHash,
  });
  await service.editRecruiting(
    service.readRecruiting().fileHash,
    [],
    [],
    [],
    ["waiting-for-check"],
  );
  expect(service.readRecruiting().pending[0]).toMatchObject({
    processed: true,
    dismissedAt: expect.any(String),
  });
});
it("confirming a request with advancesStatus:false leaves the application status alone", async () => {
  const r = await row();
  expect(r.status).toBe("applied");
  const email = {
    threadId: "thread-flow",
    messageId: "flow-1",
    receivedAt: now.toISOString(),
    url: "https://mail.google.com/mail/u/0/#all/thread-flow",
  };
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    pending: [
      {
        id: "flow",
        summary: "Application delivery failure",
        reason: "Confirm which application failed",
        email: email.url,
        receivedAt: now.toISOString(),
        action: {
          externalKey: "gmail:thread-flow:finish-application",
          text: "Complete the application on the company site",
          advancesStatus: false,
          email,
        },
      },
    ],
  });
  await service.resolveRecruiting({
    fileHash: service.readRecruiting().fileHash,
    id: "flow",
    applicationKey: r.key,
    applicationsHash: (await apps.readApplications()).fileHash,
  });
  expect(tasks.readActions().actions).toHaveLength(1);
  expect((await row()).status).toBe("applied");
});
it("safe-mode chained preview holds uncertain requests without writing records", async () => {
  const before = service.readRecruiting().fileHash;
  const preview = tasks.previewActions({
    fileHash: tasks.readActions().fileHash,
    complete: true,
    requireMatch: true,
    actions: [
      {
        externalKey: "gmail:thread:uncertain",
        text: "Reply",
        email: {
          threadId: "thread",
          messageId: "uncertain",
          receivedAt: now.toISOString(),
          url: "https://mail.google.com/mail/u/0/#all/thread",
        },
      },
    ],
  });
  expect(preview.actions).toHaveLength(0);
  expect(preview.pendingMatches).toHaveLength(1);
  expect(service.readRecruiting().fileHash).toBe(before);
  expect(fs.existsSync(path.join(root, "records/actions.json"))).toBe(false);
  const next = tasks.previewActions({
    fileHash: preview.fileHash,
    snapshot: preview,
    complete: true,
    requireMatch: true,
    actions: [],
  });
  expect(next.pendingMatches).toHaveLength(1);
});
it("concurrent event batches conflict instead of losing an accepted event", async () => {
  const hash = service.readRecruiting().fileHash;
  const first = await event();
  const results = await Promise.allSettled([
    service.syncRecruiting({ fileHash: hash, events: [first] }),
    service.syncRecruiting({
      fileHash: hash,
      events: [{ ...first, id: "second-message" }],
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    service
      .readRecruiting()
      .events.filter((e) =>
        ["message:confirmed", "second-message"].includes(e.id),
      ),
  ).toHaveLength(1);
});
it("a legacy completed task remains linked after attaching a saved record ID", async () => {
  await complete();
  let d = await service.reconcileRecruiting();
  const r = await row();
  await apps.attachRecordId(
    (await apps.readApplications()).fileHash,
    r.key,
    "12345678-1111-4111-8111-123456789012",
  );
  d = await service.reconcileRecruiting();
  expect(d.workflows).toHaveLength(1);
  expect(d.workflows[0].recordId).toBe("12345678-1111-4111-8111-123456789012");
  expect(d.actions[0].state).toBe("completed");
  expect(d.events.filter((e) => e.kind === "completed")).toHaveLength(1);
});
it("completed interviews expect a reply while completed scheduling does not", () => {
  expect(service.expectsResponse("Attend technical interview")).toBe(true);
  expect(service.expectsResponse("Complete AI voice screening")).toBe(true);
  expect(service.expectsResponse("Choose an interview time")).toBe(false);
  expect(service.expectsResponse("Schedule recruiter screen")).toBe(false);
});
it("a newer scheduling completion preserves the earlier response expectation", async () => {
  await complete();
  vi.setSystemTime(new Date(now.getTime() + 86400000));
  const r = await row();
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: true,
    actions: [
      {
        externalKey: "gmail:thread:scheduling",
        text: "Choose an interview time",
        application: { rowKey: r.key },
        email: {
          threadId: "thread",
          messageId: "schedule",
          url: "https://mail.google.com/mail/u/0/#all/thread",
        },
      },
    ],
  });
  const scheduling = tasks
    .readActions()
    .actions.find((a) => a.state === "open")!;
  await tasks.completeAction(scheduling.id, scheduling.revision);
  const d = await service.reconcileRecruiting(new Date("2026-11-14T17:00:00Z"));
  expect(d.workflows[0].waitingSince).toBe(now.toISOString());
  expect(d.events.some((e) => e.id.startsWith("waiting:"))).toBe(true);
});
it("normalizes offset-qualified closure evidence without losing its source timestamp", async () => {
  await task();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      await event({ kind: "rejected", at: "2026-11-03T12:00:00-05:00" }),
    ],
  });
  expect(tasks.readActions().actions[0].resolvedAt).toBe(
    "2026-11-03T17:00:00.000Z",
  );
  expect(
    service.readRecruiting().events.find((e) => e.id === "message:confirmed")
      ?.at,
  ).toBe("2026-11-03T12:00:00-05:00");
});
it("records submission when a saved tracker application is marked Applied", async () => {
  let r = await row();
  await apps.updateRow(
    (await apps.readApplications()).fileHash,
    r.key,
    { status: "to apply", resume: "tech" },
    "2026-11-03",
  );
  r = await row();
  await apps.updateRow(
    (await apps.readApplications()).fileHash,
    r.key,
    { status: "applied", date: "2026-11-03" },
    "2026-11-03",
  );
  expect(
    service.readRecruiting().events.filter((e) => e.kind === "submitted"),
  ).toHaveLength(1);
  expect(
    service.readRecruiting().events.find((e) => e.kind === "submitted")?.at,
  ).toBe("2026-11-03");
});

it("marks updates read separately from dismissal and preserves both through replay", async () => {
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event()],
  });
  const first = service.readRecruiting();
  await service.editRecruiting(first.fileHash, [], [], ["message:confirmed"]);
  let saved = service
    .readRecruiting()
    .events.find((e) => e.id === "message:confirmed")!;
  expect(saved.viewedAt).toBe(now.toISOString());
  expect(saved.seen).toBe(false);
  expect(saved.discoveredAt).toBe(now.toISOString());
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event()],
  });
  saved = service
    .readRecruiting()
    .events.find((e) => e.id === "message:confirmed")!;
  expect(saved.viewedAt).toBe(now.toISOString());
  await expect(
    service.editRecruiting(first.fileHash, [], [], ["message:confirmed"]),
  ).rejects.toThrow();
  await service.editRecruiting(
    service.readRecruiting().fileHash,
    [],
    ["message:confirmed"],
  );
  expect(
    service.readRecruiting().events.find((e) => e.id === "message:confirmed")
      ?.seen,
  ).toBe(true);
});

it("dismisses an unmatched request durably without creating an application or task", async () => {
  const pending = {
    id: "gmail:unwanted:match",
    company: "Unwanted",
    summary: "Unwanted recruiting request",
    reason: "Unknown company",
    email: "https://mail.google.com/mail/u/0/#all/unwanted",
    receivedAt: now.toISOString(),
  };
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    pending: [pending],
  });
  await service.editRecruiting(
    service.readRecruiting().fileHash,
    [],
    [],
    [],
    [pending.id],
  );
  expect(service.readRecruiting().pending[0].processed).toBe(true);
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    pending: [pending],
  });
  expect(service.readRecruiting().pending[0].dismissedAt).toBe(
    now.toISOString(),
  );
  expect(tasks.readActions().actions).toHaveLength(0);
});

it("honors a dismissed match when a later check can identify the application", async () => {
  const application = await row();
  const action = {
    externalKey: "gmail:thread:screening",
    text: "Schedule a phone screen",
    email: {
      threadId: "thread",
      messageId: "screening",
      receivedAt: now.toISOString(),
      url: "https://mail.google.com/mail/u/0/#all/thread",
    },
  };
  const batch = {
    fileHash: tasks.readActions().fileHash,
    requireMatch: true,
    complete: true,
    actions: [action],
  };
  await tasks.syncActions(batch);
  await service.editRecruiting(
    service.readRecruiting().fileHash,
    [],
    [],
    [],
    [action.externalKey],
  );
  const matched = {
    ...batch,
    fileHash: tasks.readActions().fileHash,
    actions: [{ ...action, application: { rowKey: application.key } }],
  };
  expect(tasks.previewActions(matched).actions).toHaveLength(0);
  await tasks.syncActions(matched);
  expect(tasks.readActions().actions).toHaveLength(0);
});

it("reuses the confirmed application for repeat mail and guards against a conflicting role", async () => {
  const first = await row();
  const second = {
    ...first,
    role: "Engineering Manager",
  };
  const table = path.join(root, "records/applications.md");
  const saved = fs.readFileSync(table, "utf8");
  const original = saved.split("\n").find((line) => line.includes(first.link))!;
  fs.writeFileSync(
    table,
    saved.replace(
      original,
      `${original}\n${original.replace(first.role, second.role).replace(first.link, "https://acme.test/jobs/2")}`,
    ),
  );
  const rows = (await apps.readApplications()).rows;
  expect(rows).toHaveLength(2);
  await task();
  const action = {
    externalKey: "gmail:thread:assessment",
    text: "Complete assessment",
    company: "Agency recruiter",
    email: {
      threadId: "thread",
      messageId: "reminder",
      receivedAt: now.toISOString(),
      url: "https://mail.google.com/mail/u/0/#all/thread",
    },
  };
  const batch = {
    fileHash: tasks.readActions().fileHash,
    requireMatch: true,
    complete: true,
    actions: [action],
  };
  await tasks.syncActions(batch);
  expect(service.readRecruiting().pending).toHaveLength(0);
  const linked = tasks.readActions();
  expect(linked.actions[0]).toMatchObject({
    company: first.company,
    role: first.role,
    application: { rowKey: first.key },
  });
  const other = rows.find((r) => r.role === second.role)!;
  await expect(
    tasks.syncActions({
      ...batch,
      fileHash: linked.fileHash,
      actions: [{ ...action, application: { rowKey: other.key } }],
    }),
  ).rejects.toThrow(/already linked/i);
  expect(tasks.readActions().fileHash).toBe(linked.fileHash);
});

it("uses an explicit earlier response commitment and previews its follow-up without writes", async () => {
  await complete();
  const promised = await event({ responseDue: "2026-11-05T17:00:00Z" });
  const files = [
    "applications.md",
    "actions.json",
    "recruiting.json",
    "mail-sync.json",
  ];
  const bytes = () =>
    files.map((name) => {
      const file = path.join(root, "records", name);
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    });
  const before = bytes();
  const later = new Date("2026-11-16T18:00:00Z");
  const input = {
    fileHash: service.readRecruiting().fileHash,
    events: [promised],
  };
  const preview = await service.previewRecruiting(input, later);
  expect(
    preview.events.filter((e) => e.id.startsWith("waiting:")),
  ).toHaveLength(1);
  // The Dry Run report comes from the preview: the response is one update; the
  // waiting reminder is a card chip, not an Update.
  expect(preview.summary).toEqual({
    newActions: 0,
    newUpdates: 1,
    newRejections: 0,
  });
  expect(bytes()).toEqual(before);
  await service.syncRecruiting(input);
  const actual = await service.reconcileRecruiting(later);
  expect(
    actual.events.filter((e) => e.id.startsWith("waiting:")).map((e) => e.id),
  ).toEqual(
    preview.events.filter((e) => e.id.startsWith("waiting:")).map((e) => e.id),
  );
});

it("starts the follow-up window at the scheduled interview rather than the booking message", async () => {
  const scheduledAt = "2026-11-12T17:00:00Z";
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event({ kind: "interview", scheduledAt })],
  });
  const after = await service.reconcileRecruiting(
    new Date("2026-11-13T17:00:00Z"),
  );
  expect(after.workflows[0].waitingSince).toBe("2026-11-13T05:00:00.000Z");
  expect(after.events.some((e) => e.id.startsWith("waiting:"))).toBe(false);
  const due = await service.reconcileRecruiting(
    new Date("2026-11-23T17:00:00Z"),
  );
  expect(due.events.filter((e) => e.id.startsWith("waiting:"))).toHaveLength(1);
});

it("keeps a conflicting row key and Record ID from linking a different role", async () => {
  const { applicationFor } = await import("@/lib/recruitingTypes");
  const first = { ...(await row()), recordId: "first-role" };
  const second = {
    ...first,
    key: "second-key",
    recordId: "second-role",
    role: "Engineering Manager",
  };
  const rows = [first, second];
  expect(
    applicationFor({ rowKey: first.key, recordId: second.recordId }, rows),
  ).toBeNull();
  expect(
    applicationFor({ rowKey: "old-key", recordId: second.recordId }, rows),
  ).toEqual(second);
});

it("publishes a held Gmail discovery through Daily and resolves it once after reload", async () => {
  const mail = await import("@/lib/mailSync");
  const application = await row();
  const startedAt = now.toISOString();
  const receivedAt = new Date(now.getTime() - 60_000).toISOString();
  const email = {
    threadId: "mockThread",
    messageId: "assessment",
    url: "https://mail.google.com/mail/u/0/#all/mockThread",
    receivedAt,
  };
  const discovery = {
    ...email,
    kind: "uncertain",
    company: application.company,
    summary: "Take the coding assessment",
  };
  const inbox = { mode: "inbox", startedAt, discoveries: [discovery] };
  await mail.syncMail({ ...inbox, complete: false });
  expect(mail.readMailSync().inboxAt).toBeUndefined();
  await mail.syncMail({ ...inbox, complete: true });

  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    requireMatch: true,
    complete: true,
    actions: [
      {
        externalKey: "gmail:mockThread:assessment",
        text: discovery.summary,
        publicLink: { url: "https://acme.test/jobs/1", kind: "job" },
        email,
      },
    ],
  });
  expect(tasks.readActions().actions).toEqual([]);
  const runId = "mock-daily";
  await tasks.finalizeActionsCheck({
    fileHash: tasks.readActions().fileHash,
    runId,
    startedAt,
    complete: true,
  });
  await mail.syncMail({
    mode: "actions",
    startedAt,
    runId,
    complete: true,
    careerCheck: true,
    acknowledge: [email.messageId],
  });

  vi.resetModules();
  const reloaded = await import("@/lib/recruiting");
  const saved = reloaded.readRecruiting();
  expect(saved.pending).toHaveLength(1);
  const resolved = await reloaded.resolveRecruiting({
    fileHash: saved.fileHash,
    applicationsHash: (await apps.readApplications()).fileHash,
    id: saved.pending[0].id,
    applicationKey: application.key,
  });
  expect(resolved.actions).toHaveLength(1);
  expect(resolved.actions[0]).toMatchObject({
    company: application.company,
    role: application.role,
    email,
    publicLink: { url: "https://acme.test/jobs/1", kind: "job" },
  });
  expect(resolved.events.filter((e) => e.kind === "requested")).toHaveLength(1);
  const refreshed = await reloaded.recruitingView();
  expect(refreshed.actions).toHaveLength(1);
  expect(refreshed.events).toEqual(resolved.events);
  expect(mail.readMailSync().lastCareerCheck?.runId).toBe(runId);
});

it("keeps a confirmed action correction across replay and moves only its captured events", async () => {
  const action = await task();
  const original = await row();
  const initial = await apps.readApplications();
  const target = await apps.upsertApplication(
    {
      fileHash: initial.fileHash,
      decision: "later",
      row: {
        company: "Target",
        role: "Engineer",
        lane: "tech",
        resume: "tech",
        fit: null,
        match: null,
        source: "Other",
      },
    },
    "2026-11-03",
  );
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event({ applicationKey: original.key })],
  });
  const input = {
    id: action.id,
    revision: action.revision,
    applicationKey: target.rowKey,
    applicationsHash: target.fileHash,
    roleOverride: "Backend Engineer",
    publicLinkOverride: "https://target.test/careers",
  };
  await expect(
    service.editOpenAction({ ...input, applicationsHash: "stale" }),
  ).rejects.toThrow();
  await service.editOpenAction(input);
  await expect(service.editOpenAction(input)).rejects.toThrow();
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: false,
    requireMatch: true,
    actions: [
      {
        externalKey: action.externalKeys[0],
        text: action.text,
        application: { rowKey: original.key },
        email: action.email,
      },
    ],
  });
  const saved = await service.reconcileRecruiting();
  expect(saved.actions[0]).toMatchObject({
    application: { rowKey: target.rowKey },
    roleOverride: "Backend Engineer",
    publicLinkOverride: "https://target.test/careers",
    email: action.email,
  });
  expect(saved.actions[0].application?.expectedNext).toBeUndefined();
  expect(saved.events.find((e) => e.kind === "requested")?.applicationKey).toBe(
    target.rowKey,
  );
  expect(
    saved.events.find((e) => e.id === "message:confirmed")?.applicationKey,
  ).toBe(original.key);
});

it("reopens completed tasks and can then close them while retaining completion history", async () => {
  const a = await complete();
  const completed = tasks.readActions().actions[0];
  const transition = (operation: string, revision: number) =>
    tasks.transitionCompletedActions({
      operation,
      tasks: [{ id: a.id, revision }],
    });
  await transition("uncomplete", completed.revision);
  const open = tasks.readActions().actions[0];
  expect(open.state).toBe("open");
  expect(open.completedAt).toBeUndefined();
  await expect(transition("close", completed.revision)).rejects.toThrow();
  vi.setSystemTime(new Date(now.getTime() + 60000));
  await tasks.completeAction(a.id, open.revision);
  const done = tasks.readActions().actions[0];
  await transition("close", done.revision);
  expect((await row()).status).toBe("unsuccessful");
  expect(tasks.readActions().actions[0]).toMatchObject({
    state: "completed",
    completedAt: done.completedAt,
    manuallyClosedAt: expect.any(String),
  });
  const projected = await service.reconcileRecruiting();
  expect(projected.events.filter((e) => e.kind === "completed")).toHaveLength(
    2,
  );
});

it("records a manual close as a silent 'Closed by you' event, never a Dashboard update", async () => {
  const a = await complete();
  const done = tasks.readActions().actions[0];
  await tasks.transitionCompletedActions({
    operation: "close",
    tasks: [{ id: a.id, revision: done.revision }],
  });
  const view = await service.reconcileRecruiting();
  const closure = view.events.find((e) => e.id.startsWith("closure:"));
  expect(closure).toMatchObject({
    kind: "rejected",
    title: "Closed by you",
    notify: false,
    seen: true,
  });
  const { activeRecruitingUpdates } = await import("@/lib/checkSummary");
  expect(activeRecruitingUpdates(view.events)).toHaveLength(0);
});

it("deletes one application's action history permanently without touching the tracker row or real news", async () => {
  const a = await complete();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event()],
  });
  const done = tasks.readActions().actions[0];
  await tasks.transitionCompletedActions({
    operation: "close",
    tasks: [{ id: a.id, revision: done.revision }],
  });
  const r = await row();
  const before = await service.reconcileRecruiting();
  expect(before.events.some((e) => e.id.startsWith("request:"))).toBe(true);

  const deleted = await tasks.deleteActionGroup({
    fileHash: tasks.readActions().fileHash,
    group: { application: { rowKey: r.key } },
  });
  expect(deleted.actions).toHaveLength(0);
  expect(deleted.dismissed).toContainEqual({
    id: a.id,
    externalKeys: ["gmail:thread:assessment"],
  });
  const after = service.readRecruiting();
  // Task-derived events are gone; the employer response and the closure remain.
  expect(
    after.events.some(
      (e) => e.id.startsWith("request:") || e.id.startsWith(`action:${a.id}:`),
    ),
  ).toBe(false);
  expect(after.events.some((e) => e.id === "message:confirmed")).toBe(true);
  expect((await row()).key).toBe(r.key);

  // The same request arriving again is ignored because its identity is tombstoned.
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: true,
    actions: [
      {
        externalKey: "gmail:thread:assessment",
        text: "Complete assessment",
        application: { rowKey: r.key },
        email: {
          threadId: "thread",
          messageId: "request",
          url: "https://mail.google.com/mail/u/0/#all/thread",
          receivedAt: now.toISOString(),
        },
      },
    ],
  });
  expect(tasks.readActions().actions).toHaveLength(0);
});

it("editing company, role, link and date keeps tasks, history and found links attached", async () => {
  const before = await row();
  const a = await complete();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event()],
  });
  const { writeFoundLink, readFoundLinks } =
    await import("@/lib/foundLinkStore");
  writeFoundLink(`row:${before.key}`, {
    url: "https://example.com/careers",
    kind: "careers",
  } as never);

  const { fileHash } = await apps.readApplications();
  const out = await apps.updateRow(
    fileHash,
    before.key,
    {
      company: "Renamed Co",
      role: "Staff Engineer",
      link: "https://example.com/jobs/1",
      dateEdit: "2026-11-01",
    },
    "2026-11-03",
  );
  const edited = out.rows[0];
  expect(edited).toMatchObject({
    company: "Renamed Co",
    role: "Staff Engineer",
    link: "https://example.com/jobs/1",
    date: "2026-11-01",
  });
  expect(edited.key).not.toBe(before.key);
  // A row without an ID gets one so every reference can survive the key change.
  expect(edited.recordId).toBeTruthy();

  const task = tasks.readActions().actions.find((x) => x.id === a.id)!;
  expect(task.application).toMatchObject({
    rowKey: edited.key,
    recordId: edited.recordId,
  });
  const recruiting = service.readRecruiting();
  expect(
    recruiting.events.filter((e) => e.applicationKey === before.key),
  ).toHaveLength(0);
  expect(recruiting.events.some((e) => e.applicationKey === edited.key)).toBe(
    true,
  );
  const links = readFoundLinks();
  expect(links[`row:${before.key}`]).toBeUndefined();
  expect(links[`record:${edited.recordId}`]).toBeDefined();
});

it("refuses an edit that would duplicate another application's identity and rejects a future date", async () => {
  const first = await row();
  const { fileHash } = await apps.readApplications();
  await expect(
    apps.updateRow(
      fileHash,
      first.key,
      { dateEdit: "2026-12-25" },
      "2026-11-03",
    ),
  ).rejects.toThrow(/future/);
  await expect(
    apps.updateRow(fileHash, first.key, { link: "not a url" }, "2026-11-03"),
  ).rejects.toThrow();
});

it("links a cross-thread booking to completed scheduling and reconciles later calendar evidence", async () => {
  const action = await complete("Schedule recruiter screen");
  const before = tasks.readActions();
  const booking = await event({
    id: "calendar-confirmation",
    kind: "interview",
    scheduledAt: "2026-11-12T15:40:00Z",
    appointment: { id: "screen", actionId: action.id, sequence: 1 },
    email: "https://mail.google.com/mail/u/0/#all/calendar",
  });
  const sync = async (...events: Record<string, unknown>[]) =>
    service.syncRecruiting({
      fileHash: service.readRecruiting().fileHash,
      events,
    });
  await sync(booking);
  await sync({ ...booking, id: "repeat-confirmation" });
  expect(
    service.readRecruiting().events.some((e) => e.id === "repeat-confirmation"),
  ).toBe(false);
  const corrected = "2026-11-12T16:40:00Z";
  const state = await sync(
    { ...booking, scheduledAt: corrected },
    await event({
      id: "separate-response",
      responseDue: "2026-11-10T15:00:00Z",
    }),
  );
  expect(state.workflows[0].scheduledAt).toBe(corrected);
  expect(state.workflows[0].responseDue).toBe("2026-11-10T15:00:00Z");
  const other = await event({
    id: "second-interview",
    kind: "interview",
    scheduledAt: "2026-11-13T15:40:00Z",
    appointment: { id: "technical" },
  });
  const rescheduled = await sync(other, {
    ...booking,
    id: "reschedule",
    scheduledAt: "2026-11-12T18:00:00Z",
    appointment: { id: "screen", sequence: 2 },
  });
  expect(rescheduled.workflows[0].scheduledAt).toBe("2026-11-12T18:00:00Z");
  expect(
    rescheduled.events.find((e) => e.id === "reschedule")?.appointment
      ?.actionId,
  ).toBe(action.id);
  const cancelled = await sync(
    {
      ...booking,
      id: "cancel",
      scheduledAt: undefined,
      appointment: { id: "screen", sequence: 3, cancelled: true },
    },
    { ...booking, id: "stale-delivery" },
  );
  expect(cancelled.workflows[0].scheduledAt).toBe("2026-11-13T15:40:00Z");
  expect(cancelled.events.find((e) => e.id === "stale-delivery")?.notify).toBe(
    false,
  );
  expect(tasks.readActions().fileHash).toBe(before.fileHash);
});
it("reports an unresolvable confirmed match as a warning instead of failing the view", async () => {
  const initial = await apps.readApplications();
  const key = initial.rows[0].key;
  const active = await apps.updateRow(
    initial.fileHash,
    key,
    { status: "in progress" },
    "2026-11-03",
  );
  const externalKey = "gmail:thread:orphan";
  await tasks.syncActions({
    fileHash: tasks.readActions().fileHash,
    complete: false,
    requireMatch: true,
    actions: [
      {
        externalKey,
        text: "Verify email to submit application",
        email: {
          threadId: "thread",
          messageId: "orphan",
          url: "https://mail.google.com/mail/u/0/#all/thread",
          receivedAt: now.toISOString(),
        },
      },
    ],
  });
  // Leave the confirmed match unprocessed by breaking mail-sync during its first replay.
  const mailFile = path.join(root, "records/mail-sync.json");
  fs.writeFileSync(mailFile, "invalid");
  await expect(
    service.resolveRecruiting({
      fileHash: service.readRecruiting().fileHash,
      id: externalKey,
      applicationKey: key,
      applicationsHash: active.fileHash,
    }),
  ).rejects.toThrow(SyntaxError);
  fs.unlinkSync(mailFile);
  // The application is then removed, so the match can never resolve again.
  await apps.deleteRow(
    (await apps.readApplications()).fileHash,
    key,
    (await apps.readApplications()).rows[0].lineIndex,
  );
  const view = await service.recruitingView();
  expect(view.warnings).toEqual([
    expect.stringContaining("no longer uniquely exists"),
  ]);
  expect(view.pending[0].processed).not.toBe(true);
});
it("ages once per local day on a long-lived server, not only at startup", async () => {
  const r = await row();
  await apps.updateRow(
    (await apps.readApplications()).fileHash,
    r.key,
    { status: "in progress" },
    "2026-11-03",
  );
  await complete();
  const { ageApplicationsOncePerDay } = await import("@/lib/maintenance");
  await ageApplicationsOncePerDay(now);
  expect((await row()).status).toBe("in progress");
  // Same day: a repeat poll does nothing, even if the date arithmetic would now qualify.
  await ageApplicationsOncePerDay(new Date("2026-11-03T20:00:00Z"));
  expect((await row()).status).toBe("in progress");
  // A later day runs the pass again and the 21-day rule applies.
  await ageApplicationsOncePerDay(new Date("2026-11-24T17:00:00Z"));
  expect((await row()).status).toBe("no response");
});
it("keeps the match issue on a held rejection and rejects unknown issues", async () => {
  const held = {
    id: "gmail:decline:rejected",
    summary: "Rejection with no role",
    reason: "Several roles could match",
    email: "https://mail.google.com/mail/u/0/#all/decline",
    receivedAt: "2026-11-02T12:00:00Z",
    matchIssue: "no-role",
  };
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    pending: [held],
  });
  expect(service.readRecruiting().pending[0].matchIssue).toBe("no-role");
  await expect(
    service.syncRecruiting({
      fileHash: service.readRecruiting().fileHash,
      pending: [{ ...held, id: "other", matchIssue: "made-up" }],
    }),
  ).rejects.toThrow();
});

it("retains status transitions through later rejection, polling and identity edits without inventing baseline history", async () => {
  await service.reconcileRecruiting();
  expect(service.readRecruiting().workflows[0].statusHistory).toBeUndefined();
  let r = await row();
  let payload = await apps.readApplications();
  await apps.updateRow(
    payload.fileHash,
    r.key,
    { status: "in progress" },
    "2026-11-03",
    r.lineIndex,
  );
  vi.setSystemTime(new Date("2026-11-04T17:00:00Z"));
  r = await row();
  payload = await apps.readApplications();
  await apps.updateRow(
    payload.fileHash,
    r.key,
    { status: "rejected" },
    "2026-11-04",
    r.lineIndex,
  );
  let w = service.readRecruiting().workflows[0];
  expect(w.statusHistory).toEqual([
    { status: "in progress", at: "2026-11-03T17:00:00.000Z" },
    { status: "unsuccessful", at: "2026-11-04T17:00:00.000Z" },
  ]);
  await service.reconcileRecruiting();
  expect(service.readRecruiting().workflows[0].statusHistory).toEqual(
    w.statusHistory,
  );
  r = await row();
  payload = await apps.readApplications();
  await apps.updateRow(
    payload.fileHash,
    r.key,
    { company: "Renamed" },
    "2026-11-04",
    r.lineIndex,
  );
  const renamed = await row();
  const { applicationFor } = await import("@/lib/recruitingTypes");
  const saved = service.readRecruiting();
  w = saved.workflows.find((item) => applicationFor(item, [renamed]))!;
  expect(w.statusHistory).toHaveLength(2);
  const { trackerSummary } = await import("@/lib/trackerSummary");
  const result = trackerSummary([renamed], saved.workflows, "2026-11-04");
  expect(result.recent["in progress"]).toBe(1);
  expect(result.recent.unsuccessful).toBe(1);
});

it("escalates a dismissed ten-day episode once at eighteen days", async () => {
  await complete("Complete assessment");
  let d = await service.reconcileRecruiting(new Date("2026-11-13T17:00:00Z"));
  const first = d.events.find((e) => e.id.startsWith("waiting:"))!;
  await service.editRecruiting(d.fileHash, [], [first.id]);
  d = await service.reconcileRecruiting(new Date("2026-11-21T17:00:00Z"));
  const escalation = d.events.find((e) => e.id.includes(":18:"))!;
  expect(escalation.title).toContain("18 days");
  await service.editRecruiting(d.fileHash, [], [escalation.id]);
  d = await service.reconcileRecruiting(new Date("2026-11-22T17:00:00Z"));
  expect(d.events.filter((e) => e.id.includes(":18:"))).toHaveLength(1);
  expect(d.events.find((e) => e.id === escalation.id)?.seen).toBe(true);
});

it("preserves an explicit CCAT response expectation across later completion clicks", async () => {
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [await event({ at: "2026-11-02T17:00:00Z" })],
  });
  await complete("Complete the 15-minute CCAT");
  const d = await service.reconcileRecruiting(new Date("2026-11-13T17:00:00Z"));
  expect(d.workflows[0].waitingSince).toBe("2026-11-02T17:00:00Z");
  expect(d.events.some((e) => e.id.startsWith("waiting:"))).toBe(true);
});

it("keeps receipt evidence on its task without publishing an update", async () => {
  const a = await complete();
  const e = await event({
    id: "receipt",
    taskId: a.id,
    evidenceRole: "receipt",
  });
  const d = await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [e],
  });
  expect(d.events.find((e) => e.id === "receipt")).toMatchObject({
    taskId: a.id,
    notify: false,
  });
  expect(d.actions[0].state).toBe("completed");
});

it("keeps contradictory completion under review until the user resolves its exact evidence", async () => {
  const a = await complete();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      await event({
        id: "missing-form",
        taskId: a.id,
        evidenceRole: "contradiction",
        title: "Form not received",
      }),
    ],
  });
  let d = await service.reconcileRecruiting(new Date("2026-11-17T17:00:00Z"));
  expect(d.events.some((e) => e.id.startsWith("waiting:"))).toBe(false);
  expect(d.actions[0].state).toBe("completed");
  await expect(
    tasks.changeAction(a.id, d.actions[0].revision, {
      keepCompleted: "wrong-evidence",
    }),
  ).rejects.toThrow();
  await tasks.changeAction(a.id, d.actions[0].revision, {
    keepCompleted: "missing-form",
  });
  d = await service.reconcileRecruiting(new Date("2026-11-17T17:00:00Z"));
  expect(d.actions[0].dismissedSuggestions).toContain("missing-form");
});

it("validates appointment end times and keeps same-start cancellation evidence", async () => {
  const base = await event({
    id: "booking",
    kind: "interview",
    scheduledAt: "2026-11-10T17:00:00Z",
    scheduledEndAt: "2026-11-10T18:00:00Z",
    appointment: { id: "interview", sequence: 0 },
  });
  await expect(
    service.syncRecruiting({
      fileHash: service.readRecruiting().fileHash,
      events: [{ ...base, scheduledEndAt: "2026-11-10T16:00:00Z" }],
    }),
  ).rejects.toThrow();
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [base],
  });
  const d = await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      {
        ...base,
        id: "cancelled",
        scheduledAt: undefined,
        scheduledEndAt: undefined,
        appointment: { id: "interview", sequence: 1, cancelled: true },
      },
    ],
  });
  expect(d.events.find((e) => e.id === "cancelled")).toBeDefined();
});

it("dismisses an appointment durably without completing its scheduling task", async () => {
  const a = await task("Schedule recruiter interview");
  let d = await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      await event({
        kind: "interview",
        id: "booking",
        scheduledAt: "2026-11-10T17:00:00Z",
        appointment: { id: "meeting", actionId: a.id },
      }),
    ],
  });
  await service.editRecruiting(d.fileHash, [], [], [], [], ["booking"]);
  d = await service.reconcileRecruiting();
  expect(d.events.find((e) => e.id === "booking")?.appointment?.dismissed).toBe(
    true,
  );
  expect(d.actions[0].state).toBe("open");
});

it("deletes dismissed history without removing retained work or tracker rows", async () => {
  const a = await task();
  await tasks.changeAction(a.id, a.revision, { remove: true });
  const before = await row();
  const result = await tasks.deleteHistoryCategory({
    fileHash: tasks.readActions().fileHash,
    category: "dismissed",
    id: a.id,
  });
  expect(result.actions).toHaveLength(0);
  expect(result.dismissed).toContainEqual({
    id: a.id,
    externalKeys: a.externalKeys,
  });
  expect((await row()).key).toBe(before.key);
});

it("refuses to purge active work as closed history", async () => {
  const a = await complete();
  const result = await tasks.deleteHistoryCategory({
    fileHash: tasks.readActions().fileHash,
    category: "closed",
  });
  expect(result.actions.some((t) => t.id === a.id)).toBe(true);
});

it("purges ready-to-delete history only after 14 days, leaving younger Closed history alone", async () => {
  const a = await complete();
  const done = tasks.readActions().actions[0];
  await tasks.transitionCompletedActions({
    operation: "close",
    tasks: [{ id: a.id, revision: done.revision }],
  });
  const purge = (category: "closed" | "archived") =>
    tasks.deleteHistoryCategory({
      fileHash: tasks.readActions().fileHash,
      category,
    });
  // 13 days later the job is still Closed: ready-to-delete has nothing to purge.
  vi.setSystemTime(new Date(now.getTime() + 13 * 86400000));
  expect((await purge("archived")).actions.some((t) => t.id === a.id)).toBe(
    true,
  );
  // At 14 days it has moved, so purging "closed" skips it and "archived" removes it.
  vi.setSystemTime(new Date(now.getTime() + 14 * 86400000));
  expect((await purge("closed")).actions.some((t) => t.id === a.id)).toBe(true);
  const result = await purge("archived");
  expect(result.actions.some((t) => t.id === a.id)).toBe(false);
  expect(result.dismissed?.some((t) => t.id === a.id)).toBe(true);
});

it("shows a time the workspace owner proposed until the employer confirms it, notifying once on confirmation", async () => {
  const action = await complete("Schedule recruiter screen");
  const sync = async (...events: Record<string, unknown>[]) =>
    service.syncRecruiting({
      fileHash: service.readRecruiting().fileHash,
      events,
    });
  const proposal = await event({
    id: "sent-proposal",
    kind: "interview",
    at: "2026-11-03T15:00:00Z",
    title: "Recruiter screen",
    scheduledAt: "2026-11-12T15:00:00Z",
    appointment: { id: "screen", actionId: action.id, proposed: true },
    email: "https://mail.google.com/mail/u/0/#all/sent",
  });
  let state = await sync(proposal);
  const saved = state.events.find((e) => e.id === "sent-proposal")!;
  // the workspace owner's own proposal is not employer news, but it is a commitment that blocks waiting timers.
  expect(saved.notify).toBe(false);
  expect(appointmentState(saved, now)).toBe("Proposed");
  expect(isAheadAppointment(saved, now)).toBe(true);
  expect(state.workflows[0].scheduledAt).toBe("2026-11-12T15:00:00Z");

  // The employer confirms a different time: same appointment, one Update, confirmed time wins.
  state = await sync(
    await event({
      id: "employer-confirmation",
      kind: "interview",
      at: "2026-11-03T16:00:00Z",
      title: "Recruiter screen confirmed",
      scheduledAt: "2026-11-12T16:00:00Z",
      appointment: { id: "screen" },
      email: "https://mail.google.com/mail/u/0/#all/confirm",
    }),
  );
  const confirmed = state.events.find((e) => e.id === "employer-confirmation")!;
  expect(confirmed.notify).toBe(true);
  expect(confirmed.appointment?.actionId).toBe(action.id);
  expect(appointmentState(confirmed, now)).toBe("Upcoming");
  expect(state.workflows[0].scheduledAt).toBe("2026-11-12T16:00:00Z");

  // A later proposal never downgrades the confirmed appointment.
  state = await sync({
    ...proposal,
    id: "late-proposal",
    at: "2026-11-03T16:30:00Z",
    scheduledAt: "2026-11-13T15:00:00Z",
  });
  expect(state.events.some((e) => e.id === "late-proposal")).toBe(false);
  expect(state.workflows[0].scheduledAt).toBe("2026-11-12T16:00:00Z");
});

it("replaces a proposal when the confirmation arrives under a calendar UID", async () => {
  const action = await complete("Schedule recruiter screen");
  const sync = async (...events: Record<string, unknown>[]) =>
    service.syncRecruiting({
      fileHash: service.readRecruiting().fileHash,
      events,
    });
  await sync(
    await event({
      id: "sent-proposal",
      kind: "interview",
      at: "2026-11-03T15:00:00Z",
      title: "Recruiter screen",
      scheduledAt: "2026-11-12T15:00:00Z",
      appointment: { id: "screen", actionId: action.id, proposed: true },
    }),
  );
  const state = await sync(
    await event({
      id: "calendar-invite",
      kind: "interview",
      at: "2026-11-03T16:00:00Z",
      title: "Recruiter screen confirmed",
      scheduledAt: "2026-11-12T16:00:00Z",
      appointment: { id: "uid-123@calendar", actionId: action.id },
    }),
  );
  const proposal = state.events.find((e) => e.id === "sent-proposal")!;
  const confirmed = state.events.find((e) => e.id === "calendar-invite")!;
  expect(proposal.appointment?.replacedBy).toBe("uid-123@calendar");
  expect(appointmentState(proposal, now)).toBe("Replaced");
  expect(isAheadAppointment(proposal, now)).toBe(false);
  expect(confirmed.notify).toBe(true);
  // One appointment remains: the confirmed one.
  expect(
    currentAppointments(state.events).map((e) => e.appointment?.id),
  ).toEqual(["uid-123@calendar"]);
  expect(state.workflows[0].scheduledAt).toBe("2026-11-12T16:00:00Z");
});

it("keeps several open proposals and flags the confirmation when it is unclear which one it answers", async () => {
  await complete("Schedule recruiter screen");
  const sync = async (...events: Record<string, unknown>[]) =>
    service.syncRecruiting({
      fileHash: service.readRecruiting().fileHash,
      events,
    });
  const proposal = (id: string, scheduledAt: string) =>
    event({
      id,
      kind: "interview",
      at: "2026-11-03T15:00:00Z",
      title: "Interview",
      scheduledAt,
      appointment: { id, proposed: true },
    });
  await sync(
    await proposal("first", "2026-11-12T15:00:00Z"),
    await proposal("second", "2026-11-13T15:00:00Z"),
  );
  const state = await sync(
    await event({
      id: "invite",
      kind: "interview",
      at: "2026-11-03T16:00:00Z",
      title: "Interview confirmed",
      description: "Calendar invite",
      scheduledAt: "2026-11-12T15:00:00Z",
      appointment: { id: "uid-9" },
    }),
  );
  expect(state.events.filter((e) => e.appointment?.replacedBy)).toHaveLength(0);
  expect(state.events.find((e) => e.id === "invite")?.description).toMatch(
    /Several proposed times/,
  );
});

it("marks an unconfirmed proposal Not confirmed after its time without starting the waiting clock", async () => {
  const action = await complete("Schedule recruiter screen");
  const state = await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      await event({
        id: "sent-proposal",
        kind: "interview",
        at: "2026-11-03T15:00:00Z",
        title: "Recruiter screen",
        scheduledAt: "2026-11-04T15:00:00Z",
        appointment: { id: "screen", actionId: action.id, proposed: true },
        // A Sent proposal does not itself establish that a reply is owed.
        responseExpected: undefined,
      }),
    ],
  });
  const later = new Date("2026-11-06T12:00:00Z");
  const proposal = state.events.find((e) => e.id === "sent-proposal")!;
  expect(appointmentState(proposal, later)).toBe("Not confirmed");
  expect(isAheadAppointment(proposal, later)).toBe(false);
  vi.setSystemTime(later);
  const projected = await service.reconcileRecruiting(later);
  expect(projected.workflows[0].scheduledAt).toBeUndefined();
  // The scheduling task alone does not start waiting, and the missed proposal is not an interview.
  expect(projected.workflows[0].waitingSince).toBeUndefined();
});

it("confirms a proposal at the same time with one Update", async () => {
  const action = await complete("Schedule recruiter screen");
  const base = {
    kind: "interview",
    title: "Recruiter screen",
    scheduledAt: "2026-11-12T15:00:00Z",
  };
  await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      await event({
        ...base,
        id: "sent-proposal",
        at: "2026-11-03T15:00:00Z",
        appointment: { id: "screen", actionId: action.id, proposed: true },
      }),
    ],
  });
  const state = await service.syncRecruiting({
    fileHash: service.readRecruiting().fileHash,
    events: [
      await event({
        ...base,
        id: "same-time-confirmation",
        at: "2026-11-03T16:00:00Z",
        appointment: { id: "screen" },
      }),
    ],
  });
  expect(
    state.events.find((e) => e.id === "same-time-confirmation")?.notify,
  ).toBe(true);
});
