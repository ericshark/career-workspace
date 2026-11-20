import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-workflow-"));
  fs.mkdirSync(path.join(root, "records"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
const at = "2026-11-02T12:00:00Z";
it("deduplicates discovery and preserves successful checkpoint on partial runs", async () => {
  fs.writeFileSync(path.join(root, "records/inbox-last-check"), "1793371792\n");
  const { readMailSync, syncMail } = await import("@/lib/mailSync");
  const previous = readMailSync().inboxAt;
  const d = {
    messageId: "m",
    threadId: "t",
    url: "https://mail.google.com/mail/u/0/#all/t",
    receivedAt: at,
    kind: "first-request",
    summary: "Reply",
  };
  await syncMail({
    mode: "inbox",
    complete: false,
    startedAt: at,
    discoveries: [d, d],
  });
  expect(readMailSync().discoveries).toHaveLength(1);
  expect(readMailSync().inboxAt).toBe(previous);
  await expect(
    syncMail({
      mode: "actions",
      complete: true,
      startedAt: at,
      acknowledge: ["missing"],
    }),
  ).rejects.toThrow();
  expect(readMailSync().actionsAt).toBeUndefined();
  await syncMail({ mode: "inbox", complete: true, startedAt: at });
  expect(readMailSync().inboxAt).toBe(at);
});
it("protects UI-owned fields and dismissed completion evidence", async () => {
  const { syncActions, readActions, changeAction } =
    await import("@/lib/actions");
  const task = {
    externalKey: "gmail:t:ask",
    text: "Reply",
    email: {
      threadId: "t",
      messageId: "m",
      url: "https://mail.google.com/mail/u/0/#all/t",
    },
    completionSuggestion: {
      identity: "sent:ask",
      reason: "Answered",
      messageId: "sent",
      url: "https://mail.google.com/mail/u/0/#all/t",
      at,
    },
  };
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  let a = readActions().actions[0];
  await changeAction(a.id, a.revision, { dismissNew: true });
  a = readActions().actions[0];
  await changeAction(a.id, a.revision, { dismiss: true });
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  a = readActions().actions[0];
  expect(a.dismissedNewActivityId).toBeDefined();
  expect(a.completionSuggestion).toBeUndefined();
  await changeAction(a.id, a.revision, { reason: "Not required" });
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  expect(readActions().actions).toHaveLength(1);
  expect(readActions().actions[0].state).toBe("superseded");
  expect(readActions().actions[0].dismissedNewActivityId).toBeDefined();
  expect(readActions().dismissed).toHaveLength(0);
});
it("uses 21 calendar days and substantive interaction dates", async () => {
  const { awaitingResponse } = await import("@/lib/maintenance");
  expect(awaitingResponse("2026-10-12", undefined, "2026-11-01")).toBe(false);
  expect(awaitingResponse("2026-10-12", undefined, "2026-11-02")).toBe(true);
  expect(awaitingResponse("2026-10-12", at, "2026-11-02")).toBe(false);
});
it("saves linked research and rendered Markdown", async () => {
  const { saveOpportunity, listOpportunities } =
    await import("@/lib/opportunities");
  const r = await saveOpportunity({
    opportunityKey: "job",
    fingerprint: "request",
    company: "Example",
    role: "Engineer",
    receivedAt: at,
    researchedAt: at,
    depth: "full",
    complete: true,
    verdict: "Prioritize",
    markdown: "Proceed",
    sources: [],
  });
  expect(listOpportunities()[0].id).toBe(r.id);
  expect(
    fs.readFileSync(
      path.join(root, `records/opportunities/${r.id}.md`),
      "utf8",
    ),
  ).toContain("Proceed");
});
it("selects fresh opportunities by fingerprint, depth and New York day", async () => {
  const { saveOpportunity, selectOpportunities } =
    await import("@/lib/opportunities");
  const candidate = {
    opportunityKey: "job",
    fingerprint: "v1",
    receivedAt: at,
  };
  await saveOpportunity({
    ...candidate,
    company: "Example",
    role: "Engineer",
    researchedAt: at,
    depth: "triage",
    complete: true,
    verdict: "Give It a Try",
    markdown: "Verify pay",
    sources: [],
  });
  expect(selectOpportunities([candidate], "since", "full")).toHaveLength(1);
  expect(selectOpportunities([candidate], "since", "triage")).toHaveLength(0);
  expect(
    selectOpportunities(
      [{ ...candidate, fingerprint: "v2" }],
      "since",
      "triage",
    ),
  ).toHaveLength(1);
  expect(
    selectOpportunities([candidate], "today", "full", new Date(at)),
  ).toHaveLength(1);
});
it("ages only applied rows and preserves date, notes and recent employer activity", async () => {
  const { APPLICATIONS_HEADER } = await import("@/lib/types");
  const rows = [
    ["Old", "applied"],
    ["Rejected", "rejected"],
    ["Interview", "in progress"],
    ["Recent", "applied"],
  ].map(
    ([company, status]) =>
      `| 2026-10-01 | ${company} | Engineer | tech | tech | | | Other | ${status} | Keep my note | | |`,
  );
  fs.writeFileSync(
    path.join(root, "records/applications.md"),
    `${APPLICATIONS_HEADER}\n|${Array(12).fill("---").join("|")}|\n${rows.join("\n")}\n`,
  );
  const { readApplications } = await import("@/lib/applications");
  const recent = (await readApplications()).rows.find(
    (r) => r.company === "Recent",
  )!;
  const { syncMail } = await import("@/lib/mailSync");
  await syncMail({
    mode: "inbox",
    complete: false,
    startedAt: at,
    interactions: { [recent.key]: at },
  });
  const { ageApplications } = await import("@/lib/maintenance");
  await ageApplications(new Date(at));
  const after = (await readApplications()).rows;
  expect(after.find((r) => r.company === "Old")).toMatchObject({
    status: "no response",
    date: "2026-10-01",
    next: "Keep my note",
  });
  expect(after.find((r) => r.company === "Recent")?.status).toBe("applied");
  expect(after.find((r) => r.company === "Rejected")?.status).toBe("rejected");
  expect(after.find((r) => r.company === "Interview")?.status).toBe(
    "in progress",
  );
});

it("repairs rendered reports on an identical retry without duplicating history", async () => {
  const { saveOpportunity, listOpportunities } =
    await import("@/lib/opportunities");
  const input = {
    opportunityKey: "job",
    fingerprint: "v1",
    company: "Example",
    role: "Engineer",
    receivedAt: at,
    researchedAt: at,
    depth: "full",
    complete: true,
    verdict: "Prioritize",
    markdown: "Proceed",
    sources: [],
  };
  const first = await saveOpportunity(input);
  fs.unlinkSync(path.join(root, `records/opportunities/${first.id}.md`));
  const retry = await saveOpportunity(input);
  expect(retry.id).toBe(first.id);
  expect(listOpportunities()).toHaveLength(1);
  expect(
    fs.existsSync(path.join(root, `records/opportunities/${first.id}.md`)),
  ).toBe(true);
});
it("tracks viewing a specific activity without hiding a newer update", async () => {
  const { syncActions, readActions, changeAction } =
    await import("@/lib/actions");
  const { isUnreadAction } = await import("@/lib/actionTypes");
  const task = {
    externalKey: "gmail:t:ask",
    text: "Reply",
    email: {
      threadId: "t",
      messageId: "original",
      url: "https://mail.google.com/mail/u/0/#all/t",
    },
    activity: { id: "first", at, type: "first-request" },
  };
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  let a = readActions().actions[0];
  expect(isUnreadAction(a)).toBe(true);
  await changeAction(a.id, a.revision, { viewedActivityId: "first" });
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  a = readActions().actions[0];
  expect(isUnreadAction(a)).toBe(false);
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [{ ...task, activity: { id: "next", at, type: "follow-up" } }],
  });
  a = readActions().actions[0];
  await changeAction(a.id, a.revision, { viewedActivityId: "first" });
  expect(isUnreadAction(readActions().actions[0])).toBe(true);
  await changeAction(a.id, readActions().actions[0].revision, { remove: true });
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  expect(readActions().actions).toHaveLength(1);
  expect(readActions().actions[0].state).toBe("superseded");
  expect(readActions().actions[0].email).toEqual(task.email);
  expect(readActions().actions[0].resolution?.source).toBe("user");
  expect(readActions().dismissed).toHaveLength(0);
});
it("publishes only successful latest check membership, including empty runs", async () => {
  const { syncActions, readActions, finalizeActionsCheck } =
    await import("@/lib/actions");
  const { latestCheckChange } = await import("@/lib/actionTypes");
  const task = {
    externalKey: "gmail:t:ask",
    text: "Reply",
    email: {
      threadId: "t",
      messageId: "m",
      url: "https://mail.google.com/mail/u/0/#all/t",
    },
  };
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  const a = readActions().actions[0];
  expect(latestCheckChange(a, readActions())).toBeUndefined();
  await finalizeActionsCheck({
    fileHash: readActions().fileHash,
    runId: "run1",
    startedAt: at,
    complete: true,
    changes: [{ id: a.id, activityId: "m", kind: "new" }],
  });
  expect(latestCheckChange(a, readActions())?.kind).toBe("new");
  await finalizeActionsCheck({
    fileHash: readActions().fileHash,
    runId: "partial",
    startedAt: "2026-11-03T12:00:00Z",
    complete: false,
  });
  expect(readActions().lastCheck?.runId).toBe("run1");
  await expect(
    finalizeActionsCheck({
      fileHash: readActions().fileHash,
      runId: "wrong",
      startedAt: "2026-11-03T12:00:00Z",
      complete: true,
      changes: [{ id: a.id, activityId: "stale", kind: "updated" }],
    }),
  ).rejects.toThrow();
  expect(readActions().lastCheck?.runId).toBe("run1");
  await finalizeActionsCheck({
    fileHash: readActions().fileHash,
    runId: "empty",
    startedAt: "2026-11-04T12:00:00Z",
    complete: true,
    changes: [],
  });
  expect(latestCheckChange(a, readActions())).toBeUndefined();
  await expect(
    finalizeActionsCheck({
      fileHash: readActions().fileHash,
      runId: "old",
      startedAt: at,
      complete: true,
      changes: [{ id: a.id, activityId: "m", kind: "new" }],
    }),
  ).rejects.toThrow(/newer check/);
  expect(readActions().lastCheck?.runId).toBe("empty");
});
it("excludes the deliberately reviewed source application while preserving separate matches", async () => {
  const { APPLICATIONS_HEADER } = await import("@/lib/types");
  fs.writeFileSync(
    path.join(root, "records/applications.md"),
    `${APPLICATIONS_HEADER}\n|${Array(12).fill("---").join("|")}|\n| 2026-10-01 | Example | Engineer | tech | tech | | | LinkedIn | applied | | https://example.com/jobs/1 | source-record |\n| 2026-10-02 | Example | Engineer | tech | tech | | | LinkedIn | applied | | https://example.com/jobs/1 | other-record |\n`,
  );
  const { checkDuplicates } = await import("@/lib/dupCheck");
  const found = checkDuplicates(
    {
      link: "https://example.com/jobs/1",
      company: "Example",
      role: "Engineer",
    },
    "source-record",
  );
  expect(found.exact).toHaveLength(1);
  expect(found.exact[0].recordId).toBe("other-record");
});
it("excludes a selected legacy row by its key without excluding a different application", async () => {
  const { APPLICATIONS_HEADER } = await import("@/lib/types");
  fs.writeFileSync(
    path.join(root, "records/applications.md"),
    `${APPLICATIONS_HEADER}\n|${Array(12).fill("---").join("|")}|\n| 2026-10-01 | Example | Engineer | tech | tech | | | LinkedIn | applied | | https://example.com/jobs/1 | |\n| 2026-10-02 | Example | Engineer | tech | tech | | | LinkedIn | applied | | https://example.com/jobs/1 | |\n`,
  );
  const { readApplications } = await import("@/lib/applications");
  const first = (await readApplications()).rows[0];
  const { checkDuplicates } = await import("@/lib/dupCheck");
  expect(
    checkDuplicates(
      { link: "https://example.com/jobs/1" },
      "source-record",
      first.key,
    ).exact,
  ).toHaveLength(1);
});
it("hides completed history reversibly without changing completion or allowing agent overrides", async () => {
  const { syncActions, readActions, changeAction, completeAction } =
    await import("@/lib/actions");
  const task = {
    externalKey: "gmail:h:ask",
    text: "Reply",
    email: {
      threadId: "h",
      messageId: "m",
      url: "https://mail.google.com/mail/u/0/#all/h",
    },
  };
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  let a = readActions().actions[0];
  await expect(
    changeAction(a.id, a.revision, { hidden: true }),
  ).rejects.toThrow();
  await completeAction(a.id, a.revision);
  a = readActions().actions[0];
  const at = a.completedAt;
  await changeAction(a.id, a.revision, { hidden: true });
  await syncActions({
    fileHash: readActions().fileHash,
    complete: true,
    actions: [task],
  });
  a = readActions().actions[0];
  expect(a.hidden).toBe(true);
  expect(a.completedAt).toBe(at);
  await changeAction(a.id, a.revision, { hidden: false });
  expect(readActions().actions[0]).toMatchObject({
    hidden: false,
    state: "completed",
    completedAt: at,
  });
});

