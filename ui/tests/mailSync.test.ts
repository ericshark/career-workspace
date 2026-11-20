import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
const start = "2026-11-02T12:00:00Z";
const later = "2026-11-02T13:00:00Z";
const discovery = {
  messageId: "request",
  threadId: "conversation",
  url: "https://mail.google.com/mail/u/0/#all/conversation",
  receivedAt: "2026-11-02T11:00:00Z",
  kind: "first-request",
  summary: "Provide interview availability",
};
const batch = {
  mode: "inbox",
  startedAt: start,
  complete: false,
  discoveries: [discovery],
};
const stateFile = () => path.join(root, "records/mail-sync.json");
// Mail's publication gate consumes this persisted Actions contract. Full
// sync/finalization orchestration is covered by recruiting-workflow.test.ts.
function publishedActions(runId: string) {
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: false,
      actions: [],
      lastCheck: { runId, startedAt: later, completedAt: later, changes: [] },
    }),
  );
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-audit-"));
  fs.mkdirSync(path.join(root, "records"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("reads first-run state without creating files and advances an empty successful scan", async () => {
  const { readMailSync, syncMail } = await import("@/lib/mailSync");
  expect(readMailSync()).toEqual({
    version: 1,
    discoveries: [],
    interactions: {},
  });
  expect(fs.existsSync(stateFile())).toBe(false);
  await syncMail({ mode: "inbox", startedAt: start, complete: true });
  expect(readMailSync().inboxAt).toBe(start);
  expect(readMailSync().actionsAt).toBeUndefined();
});

it("imports the legacy checkpoint read-only and fails visibly on corrupt legacy state", async () => {
  const { readMailSync } = await import("@/lib/mailSync");
  const legacy = path.join(root, "records/inbox-last-check");
  fs.writeFileSync(legacy, String(Date.parse(start) / 1000));
  expect(readMailSync().inboxAt).toBe("2026-11-02T12:00:00.000Z");
  expect(fs.existsSync(stateFile())).toBe(false);
  for (const invalid of ["", "invalid", "-1", "1e100"]) {
    fs.writeFileSync(legacy, invalid);
    expect(() => readMailSync()).toThrow(/Invalid legacy/);
    expect(fs.readFileSync(legacy, "utf8")).toBe(invalid);
  }
});

it("retains multiple incoming messages from a previously processed thread and deduplicates overlap", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail({ ...batch, complete: true });
  await syncMail({
    ...batch,
    startedAt: later,
    discoveries: [
      discovery,
      discovery,
      {
        ...discovery,
        messageId: "closure",
        kind: "closed",
        receivedAt: start,
        summary: "Position filled",
      },
    ],
  });
  expect(readMailSync().discoveries.map((d) => d.messageId)).toEqual([
    "request",
    "closure",
  ]);
  expect(readMailSync().inboxAt).toBe(start);
});

it("merges close overlapping runs without losing evidence or regressing checkpoints", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await Promise.all([
    syncMail({ ...batch, complete: true }),
    syncMail({
      ...batch,
      complete: true,
      startedAt: later,
      discoveries: [{ ...discovery, messageId: "second" }],
    }),
  ]);
  await syncMail({ ...batch, complete: true });
  expect(readMailSync().inboxAt).toBe(later);
  expect(readMailSync().discoveries).toHaveLength(2);
});

it("compares interaction/checkpoint instants rather than offset-qualified strings", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail({
    ...batch,
    interactions: { app: "2026-11-02T06:30:00-05:00" },
    complete: true,
  });
  await syncMail({
    ...batch,
    startedAt: "2026-11-02T07:15:00-05:00",
    interactions: { app: "2026-11-02T11:00:00Z" },
    complete: true,
  });
  expect(readMailSync().inboxAt).toBe("2026-11-02T07:15:00-05:00");
  expect(readMailSync().interactions.app).toBe("2026-11-02T06:30:00-05:00");
});

