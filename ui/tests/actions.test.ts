import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionReceivedLabel,
  isActionOverdue,
  sortOpenActions,
} from "@/lib/actionTypes";
import type { InboxAction } from "@/lib/actionTypes";

let root: string;
let actions: typeof import("@/lib/actions");
let apps: typeof import("@/lib/applications");
const email = {
  threadId: "abc123",
  messageId: "msg1",
  url: "https://mail.google.com/mail/u/0/#all/abc123",
};
const task = {
  externalKey: "gmail:abc123:assessment",
  text: "Complete assessment",
  email,
};
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-actions-"));
  fs.mkdirSync(path.join(root, "records"));
  fs.copyFileSync(
    path.join(import.meta.dirname, "fixtures/applications.one-row.md"),
    path.join(root, "records/applications.md"),
  );
  process.env.CAREER_ROOT = root;
  vi.resetModules();
  actions = await import("@/lib/actions");
  apps = await import("@/lib/applications");
});
afterEach(() => {
  delete process.env.CAREER_ROOT;
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

async function prepareNext(text = "Complete assessment by 2026-11-03") {
  const payload = await apps.readApplications();
  const updated = await apps.updateRow(
    payload.fileHash,
    payload.rows[0].key,
    { status: "in progress", next: text },
    "2026-10-29",
  );
  return updated.rows[0];
}
describe("durable inbox actions", () => {
  it("keeps verified received dates and enriches completed legacy email metadata without reopening", async () => {
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: false,
      actions: [task],
    });
    const action = actions.readActions().actions[0];
    await actions.completeAction(action.id, action.revision);
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: false,
      actions: [
        { ...task, email: { ...email, receivedAt: "2026-10-29T04:23:42Z" } },
      ],
    });
    const saved = actions.readActions().actions[0];
    expect(saved.state).toBe("completed");
    expect(saved.email?.receivedAt).toBe("2026-10-29T04:23:42Z");
    expect(actionReceivedLabel(saved)).toBe("Received Oct 29, 2026, 12:23 AM");
    await expect(
      actions.syncActions({
        fileHash: actions.readActions().fileHash,
        complete: false,
        actions: [{ ...task, email: { ...email, receivedAt: "not a date" } }],
      }),
    ).rejects.toThrow();
  });
  it("labels imported dates as added instead of email receipt dates", async () => {
    await prepareNext();
    await actions.importNextActions();
    expect(actionReceivedLabel(actions.readActions().actions[0])).toMatch(
      /^Added /,
    );
  });
  it("reads a missing store without creating it and refuses corrupt records", () => {
    expect(actions.readActions().actions).toEqual([]);
    expect(fs.existsSync(path.join(root, "records/actions.json"))).toBe(false);
    fs.writeFileSync(path.join(root, "records/actions.json"), "broken");
    expect(() => actions.readActions()).toThrow();
    expect(
      fs.readFileSync(path.join(root, "records/actions.json"), "utf8"),
    ).toBe("broken");
  });
  it("imports tracker actions once, safely under simultaneous imports", async () => {
    await prepareNext();
    await Promise.all([
      actions.importNextActions(),
      actions.importNextActions(),
    ]);
    expect(actions.readActions().actions).toHaveLength(1);
    expect(actions.readActions().actions[0].deadline?.date).toBe("2026-11-03");
    await prepareNext("A different next step");
    await actions.importNextActions();
    expect(actions.readActions().actions).toHaveLength(1);
  });
  it("merges imported tasks with email, deduplicates overlap, and preserves completed reminders", async () => {
    const row = await prepareNext();
    await actions.importNextActions();
    const input = {
      ...task,
      application: { rowKey: row.key, expectedNext: row.next },
    };
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [input],
    });
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [input],
    });
    expect(actions.readActions().actions).toHaveLength(1);
    const action = actions.readActions().actions[0];
    expect(action.externalKeys).toHaveLength(2);
    await actions.completeAction(action.id, action.revision);
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [
        {
          ...input,
          text: "Reminder: complete assessment",
          email: { ...email, messageId: "msg2" },
        },
      ],
    });
    expect(actions.readActions().actions[0]).toMatchObject({
      state: "completed",
      text: task.text,
    });
    expect((await apps.readApplications()).rows[0]).toMatchObject({
      next: "",
      status: "in progress",
    });
  });
  it("stores unmatched tasks and a genuinely new ask in the same thread", async () => {
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: false,
      actions: [task],
    });
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [
        {
          ...task,
          externalKey: "gmail:abc123:schedule",
          text: "Schedule interview",
        },
      ],
    });
    expect(actions.readActions().actions).toHaveLength(2);
    expect(actions.readActions().actions[0].application).toBeUndefined();
  });
  it("refuses stale confirmation after an action changed", async () => {
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [task],
    });
    const original = actions.readActions().actions[0];
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [{ ...task, text: "Complete updated assessment" }],
    });
    await expect(
      actions.completeAction(original.id, original.revision),
    ).rejects.toThrow(/changed/);
    expect(actions.readActions().actions[0].state).toBe("open");
  });
  it("does not overwrite a newer tracker next step", async () => {
    await prepareNext();
    await actions.importNextActions();
    const action = actions.readActions().actions[0];
    await prepareNext("Schedule the interview");
    await actions.completeAction(action.id, action.revision);
    expect((await apps.readApplications()).rows[0].next).toBe(
      "Schedule the interview",
    );
    expect(actions.readActions().actions[0].pendingNextClear).toBe(false);
  });
  it("persists completion when tracker cleanup fails, then retries it", async () => {
    await prepareNext();
    await actions.importNextActions();
    const action = actions.readActions().actions[0];
    const update = vi
      .spyOn(apps, "updateRow")
      .mockRejectedValueOnce(new Error("file is locked"));
    await actions.completeAction(action.id, action.revision);
    expect(actions.readActions().actions[0]).toMatchObject({
      state: "completed",
      pendingNextClear: true,
      syncWarning: expect.stringContaining("locked"),
    });
    await expect(
      actions.finalizeActionsCheck({
        fileHash: actions.readActions().fileHash,
        runId: "cleanup-failed",
        startedAt: "2026-11-02T12:00:00Z",
        complete: true,
        changes: [],
      }),
    ).rejects.toThrow(/pending/);
    update.mockRestore();
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [],
    });
    expect(actions.readActions().actions[0].pendingNextClear).toBe(false);
    expect((await apps.readApplications()).rows[0].next).toBe("");
  });
  it("does not clear newer data when an application changes between read and update", async () => {
    await prepareNext();
    await actions.importNextActions();
    const action = actions.readActions().actions[0];
    const original = apps.updateRow;
    vi.spyOn(apps, "updateRow").mockImplementationOnce(
      async (hash, key, change, today) => {
        await original(hash, key, { next: "New next step" }, today);
        return original(hash, key, change, today);
      },
    );
    await actions.completeAction(action.id, action.revision);
    expect(actions.readActions().actions[0].pendingNextClear).toBe(true);
    expect((await apps.readApplications()).rows[0].next).toBe("New next step");
    await actions.retryPendingNextClears();
    expect((await apps.readApplications()).rows[0].next).toBe("New next step");
    expect(actions.readActions().actions[0].pendingNextClear).toBe(false);
  });
  it("only retires explicitly verified actions on complete runs", async () => {
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [task],
    });
    const action = actions.readActions().actions[0];
    const retire = [
      {
        id: action.id,
        reason: "Application closed",
        evidenceMessageId: "msg3",
      },
    ];
    await expect(
      actions.syncActions({
        fileHash: actions.readActions().fileHash,
        complete: false,
        actions: [],
        retire,
      }),
    ).rejects.toThrow(/Partial/);
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: false,
      actions: [],
    });
    expect(actions.readActions().actions[0].state).toBe("open");
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [],
      retire,
    });
    expect(actions.readActions().actions).toHaveLength(1);
    expect(actions.readActions().actions[0].state).toBe("superseded");
    expect(actions.readActions().actions[0].resolution?.evidenceMessageId).toBe(
      "msg3",
    );
    expect(actions.readActions().actions[0].externalKeys).toContain(
      task.externalKey,
    );
  });
  it("rejects invalid deadlines, unsafe email URLs, duplicate identities and namespace escapes", async () => {
    await expect(
      actions.syncActions({
        fileHash: actions.readActions().fileHash,
        complete: true,
        actions: [
          { ...task, deadline: { date: "2026-02-30", wording: "bad" } },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      actions.syncActions({
        fileHash: actions.readActions().fileHash,
        complete: true,
        actions: [{ ...task, email: { ...email, url: "javascript:alert(1)" } }],
      }),
    ).rejects.toThrow();
    await expect(
      actions.syncActions({
        fileHash: actions.readActions().fileHash,
        complete: true,
        actions: [task, task],
      }),
    ).rejects.toThrow();
    fs.symlinkSync(
      path.join(root, "records/applications.md"),
      path.join(root, "records/actions.json"),
    );
    expect(() => actions.readActions()).toThrow(/Unsafe/);
  });
  it("distinguishes calendar deadlines from explicit times and application days", () => {
    expect(actions.deadlineFromNext("Complete by 2026-11-03")).toEqual({
      date: "2026-11-03",
      wording: "Complete by 2026-11-03",
    });
    expect(
      actions.deadlineFromNext(
        "Verify account (expires 11 PM ET) by 2026-10-29",
      )?.at,
    ).toBe("2026-10-30T03:00:00.000Z");
    expect(actions.deadlineFromNext("Complete by 2026-02-30")).toBeUndefined();
    const action = {
      state: "open",
      deadline: { date: "2026-10-29", wording: "today" },
    } as InboxAction;
    expect(isActionOverdue(action, new Date("2026-10-30T03:59:59Z"))).toBe(
      false,
    );
    expect(isActionOverdue(action, new Date("2026-10-30T04:00:00Z"))).toBe(
      true,
    );
    action.deadline!.at = "2026-10-30T03:00:00Z";
    expect(isActionOverdue(action, new Date("2026-10-30T03:01:00Z"))).toBe(
      true,
    );
  });
  it("sorts open tasks by deadline and undated tasks by age", () => {
    const make = (id: string, date?: string) =>
      ({
        id,
        state: "open",
        createdAt: id,
        ...(date ? { deadline: { date, wording: date } } : {}),
      }) as InboxAction;
    expect(
      sortOpenActions([
        make("c"),
        make("b", "2026-11-03"),
        make("a", "2026-10-29"),
      ]).map((a) => a.id),
    ).toEqual(["a", "b", "c"]);
  });
});

it("rejects stale sync and retirement atomically after a UI edit", async () => {
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [task],
  });
  const snapshot = actions.readActions();
  const a = snapshot.actions[0];
  await actions.changeAction(a.id, a.revision, { dismissNew: true });
  await expect(
    actions.syncActions({
      fileHash: snapshot.fileHash,
      complete: true,
      actions: [{ ...task, text: "Stale wording" }],
      retire: [
        { id: a.id, reason: "Stale closure", evidenceMessageId: "closure" },
      ],
    }),
  ).rejects.toThrow(/changed/);
  expect(actions.readActions().actions[0]).toMatchObject({
    text: task.text,
    state: "open",
    dismissedNewActivityId: expect.any(String),
  });
});

