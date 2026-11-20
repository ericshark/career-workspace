import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
const now = new Date("2026-11-04T15:00:00Z");
const file = (name: string) => path.join(root, "records", name);
const message = {
  messageId: "message",
  threadId: "thread",
  url: "https://mail.google.com/mail/u/0/#all/thread",
  receivedAt: "2026-11-04T14:00:00Z",
  kind: "first-request",
  summary: "Reply with availability",
};
const inboxBatch = (attempt: { leaseId: string; startedAt: string }) => ({
  mode: "inbox",
  leaseId: attempt.leaseId,
  startedAt: attempt.startedAt,
  complete: true,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-journal-"));
  fs.mkdirSync(path.dirname(file("applications.md")));
  fs.copyFileSync(
    path.join(import.meta.dirname, "fixtures/applications.one-row.md"),
    file("applications.md"),
  );
  vi.stubEnv("CAREER_ROOT", root);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("allows only one mode to claim the journal and refuses a stale lease after expiry", async () => {
  const mail = await import("@/lib/mailSync");
  const { LEASE_MS } = await import("@/lib/checkJournal");
  const claims = await Promise.allSettled([
    mail.beginMailCheck({ mode: "daily" }),
    mail.beginMailCheck({ mode: "quick" }),
  ]);
  expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  const first = mail.readMailSync().checkAttempts![0];
  await expect(
    mail.syncMail({ ...inboxBatch(first), leaseId: undefined }),
  ).rejects.toThrow(/running/);
  vi.setSystemTime(now.getTime() + LEASE_MS - 1);
  await mail.heartbeatMailCheck({ leaseId: first.leaseId });
  vi.setSystemTime(now.getTime() + LEASE_MS);
  await expect(mail.beginMailCheck({ mode: "actions" })).rejects.toThrow(
    /running/,
  );
  vi.setSystemTime(now.getTime() + 2 * LEASE_MS);
  const next = await mail.beginMailCheck({ mode: "inbox" });
  expect(next.runId).not.toBe(first.runId);
  expect(mail.readMailSync().checkAttempts?.[0]).toMatchObject({
    status: "failed",
    failure: "interrupted",
  });
  await expect(mail.syncMail(inboxBatch(first))).rejects.toThrow(
    /lease expired or changed/,
  );
  await mail.syncMail(inboxBatch(next));
  expect(mail.readMailSync()).toMatchObject({
    inboxAt: next.startedAt,
    inboxCompletedAt: next.startedAt,
  });
});

it("resumes Daily from the committed Inbox handoff, preserving its original boundary", async () => {
  const mail = await import("@/lib/mailSync");
  const actions = await import("@/lib/actions");
  const first = await mail.beginMailCheck({ mode: "daily" });
  await mail.syncMail({ ...inboxBatch(first), discoveries: [message] });
  await mail.failMailCheck({
    leaseId: first.leaseId,
    failure: "actions-processing",
  });
  vi.setSystemTime(now.getTime() + 60_000);
  const resumed = await mail.beginMailCheck({ mode: "daily" });
  expect(resumed).toMatchObject({
    step: "actions",
    runId: first.runId,
    startedAt: first.startedAt,
  });
  expect(resumed.leaseId).not.toBe(first.leaseId);
  const publish = {
    leaseId: resumed.leaseId,
    fileHash: actions.readActions().fileHash,
  };
  await expect(mail.publishMailCheck(publish)).rejects.toThrow(
    /every pending discovery/,
  );
  expect(actions.readActions().lastCheck).toBeUndefined();
  await mail.publishMailCheck({ ...publish, acknowledge: [message.messageId] });
  const saved = mail.readMailSync();
  expect(saved.actionsAt).toBe(first.startedAt);
  expect(saved.lastCareerCheck?.runId).toBe(first.runId);
  expect(saved.discoveries[0].acknowledgedAt).toBeDefined();
  expect(saved.checkAttempts?.at(-1)?.status).toBe("succeeded");
  expect(
    (await (await import("@/lib/applications")).readApplications()).rows[0]
      .status,
  ).toBe("no response");
});

it("replays a published acknowledgment after an interrupted process without republishing Actions", async () => {
  const mail = await import("@/lib/mailSync");
  const actions = await import("@/lib/actions");
  const first = await mail.beginMailCheck({ mode: "daily" });
  await mail.syncMail({ ...inboxBatch(first), discoveries: [message] });
  const rename = fs.renameSync;
  const fault = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (
      to === file("mail-sync.json") &&
      JSON.parse(fs.readFileSync(from, "utf8")).actionsAt
    )
      throw new Error("injected acknowledgment failure");
    rename(from, to);
  });
  await expect(
    mail.publishMailCheck({
      leaseId: first.leaseId,
      fileHash: actions.readActions().fileHash,
      acknowledge: [message.messageId],
    }),
  ).rejects.toThrow(/injected/);
  fault.mockRestore();
  const finalized = actions.readActions().fileHash;
  expect(mail.readMailSync().actionsAt).toBeUndefined();
  vi.setSystemTime(now.getTime() + 16 * 60_000);
  vi.resetModules();
  const restarted = await import("@/lib/mailSync");
  const resumed = await restarted.beginMailCheck({ mode: "daily" });
  expect(resumed).toMatchObject({ step: "finish", runId: first.runId });
  await restarted.finishMailCheck({ leaseId: resumed.leaseId });
  expect(actions.readActions().fileHash).toBe(finalized);
  expect(restarted.readMailSync().discoveries[0].acknowledgedAt).toBeDefined();
});