it("retains verified handoff and previous checkpoint on partial progress and safely retries", async () => {
  // External failures are represented by complete:false, not simulated Gmail success.
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail({
    mode: "inbox",
    complete: true,
    startedAt: "2026-11-02T10:00:00Z",
  });
  await syncMail(batch);
  expect(readMailSync().inboxAt).toBe("2026-11-02T10:00:00Z");
  expect(readMailSync().discoveries).toHaveLength(1);
  await syncMail({ ...batch, complete: true });
  expect(readMailSync().inboxAt).toBe(start);
  expect(readMailSync().discoveries).toHaveLength(1);
});

it("does not publish a checkpoint on persistence failure and safely retries", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail(batch);
  const before = fs.readFileSync(stateFile(), "utf8");
  const original = fs.renameSync;
  const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (to === stateFile()) throw new Error("injected storage failure");
    return original(from, to);
  });
  await expect(syncMail({ ...batch, complete: true })).rejects.toThrow(
    /storage failure/,
  );
  expect(fs.readFileSync(stateFile(), "utf8")).toBe(before);
  expect(fs.readdirSync(path.dirname(stateFile()))).toEqual(["mail-sync.json"]);
  expect(fs.existsSync(path.join(root, "ui/.cache/mail-sync.lock"))).toBe(
    false,
  );
  spy.mockRestore();
  await syncMail({ ...batch, complete: true });
  expect(readMailSync().inboxAt).toBe(start);
});

it("preserves corrupt canonical records instead of resetting them", async () => {
  const { syncMail } = await import("@/lib/mailSync");
  for (const corrupt of ['{"version":2}', "broken json"]) {
    fs.writeFileSync(stateFile(), corrupt);
    await expect(syncMail(batch)).rejects.toThrow();
    expect(fs.readFileSync(stateFile(), "utf8")).toBe(corrupt);
  }
});

it("rejects future checkpoints and evidence outside the bounded scan", async () => {
  const { syncMail } = await import("@/lib/mailSync");
  await expect(
    syncMail({ ...batch, startedAt: "2999-01-01T00:00:00Z" }),
  ).rejects.toThrow(/future/);
  await expect(
    syncMail({ ...batch, discoveries: [{ ...discovery, receivedAt: later }] }),
  ).rejects.toThrow(/upper bound/);
  await expect(
    syncMail({ ...batch, interactions: { app: later } }),
  ).rejects.toThrow(/upper bound/);
  expect(fs.existsSync(stateFile())).toBe(false);
});

it("requires successful Actions publication before acknowledging and keeps checkpoints independent", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail({ ...batch, complete: true });
  const actionBatch = {
    mode: "actions",
    complete: true,
    runId: "actions-run",
    startedAt: later,
    acknowledge: [discovery.messageId],
  };
  await expect(syncMail(actionBatch)).rejects.toThrow(/Finalize/);
  await syncMail({ ...actionBatch, complete: false, acknowledge: [] });
  expect(readMailSync().discoveries[0].acknowledgedAt).toBeUndefined();
  publishedActions("actions-run");
  await syncMail(actionBatch);
  const saved = readMailSync();
  expect(saved.inboxAt).toBe(start);
  expect(saved.actionsAt).toBe(later);
  expect(saved.discoveries[0].acknowledgedAt).toBeDefined();
  const before = fs.readFileSync(stateFile(), "utf8");
  const write = vi.spyOn(fs, "renameSync");
  await syncMail(actionBatch);
  await syncMail(batch);
  await syncMail({
    ...batch,
    discoveries: [{ ...discovery, receivedAt: "2026-11-02T06:00:00-05:00" }],
  });
  expect(fs.readFileSync(stateFile(), "utf8")).toBe(before);
  expect(write).not.toHaveBeenCalled();
});

it("requeues corrected discovery classification/matching but preserves provenance", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail({
    ...batch,
    discoveries: [
      { ...discovery, kind: "uncertain", reviewReason: "Unmatched company" },
    ],
  });
  publishedActions("done");
  await syncMail({
    mode: "actions",
    runId: "done",
    startedAt: later,
    complete: true,
    acknowledge: [discovery.messageId],
  });
  await syncMail({
    ...batch,
    discoveries: [{ ...discovery, applicationKey: "verified-app" }],
  });
  expect(readMailSync().discoveries[0]).toEqual({
    ...discovery,
    applicationKey: "verified-app",
  });
  const before = fs.readFileSync(stateFile(), "utf8");
  await expect(
    syncMail({
      ...batch,
      discoveries: [{ ...discovery, threadId: "wrong-thread" }],
    }),
  ).rejects.toThrow(/provenance/);
  await expect(
    syncMail({
      ...batch,
      discoveries: [{ ...discovery, receivedAt: "2026-11-02T10:59:00Z" }],
    }),
  ).rejects.toThrow(/provenance/);
  expect(fs.readFileSync(stateFile(), "utf8")).toBe(before);
});