it("preserves original request provenance and permits verified field clearing", async () => {
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: false,
    actions: [
      {
        ...task,
        email: { ...email, receivedAt: "2026-10-29T04:23:42Z" },
        deadline: { date: "2026-11-03", wording: "within five days" },
        reviewReason: "Uncertain",
      },
    ],
  });
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [
      {
        ...task,
        email: {
          ...email,
          messageId: "reminder",
          receivedAt: "2026-11-01T12:00:00Z",
        },
        deadline: null,
        reviewReason: null,
      },
    ],
  });
  const a = actions.readActions().actions[0];
  expect(a.email).toMatchObject({
    messageId: "msg1",
    receivedAt: "2026-10-29T04:23:42Z",
  });
  expect(a.deadline).toBeUndefined();
  expect(a.reviewReason).toBeUndefined();
  const snapshot = actions.readActions();
  await actions.syncActions({
    fileHash: snapshot.fileHash,
    complete: true,
    actions: [{ ...task, deadline: null, reviewReason: null }],
  });
  expect(actions.readActions().fileHash).toBe(snapshot.fileHash);
});

it("never merges unlinked legacy tasks without exact nonempty Next evidence", async () => {
  const row = await prepareNext();
  await actions.importNextActions();
  const { fileHash: _hash, ...legacy } = actions.readActions();
  delete legacy.actions[0].application!.expectedNext;
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify(legacy),
  );
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [{ ...task, application: { rowKey: row.key } }],
  });
  expect(actions.readActions().actions).toHaveLength(2);
});