it("keeps Quick and standalone Actions successes separate from the Daily checkpoint", async () => {
  const mail = await import("@/lib/mailSync");
  const actions = await import("@/lib/actions");
  const quick = await mail.beginMailCheck({ mode: "quick" });
  await mail.publishMailCheck({
    leaseId: quick.leaseId,
    fileHash: actions.readActions().fileHash,
  });
  expect(mail.readMailSync().actionsAt).toBeUndefined();
  expect(actions.readActions().lastQuickCheck?.runId).toBe(quick.runId);
  vi.setSystemTime(now.getTime() + 60_000);
  const standalone = await mail.beginMailCheck({ mode: "actions" });
  await mail.publishMailCheck({
    leaseId: standalone.leaseId,
    fileHash: actions.readActions().fileHash,
  });
  const saved = mail.readMailSync();
  expect(saved.actionsAt).toBe(standalone.startedAt);
  expect(saved.inboxAt).toBeUndefined();
  expect(saved.lastCareerCheck).toBeUndefined();
});

it("preserves a successful mail handoff when maintenance fails and retries only maintenance", async () => {
  const mail = await import("@/lib/mailSync");
  const actions = await import("@/lib/actions");
  const first = await mail.beginMailCheck({ mode: "daily" });
  await mail.syncMail(inboxBatch(first));
  const rename = fs.renameSync;
  const fault = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (to === file("applications.md"))
      throw new Error("injected maintenance failure");
    rename(from, to);
  });
  await mail.publishMailCheck({
    leaseId: first.leaseId,
    fileHash: actions.readActions().fileHash,
  });
  fault.mockRestore();
  const saved = mail.readMailSync();
  expect(saved.lastCareerCheck?.runId).toBe(first.runId);
  expect(saved.checkAttempts?.at(-1)).toMatchObject({
    stage: "maintenance",
    status: "failed",
    failure: "maintenance",
  });
  vi.setSystemTime(now.getTime() + 60_000);
  const resumed = await mail.beginMailCheck({ mode: "daily" });
  expect(resumed).toMatchObject({ step: "finish", runId: first.runId });
  await mail.finishMailCheck({ leaseId: resumed.leaseId });
  expect(mail.readMailSync().lastCareerCheck).toEqual(saved.lastCareerCheck);
  expect(mail.readMailSync().checkAttempts?.at(-1)?.status).toBe("succeeded");
});

const linkedTask = (key: string, rowKey: string, activityId?: string) => ({
  externalKey: `gmail:thread:${key}`,
  text: "Book a call",
  requestKind: "scheduling",
  advancesStatus: false,
  application: { rowKey },
  ...(activityId
    ? { activity: { id: activityId, at: "2026-11-04T14:30:00Z" } }
    : {}),
  email: {
    threadId: "thread",
    messageId: key,
    url: "https://mail.google.com/mail/u/0/#all/thread",
    receivedAt: "2026-11-04T14:00:00Z",
  },
});

it("counts a No response closure made by Daily maintenance in that Daily's summary", async () => {
  const mail = await import("@/lib/mailSync");
  const actions = await import("@/lib/actions");
  const apps = await import("@/lib/applications");
  const row = (await apps.readApplications()).rows[0];
  const first = await mail.beginMailCheck({ mode: "daily" });
  await mail.syncMail(inboxBatch(first));
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [linkedTask("call", row.key)],
  });
  const saved = actions.readActions().actions[0];
  await actions.completeAction(saved.id, saved.revision);
  await mail.publishMailCheck({
    leaseId: first.leaseId,
    fileHash: actions.readActions().fileHash,
  });
  expect((await apps.readApplications()).rows[0].status).toBe("no response");
  expect(mail.readMailSync().lastCareerCheck?.summary).toMatchObject({
    newUpdates: 1,
  });
});

it("counts a Quick task update without waiting for a UI refresh", async () => {
  const mail = await import("@/lib/mailSync");
  const actions = await import("@/lib/actions");
  const apps = await import("@/lib/applications");
  const row = (await apps.readApplications()).rows[0];
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [linkedTask("call", row.key)],
  });
  const { reconcileRecruiting } = await import("@/lib/recruiting");
  await reconcileRecruiting();
  vi.setSystemTime(now.getTime() + 60_000);
  const quick = await mail.beginMailCheck({ mode: "quick" });
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    scope: "quick",
    actions: [linkedTask("call", row.key, "deadline-changed")],
  });
  await mail.publishMailCheck({
    leaseId: quick.leaseId,
    fileHash: actions.readActions().fileHash,
  });
  expect(actions.readActions().lastQuickCheck?.summary).toEqual({
    newActions: 0,
    newUpdates: 1,
    newRejections: 0,
  });
});

it("uses the completed Inbox scan boundary when aging a Daily resumed on a later day", async () => {
  const mail = await import("@/lib/mailSync");
  const actions = await import("@/lib/actions");
  const apps = await import("@/lib/applications");
  const row = (await apps.readApplications()).rows[0];
  const first = await mail.beginMailCheck({ mode: "daily" });
  await mail.syncMail({
    ...inboxBatch(first),
    interactions: { [row.key]: message.receivedAt },
  });
  await mail.failMailCheck({
    leaseId: first.leaseId,
    failure: "actions-processing",
  });
  vi.setSystemTime(now.getTime() + 22 * 86400000);
  const resumed = await mail.beginMailCheck({ mode: "daily" });
  await mail.publishMailCheck({
    leaseId: resumed.leaseId,
    fileHash: actions.readActions().fileHash,
  });
  expect((await apps.readApplications()).rows[0].status).toBe("applied");
  expect(mail.readMailSync().checkAttempts?.at(-1)?.status).toBe("succeeded");
});