it("rejects unknown acknowledgments atomically and enforces workflow ownership", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail(batch);
  publishedActions("done");
  await expect(
    syncMail({
      mode: "actions",
      runId: "done",
      startedAt: later,
      complete: true,
      acknowledge: ["request", "missing"],
    }),
  ).rejects.toThrow(/Unknown discovery/);
  expect(readMailSync().discoveries[0].acknowledgedAt).toBeUndefined();
  expect(readMailSync().actionsAt).toBeUndefined();
  await expect(
    syncMail({ ...batch, acknowledge: ["request"] }),
  ).rejects.toThrow(/Inbox cannot/);
  await expect(syncMail({ ...batch, mode: "actions" })).rejects.toThrow(
    /Actions cannot/,
  );
  await expect(
    syncMail({
      ...batch,
      mode: "actions",
      discoveries: [],
      interactions: { app: start },
    }),
  ).rejects.toThrow(/Actions cannot/);
  await expect(
    syncMail({
      ...batch,
      discoveries: [{ ...discovery, url: "https://example.com/mail" }],
    }),
  ).rejects.toThrow();
});

it("partial Actions progress can acknowledge persisted findings while failures stay pending", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail({
    ...batch,
    complete: true,
    discoveries: [discovery, { ...discovery, messageId: "failed" }],
  });
  await syncMail({
    mode: "actions",
    startedAt: later,
    complete: false,
    acknowledge: ["request"],
  });
  const saved = readMailSync();
  expect(
    saved.discoveries.find((d) => d.messageId === "request")?.acknowledgedAt,
  ).toBeDefined();
  expect(
    saved.discoveries.find((d) => d.messageId === "failed")?.acknowledgedAt,
  ).toBeUndefined();
  expect(saved.actionsAt).toBeUndefined();
  expect(saved.inboxAt).toBe(start);
});

it("rejects stale classification overwrites after a newer scan completed", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail(batch);
  const corrected = { ...discovery, applicationKey: "verified-application" };
  await syncMail({
    ...batch,
    startedAt: later,
    complete: true,
    discoveries: [corrected],
  });
  await expect(syncMail(batch)).rejects.toThrow(/newer Inbox Check/);
  expect(readMailSync().discoveries[0]).toEqual(corrected);
  expect(readMailSync().inboxAt).toBe(later);
});

it("leaves evidence/checkpoints unchanged when another process holds the mail lock", async () => {
  const { syncMail } = await import("@/lib/mailSync");
  await syncMail(batch);
  const before = fs.readFileSync(stateFile(), "utf8");
  const lock = path.join(root, "ui/.cache/mail-sync.lock");
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, ts: Date.now(), nonce: "other-writer" }),
  );
  await expect(syncMail({ ...batch, complete: true })).rejects.toThrow(
    /locked/,
  );
  expect(fs.readFileSync(stateFile(), "utf8")).toBe(before);
  expect(JSON.parse(fs.readFileSync(lock, "utf8")).nonce).toBe("other-writer");
});

it("keeps mail from a later scan pending when an older Actions run acknowledges", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  await syncMail({
    ...batch,
    startedAt: later,
    discoveries: [{ ...discovery, receivedAt: later }],
  });
  await expect(
    syncMail({
      mode: "actions",
      startedAt: start,
      complete: false,
      acknowledge: [discovery.messageId],
    }),
  ).rejects.toThrow(/upper bound/);
  expect(readMailSync().discoveries[0].acknowledgedAt).toBeUndefined();
  expect(readMailSync().actionsAt).toBeUndefined();
});
