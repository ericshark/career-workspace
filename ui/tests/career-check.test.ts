import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
const start = "2026-11-01T05:30:00Z"; // Before New York's fall-back hour.
const next = "2026-11-01T07:30:00Z";
const file = (name: string) => path.join(root, "records", name);
const task = (key = "reply") => ({
  externalKey: `gmail:t:${key}`,
  text: "Reply with availability",
  company: "Acme",
  application: { rowKey: "acme-engineer", recordId: "acme" },
  email: {
    threadId: "t",
    messageId: key,
    url: "https://mail.google.com/mail/u/0/#all/t",
    receivedAt: start,
  },
});
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-check-"));
  fs.mkdirSync(path.join(root, "records"));
  fs.writeFileSync(file("applications.md"), "untouched application fixture\n");
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("records Daily only with both stages and acknowledgment, atomically and idempotently", async () => {
  const m = await import("@/lib/mailSync");
  const a = await import("@/lib/actions");
  const ack = {
    mode: "actions",
    runId: "daily",
    startedAt: start,
    complete: true,
    careerCheck: true,
  };
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "daily",
    startedAt: start,
    complete: true,
  });
  expect(m.readMailSync().lastCareerCheck).toBeUndefined();
  await expect(m.syncMail(ack)).rejects.toThrow(/Complete Inbox/);
  expect(m.readMailSync().lastCareerCheck).toBeUndefined();
  await m.syncMail({ mode: "inbox", startedAt: start, complete: true });
  const before = fs.readFileSync(file("mail-sync.json"), "utf8");
  const rename = fs.renameSync;
  const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (to === file("mail-sync.json")) throw new Error("storage failure");
    return rename(from, to);
  });
  await expect(m.syncMail(ack)).rejects.toThrow(/storage failure/);
  expect(fs.readFileSync(file("mail-sync.json"), "utf8")).toBe(before);
  spy.mockRestore();
  await m.syncMail(ack);
  const saved = fs.readFileSync(file("mail-sync.json"), "utf8");
  await m.syncMail(ack);
  expect(fs.readFileSync(file("mail-sync.json"), "utf8")).toBe(saved);
  expect(m.readMailSync().lastCareerCheck?.runId).toBe("daily");
  expect(m.readMailSync().lastCareerCheck?.summary).toEqual({
    newActions: 0,
    newUpdates: 0,
    newRejections: 0,
  });
  expect(m.readMailSync().actionsAt).toBe(start);
  await expect(m.syncMail({ ...ack, complete: false })).rejects.toThrow();
  await expect(m.syncMail({ ...ack, mode: "inbox" })).rejects.toThrow();
});

it("never records Daily with pending discoveries and standalone acknowledgment leaves it absent", async () => {
  const m = await import("@/lib/mailSync");
  const a = await import("@/lib/actions");
  await m.syncMail({
    mode: "inbox",
    startedAt: start,
    complete: true,
    discoveries: [{ ...task().email, kind: "first-request", summary: "Reply" }],
  });
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "daily",
    startedAt: start,
    complete: true,
  });
  await expect(
    m.syncMail({
      mode: "actions",
      runId: "daily",
      startedAt: start,
      complete: true,
      careerCheck: true,
    }),
  ).rejects.toThrow(/Unprocessed/);
  expect(m.readMailSync().lastCareerCheck).toBeUndefined();
  await m.syncMail({
    mode: "actions",
    runId: "daily",
    startedAt: start,
    complete: true,
    acknowledge: ["reply"],
  });
  expect(m.readMailSync().lastCareerCheck).toBeUndefined();
});