it("recovers unpublished changes and retries finalization then acknowledgment safely", async () => {
  const a = await import("@/lib/actions");
  const m = await import("@/lib/mailSync");
  const discovery = {
    messageId: "m",
    threadId: "t",
    url: "https://mail.google.com/mail/u/0/#all/t",
    receivedAt: at,
    kind: "first-request",
    summary: "Reply",
  };
  await m.syncMail({
    mode: "inbox",
    complete: true,
    startedAt: at,
    discoveries: [discovery],
  });
  const handoff = {
    mode: "actions",
    complete: true,
    startedAt: at,
    runId: "recovery",
    acknowledge: ["m"],
  };
  await expect(m.syncMail(handoff)).rejects.toThrow(/Finalize/);
  expect(m.readMailSync().discoveries[0].acknowledgedAt).toBeUndefined();
  await a.syncActions({
    fileHash: a.readActions().fileHash,
    complete: false,
    actions: [
      {
        externalKey: "gmail:t:reply",
        text: "Reply",
        email: discoveryToEmail(discovery),
      },
    ],
  });
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "failed",
    startedAt: at,
    complete: false,
  });
  expect(a.readActions().lastCheck).toBeUndefined();
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "recovery",
    startedAt: at,
    complete: true,
    changes: [],
  });
  expect(a.readActions().lastCheck?.changes).toHaveLength(1);
  const published = a.readActions().lastCheck;
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "recovery",
    startedAt: at,
    complete: true,
    changes: [],
  });
  expect(a.readActions().lastCheck).toEqual(published);
  await m.syncMail(handoff);
  const acknowledged = m.readMailSync().discoveries[0].acknowledgedAt;
  await m.syncMail(handoff);
  expect(m.readMailSync()).toMatchObject({ actionsAt: at, inboxAt: at });
  expect(m.readMailSync().discoveries[0].acknowledgedAt).toBe(acknowledged);
});

