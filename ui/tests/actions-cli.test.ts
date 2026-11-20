import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;
const ui = path.join(import.meta.dirname, "..");
const start = "2026-11-02T12:00:00Z";
function cli(...args: string[]) {
  return JSON.parse(
    execFileSync(
      path.join(ui, "node_modules/.bin/tsx"),
      [path.join(ui, "scripts/apps.ts"), ...args],
      {
        env: { ...process.env, CAREER_ROOT: root },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
}
function input(command: string, operation: string, value: unknown) {
  const file = path.join(root, "input.json");
  fs.writeFileSync(file, JSON.stringify(value));
  return cli(command, operation, "--input", file);
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "actions-cli-"));
  fs.mkdirSync(path.join(root, "records"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it(
  "executes discovery, partial upsert, publication, handoff retry and empty check offline",
  { timeout: 30000 },
  () => {
    const email = {
      messageId: "m",
      threadId: "t",
      url: "https://mail.google.com/mail/u/0/#all/t",
      receivedAt: start,
    };
    input("mail", "sync", {
      mode: "inbox",
      startedAt: start,
      complete: true,
      discoveries: [{ ...email, kind: "first-request", summary: "Reply" }],
    });
    const before = cli("actions", "list", "--json");
    const saved = input("actions", "sync", {
      fileHash: before.fileHash,
      complete: false,
      actions: [{ externalKey: "gmail:t:reply", text: "Reply", email }],
    });
    expect(saved.actions).toHaveLength(1);
    expect(() =>
      input("actions", "sync", {
        fileHash: before.fileHash,
        complete: true,
        actions: [],
      }),
    ).toThrow();
    expect(() =>
      input("mail", "sync", {
        mode: "actions",
        runId: "run",
        startedAt: start,
        complete: true,
        acknowledge: ["m"],
      }),
    ).toThrow();
    const published = input("actions", "finalize", {
      fileHash: saved.fileHash,
      runId: "run",
      startedAt: start,
      complete: true,
      changes: [],
    });
    expect(published.lastCheck.changes).toEqual([
      { id: saved.actions[0].id, activityId: "m", kind: "new" },
    ]);
    const handoff = {
      mode: "actions",
      runId: "run",
      startedAt: start,
      complete: true,
      acknowledge: ["m"],
    };
    expect(input("mail", "sync", handoff).actionsAt).toBe(start);
    expect(
      input("mail", "sync", handoff).discoveries[0].acknowledgedAt,
    ).toBeDefined();
    const empty = input("actions", "finalize", {
      fileHash: cli("actions", "list").fileHash,
      runId: "empty",
      startedAt: "2026-11-02T13:00:00Z",
      complete: true,
      changes: [],
    });
    expect(empty.lastCheck.changes).toEqual([]);
    expect(
      cli(
        "actions",
        "deadline",
        "--received-at",
        "2026-10-29T04:23:42Z",
        "--days",
        "5",
        "--wording",
        "within five days",
      ),
    ).toEqual({
      date: "2026-11-03",
      kind: "requested",
      wording: "within five days",
    });
  },
);

it(
  "runs incremental bounds, combined Daily completion, and chained previews through CLI",
  { timeout: 30000 },
  () => {
    const window = input("mail", "quick-window", { startedAt: start });
    expect(window.initialCoverage).toBe(true);
    expect(fs.existsSync(path.join(root, "records/mail-sync.json"))).toBe(
      false,
    );
    const task = {
      externalKey: "gmail:t:ask",
      text: "Reply",
      email: {
        threadId: "t",
        messageId: "m",
        url: "https://mail.google.com/mail/u/0/#all/t",
      },
    };
    const base = cli("actions", "list");
    const first = input("actions", "preview", {
      fileHash: base.fileHash,
      complete: true,
      actions: [task],
    });
    const replay = input("actions", "preview", {
      fileHash: base.fileHash,
      snapshot: first,
      complete: true,
      actions: [task],
    });
    expect(replay.actions).toHaveLength(1);
    expect(replay.actions[0].id).toBe(first.actions[0].id);
    expect(fs.existsSync(path.join(root, "records/actions.json"))).toBe(false);
    input("mail", "sync", { mode: "inbox", complete: true, startedAt: start });
    input("actions", "finalize", {
      fileHash: base.fileHash,
      runId: "career",
      startedAt: start,
      complete: true,
    });
    const mail = input("mail", "sync", {
      mode: "actions",
      complete: true,
      careerCheck: true,
      runId: "career",
      startedAt: start,
    });
    expect(mail.lastCareerCheck.runId).toBe("career");
    expect(
      input("mail", "quick-window", { startedAt: "2026-11-02T13:00:00Z" })
        .lowerBound,
    ).toBe("2026-11-02T11:00:00.000Z");
  },
);