it("uses latest successful scan START with overlap across DST and reads without writes", async () => {
  const m = await import("@/lib/mailSync");
  const a = await import("@/lib/actions");
  const initial = m.quickMailWindow({ startedAt: next });
  expect(initial.lowerBound).toBe("2026-10-30T07:30:00.000Z");
  expect(initial.initialCoverage).toBe(true);
  expect(fs.existsSync(file("mail-sync.json"))).toBe(false);
  expect(fs.existsSync(file("actions.json"))).toBe(false);
  // Standalone checkpoints cannot masquerade as combined Daily coverage.
  await m.syncMail({ mode: "inbox", startedAt: start, complete: true });
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "daily",
    startedAt: start,
    complete: true,
  });
  expect(m.quickMailWindow({ startedAt: next }).initialCoverage).toBe(true);
  await m.syncMail({
    mode: "actions",
    runId: "daily",
    startedAt: start,
    complete: true,
    careerCheck: true,
  });
  expect(m.quickMailWindow({ startedAt: next }).lowerBound).toBe(
    "2026-11-01T04:30:00.000Z",
  );
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "quick",
    startedAt: "2026-11-01T06:30:00Z",
    complete: true,
    scope: "quick",
  });
  const mailBefore = fs.readFileSync(file("mail-sync.json"), "utf8");
  const actionsBefore = fs.readFileSync(file("actions.json"), "utf8");
  const window = m.quickMailWindow({ startedAt: next });
  expect(window.lowerBound).toBe("2026-11-01T05:30:00.000Z");
  expect(window.query).toBe(
    `in:anywhere -in:trash -in:drafts after:${Date.parse(start) / 1000} before:${Date.parse(next) / 1000}`,
  );
  expect(fs.readFileSync(file("mail-sync.json"), "utf8")).toBe(mailBefore);
  expect(fs.readFileSync(file("actions.json"), "utf8")).toBe(actionsBefore);
  await expect(
    a.finalizeActionsCheck({
      fileHash: a.readActions().fileHash,
      runId: "failed",
      startedAt: next,
      complete: false,
      scope: "quick",
    }),
  ).resolves.toBeDefined();
  expect(m.quickMailWindow({ startedAt: next })).toEqual(window);
  expect(() => m.quickMailWindow({ startedAt: start })).toThrow(/newer check/);
  expect(() =>
    m.quickMailWindow({ startedAt: "2999-01-01T00:00:00Z" }),
  ).toThrow(/future/);
  const laterDaily = "2026-11-01T08:00:00Z";
  await m.syncMail({ mode: "inbox", startedAt: laterDaily, complete: true });
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "later-daily",
    startedAt: laterDaily,
    complete: true,
  });
  await m.syncMail({
    mode: "actions",
    runId: "later-daily",
    startedAt: laterDaily,
    complete: true,
    careerCheck: true,
  });
  expect(
    m.quickMailWindow({ startedAt: "2026-11-01T08:30:00Z" }).lowerBound,
  ).toBe("2026-11-01T07:00:00.000Z");
});

it("recovers saved Quick findings without unrelated Daily pending tasks or checkpoint changes", async () => {
  const a = await import("@/lib/actions");
  const { latestCheckChange } = await import("@/lib/actionTypes");
  const sync = (scope?: "quick") =>
    a.syncActions({
      fileHash: a.readActions().fileHash,
      complete: false,
      scope,
      actions: [task(scope ?? "daily")],
    });
  await sync();
  await sync("quick"); // Simulate an interruption before publication.
  const before = a.readActions();
  const quick = before.actions.find((x) => x.email?.messageId === "quick")!;
  expect(quick.pendingQuickKind).toBe("new");
  await a.finalizeActionsCheck({
    fileHash: before.fileHash,
    runId: "retry",
    startedAt: next,
    scope: "quick",
    complete: true,
    changes: [],
  });
  let saved = a.readActions();
  expect(saved.quickChanges).toEqual([
    { id: quick.id, activityId: "quick", kind: "new" },
  ]);
  expect(saved.actions.every((x) => !x.pendingQuickKind)).toBe(true);
  expect(saved.actions.every((x) => x.pendingCheckKind === "new")).toBe(true);
  expect(latestCheckChange(quick, saved)?.kind).toBe("new");
  await a.syncActions({
    fileHash: saved.fileHash,
    complete: true,
    scope: "quick",
    actions: [task("quick")],
  });
  saved = a.readActions();
  expect(saved.actions).toHaveLength(2);
  expect(
    saved.actions.find((x) => x.id === quick.id)?.pendingQuickKind,
  ).toBeUndefined();
  await expect(
    a.syncActions({
      fileHash: before.fileHash,
      complete: true,
      scope: "quick",
      actions: [task("other")],
    }),
  ).rejects.toThrow();
  expect(fs.existsSync(file("mail-sync.json"))).toBe(false);
  expect(fs.readFileSync(file("applications.md"), "utf8")).toBe(
    "untouched application fixture\n",
  );
  await a.finalizeActionsCheck({
    fileHash: saved.fileHash,
    runId: "daily",
    startedAt: next,
    complete: true,
  });
  expect(a.readActions().quickChanges).toBeUndefined();
  const published = a.readActions().lastCheck?.changes ?? [];
  expect(published).toHaveLength(2);
  // The Quick task keeps its New marker but is flagged so Daily does not count it again.
  expect(published.find((c) => c.id === quick.id)?.quickReported).toBe(true);
  expect(published.filter((c) => !c.quickReported)).toHaveLength(1);
});