it("keeps retirement retries idempotent and completed history undeletable", async () => {
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [task],
  });
  const a = actions.readActions().actions[0];
  const retire = [
    { id: a.id, reason: "Withdrawn", evidenceMessageId: "withdrawal" },
  ];
  for (let n = 0; n < 2; n++)
    await actions.syncActions({
      fileHash: actions.readActions().fileHash,
      complete: true,
      actions: [],
      retire,
    });
  expect(actions.readActions().dismissed).toHaveLength(0);
  expect(actions.readActions().actions[0].state).toBe("superseded");
  expect(actions.readActions().actions[0].text).toBe(task.text);
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [{ ...task, externalKey: "gmail:abc123:new-stage" }],
  });
  const b = actions.readActions().actions.find((a) => a.state === "open")!;
  await actions.completeAction(b.id, b.revision);
  await expect(
    actions.changeAction(
      b.id,
      actions.readActions().actions.find((a) => a.id === b.id)!.revision,
      {
        remove: true,
      },
    ),
  ).rejects.toThrow(/preserved/);
});

it("acknowledges shown New markers without bumping revisions or hiding newer activity", async () => {
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [task],
  });
  const before = actions.readActions().actions[0];
  const shown = before.activity?.id ?? before.email?.messageId ?? before.id;
  await actions.markActionsSeen({
    operation: "seen-new",
    items: [
      { id: before.id, activityId: shown },
      // A stale activity id (newer mail arrived while the page was open) must stay New.
      { id: before.id, activityId: "older-activity" },
    ],
  });
  const after = actions.readActions().actions[0];
  expect(after.dismissedNewActivityId).toBe(shown);
  expect(after.revision).toBe(before.revision);

  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [
      { ...task, activity: { id: "follow-up", at: new Date().toISOString() } },
    ],
  });
  await actions.markActionsSeen({
    operation: "seen-new",
    items: [{ id: before.id, activityId: shown }],
  });
  expect(actions.readActions().actions[0].dismissedNewActivityId).toBe(shown);
  await expect(
    actions.markActionsSeen({ operation: "seen-new", items: [] }),
  ).rejects.toThrow();
});

it("no longer accepts a priority change from the UI", async () => {
  await actions.syncActions({
    fileHash: actions.readActions().fileHash,
    complete: true,
    actions: [task],
  });
  const a = actions.readActions().actions[0];
  await actions.changeAction(a.id, a.revision, {
    priority: "high",
  } as never);
  expect(actions.readActions().actions[0].priorityOverride).toBeUndefined();
});