function discoveryToEmail(d: {
  threadId: string;
  messageId: string;
  url: string;
  receivedAt: string;
}) {
  const { threadId, messageId, url, receivedAt } = d;
  return { threadId, messageId, url, receivedAt };
}

it("merges concurrent mail handoffs and compares offset instants chronologically", async () => {
  const { syncMail, readMailSync } = await import("@/lib/mailSync");
  const make = (id: string) => ({
    messageId: id,
    threadId: id,
    url: `https://mail.google.com/mail/u/0/#all/${id}`,
    receivedAt: at,
    kind: "follow-up",
    summary: "Follow up",
  });
  await Promise.all(
    ["a", "b", "c"].map((id) =>
      syncMail({
        mode: "inbox",
        complete: false,
        startedAt: at,
        discoveries: [make(id)],
      }),
    ),
  );
  expect(readMailSync().discoveries).toHaveLength(3);
  await syncMail({
    mode: "inbox",
    complete: true,
    startedAt: "2026-11-02T10:00:00-05:00",
    interactions: { app: "2026-11-02T10:00:00-05:00" },
  });
  await syncMail({
    mode: "inbox",
    complete: true,
    startedAt: "2026-11-02T14:00:00Z",
    interactions: { app: "2026-11-02T14:00:00Z" },
  });
  expect(readMailSync().inboxAt).toBe("2026-11-02T10:00:00-05:00");
  expect(readMailSync().interactions.app).toBe("2026-11-02T10:00:00-05:00");
  await expect(
    syncMail({
      mode: "actions",
      complete: false,
      startedAt: at,
      discoveries: [make("d")],
    }),
  ).rejects.toThrow(/cannot write/);
});