it("counts in Daily only the new tasks that Quick did not already report", async () => {
  const m = await import("@/lib/mailSync");
  const a = await import("@/lib/actions");
  await a.syncActions({
    fileHash: a.readActions().fileHash,
    complete: true,
    scope: "quick",
    actions: [task("quick")],
  });
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "quick",
    startedAt: start,
    scope: "quick",
    complete: true,
  });
  expect(a.readActions().lastQuickCheck?.summary?.newActions).toBe(1);
  await a.syncActions({
    fileHash: a.readActions().fileHash,
    complete: true,
    actions: [task("daily")],
  });
  await m.syncMail({ mode: "inbox", startedAt: next, complete: true });
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "daily",
    startedAt: next,
    complete: true,
  });
  await m.syncMail({
    mode: "actions",
    runId: "daily",
    startedAt: next,
    complete: true,
    careerCheck: true,
  });
  expect(m.readMailSync().lastCareerCheck?.summary?.newActions).toBe(1);
});

it("chains simulated Inbox requests, reminders, and terminal identities without saving", async () => {
  const a = await import("@/lib/actions");
  const base = a.readActions();
  const first = a.previewActions({
    fileHash: base.fileHash,
    complete: true,
    actions: [task()],
  });
  const second = a.previewActions({
    fileHash: base.fileHash,
    snapshot: first,
    complete: true,
    actions: [task(), task("assessment")],
  });
  expect(second.actions).toHaveLength(2);
  expect(second.actions[0].id).toBe(first.actions[0].id);
  const retired = a.previewActions({
    fileHash: base.fileHash,
    snapshot: second,
    complete: true,
    actions: [],
    retire: [
      {
        id: first.actions[0].id,
        reason: "Withdrawn",
        evidenceMessageId: "cancel",
      },
    ],
  });
  const replay = a.previewActions({
    fileHash: base.fileHash,
    snapshot: retired,
    complete: true,
    actions: [task()],
  });
  expect(replay.actions).toHaveLength(2);
  expect(replay.actions.filter((a) => a.state === "open")).toHaveLength(1);
  expect(
    replay.actions.find((a) => a.state === "superseded")?.resolution
      ?.evidenceMessageId,
  ).toBe("cancel");
  expect(replay.dismissed).toHaveLength(0);
  expect(fs.existsSync(file("actions.json"))).toBe(false);
  expect(fs.existsSync(file("mail-sync.json"))).toBe(false);
  expect(fs.readFileSync(file("applications.md"), "utf8")).toBe(
    "untouched application fixture\n",
  );
  await a.syncActions({
    fileHash: base.fileHash,
    complete: true,
    actions: [task()],
  });
  expect(() =>
    a.previewActions({
      fileHash: base.fileHash,
      snapshot: second,
      complete: true,
      actions: [],
    }),
  ).toThrow(/changed/);
});

it("preserves completed tasks and manual fields across chained preview and Quick recovery", async () => {
  const a = await import("@/lib/actions");
  await a.syncActions({
    fileHash: a.readActions().fileHash,
    complete: true,
    actions: [task()],
  });
  const original = a.readActions().actions[0];
  await a.changeAction(original.id, original.revision, { dismissNew: true });
  const overridden = a.readActions().actions[0];
  const base = a.readActions();
  // Priority was removed: a check may no longer send it.
  expect(() =>
    a.previewActions({
      fileHash: base.fileHash,
      complete: true,
      actions: [{ ...task(), priority: "low" }],
    }),
  ).toThrow();
  const preview = a.previewActions({
    fileHash: base.fileHash,
    complete: true,
    actions: [{ ...task(), explanation: "Reply soon" }],
  });
  expect(preview.actions[0].dismissedNewActivityId).toBe(
    overridden.dismissedNewActivityId,
  );
  expect(a.readActions().actions[0]).toEqual(overridden);
  await a.syncActions({
    fileHash: base.fileHash,
    scope: "quick",
    complete: true,
    actions: [task("new")],
  });
  const saved = a.readActions();
  await a.completeAction(
    saved.actions.find((x) => x.email?.messageId === "new")!.id,
    saved.actions.find((x) => x.email?.messageId === "new")!.revision,
  );
  const completed = a.readActions();
  await a.syncActions({
    fileHash: completed.fileHash,
    scope: "quick",
    complete: true,
    actions: [task("new")],
  });
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "quick",
    startedAt: next,
    scope: "quick",
    complete: true,
  });
  expect(
    a.readActions().actions.find((x) => x.email?.messageId === "new")?.state,
  ).toBe("completed");
  expect(a.readActions().quickChanges ?? []).toEqual([]);
  expect(
    a.readActions().actions.find((x) => x.id === original.id)
      ?.dismissedNewActivityId,
  ).toBe(overridden.dismissedNewActivityId);
});