it("retains all dismissed evidence and does not publish metadata-only legacy promotion", async () => {
  const a = await import("@/lib/actions");
  const task = {
    externalKey: "gmail:t:ask",
    text: "Reply",
    email: {
      threadId: "t",
      messageId: "original",
      url: "https://mail.google.com/mail/u/0/#all/t",
    },
  };
  const evidence = (identity: string) => ({
    identity,
    messageId: identity,
    reason: "Answered",
    url: task.email.url,
    at,
  });
  for (const identity of ["one", "two"]) {
    await a.syncActions({
      fileHash: a.readActions().fileHash,
      complete: false,
      actions: [{ ...task, completionSuggestion: evidence(identity) }],
    });
    const saved = a.readActions().actions[0];
    await a.changeAction(saved.id, saved.revision, { dismiss: true });
  }
  await a.syncActions({
    fileHash: a.readActions().fileHash,
    complete: false,
    actions: [{ ...task, completionSuggestion: evidence("one") }],
  });
  expect(a.readActions().actions[0].completionSuggestion).toBeUndefined();
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "publish",
    startedAt: at,
    complete: true,
  });
  const saved = a.readActions().actions[0];
  await a.syncActions({
    fileHash: a.readActions().fileHash,
    complete: true,
    actions: [{ ...task, explanation: "Metadata only" }],
  });
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "metadata",
    startedAt: "2026-11-03T12:00:00Z",
    complete: true,
  });
  expect(a.readActions().lastCheck?.changes).toEqual([]);
  await a.syncActions({
    fileHash: a.readActions().fileHash,
    complete: false,
    actions: [{ ...task, activity: { id: "meaningful", at } }],
  });
  const snapshot = a.readActions();
  await a.changeAction(saved.id, snapshot.actions[0].revision, {
    dismissNew: true,
  });
  await expect(
    a.finalizeActionsCheck({
      fileHash: snapshot.fileHash,
      runId: "stale",
      startedAt: "2026-11-04T12:00:00Z",
      complete: true,
    }),
  ).rejects.toThrow(/changed/);
  expect(a.readActions().lastCheck?.runId).toBe("metadata");
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "recover-update",
    startedAt: "2026-11-04T12:00:00Z",
    complete: true,
  });
  expect(a.readActions().lastCheck?.changes).toEqual([
    { id: saved.id, activityId: "meaningful", kind: "updated" },
  ]);
});

it("previews without persistence and Quick preserves Daily recovery and adds indicators", async () => {
  const a = await import("@/lib/actions");
  const { latestCheckChange } = await import("@/lib/actionTypes");
  const task = {
    externalKey: "gmail:t:reply",
    text: "Reply",
    email: {
      threadId: "t",
      messageId: "m",
      url: "https://mail.google.com/mail/u/0/#all/t",
    },
  };
  const batch = {
    fileHash: a.readActions().fileHash,
    complete: true,
    scope: "quick",
    actions: [task],
  };
  expect(a.previewActions(batch).actions).toHaveLength(1);
  expect(fs.existsSync(path.join(root, "records/actions.json"))).toBe(false);
  await a.syncActions(batch);
  const saved = a.readActions();
  const change = { id: saved.actions[0].id, activityId: "m", kind: "new" };
  await a.finalizeActionsCheck({
    fileHash: saved.fileHash,
    complete: true,
    scope: "quick",
    runId: "quick",
    startedAt: at,
    changes: [change],
  });
  expect(a.readActions().lastCheck).toBeUndefined();
  expect(a.readActions().actions[0].pendingCheckKind).toBe("new");
  expect(a.readActions().lastQuickCheck?.summary?.newActions).toBe(1);
  expect(
    latestCheckChange(a.readActions().actions[0], a.readActions())?.kind,
  ).toBe("new");
  expect(fs.existsSync(path.join(root, "records/mail-sync.json"))).toBe(false);
  await a.syncActions({ ...batch, fileHash: a.readActions().fileHash });
  expect(a.readActions().actions).toHaveLength(1);
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    complete: true,
    runId: "daily",
    startedAt: at,
    changes: [],
  });
  expect(a.readActions().quickChanges).toBeUndefined();
  // Daily republishes Quick's task for its marker but flags it so it is not counted twice.
  expect(a.readActions().lastCheck?.changes).toEqual([
    { ...change, quickReported: true },
  ]);
});

it("records empty Quick success separately, preserves it through Daily, and ignores partial attempts", async () => {
  const a = await import("@/lib/actions");
  const quick = async (runId: string, startedAt: string, complete = true) =>
    a.finalizeActionsCheck({
      fileHash: a.readActions().fileHash,
      runId,
      startedAt,
      complete,
      scope: "quick",
      changes: [],
    });
  await quick("quick", at);
  const previous = a.readActions().lastQuickCheck;
  expect(previous?.runId).toBe("quick");
  expect(a.readActions().lastCheck).toBeUndefined();
  expect(a.readActions().quickChanges).toBeUndefined();
  await quick("quick", at);
  expect(a.readActions().lastQuickCheck?.summary?.newActions).toBe(0);
  expect(a.readActions().lastQuickCheck).toEqual(previous);
  await quick("failed", "2026-11-02T13:00:00Z", false);
  expect(a.readActions().lastQuickCheck).toEqual(previous);
  await expect(quick("stale", "2026-11-02T11:00:00Z")).rejects.toThrow(
    /newer Quick/,
  );
  await a.finalizeActionsCheck({
    fileHash: a.readActions().fileHash,
    runId: "daily",
    startedAt: "2026-11-02T14:00:00Z",
    complete: true,
    changes: [],
  });
  expect(a.readActions().lastQuickCheck).toEqual(previous);
  expect(a.readActions().lastCheck?.runId).toBe("daily");
  expect(fs.existsSync(path.join(root, "records/mail-sync.json"))).toBe(false);
});
