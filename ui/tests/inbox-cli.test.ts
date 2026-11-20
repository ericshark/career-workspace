import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { APPLICATIONS_HEADER } from "@/lib/types";

const ui = path.resolve(import.meta.dirname, "..");
let root: string;
const file = () => path.join(root, "records/applications.md");
const apps = (...args: string[]) =>
  execFileSync(
    path.join(ui, "node_modules/.bin/tsx"),
    [path.join(ui, "scripts/apps.ts"), ...args],
    {
      env: { ...process.env, CAREER_ROOT: root },
      encoding: "utf8",
      stdio: "pipe",
    },
  );
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-cli-"));
  fs.mkdirSync(path.join(root, "records"));
  fs.writeFileSync(
    file(),
    `${APPLICATIONS_HEADER}\n|${Array(12).fill("---").join("|")}|\n| 2026-10-01 | Acme | Engineer | tech | tech | | | Other | applied | Preserve manual Next | https://example.com/jobs/1 | acme |\n| 2026-10-01 | Acme | Analyst | tech | tech | | | Other | applied | | https://example.com/jobs/2 | analyst |\n`,
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it(
  "guards email status updates, preserves other roles/Next/date and replays without writes",
  { timeout: 30_000 },
  () => {
    const candidates = JSON.parse(
      apps("check", "--company", "Acme", "--role", "Engineer", "--json"),
    );
    const key = candidates.possible.find(
      (row: { role: string }) => row.role === "Engineer",
    ).key;
    apps("status", "--key", key, "--from", "applied", "--to", "in progress");
    const after = fs.readFileSync(file(), "utf8");
    expect(after).toContain("| in progress | Preserve manual Next |");
    expect(after).toContain(
      "| Acme | Analyst | tech | tech | | | Other | applied |",
    );
    const modified = fs.statSync(file()).mtimeMs;
    apps("status", "--key", key, "--from", "applied", "--to", "in progress");
    expect(fs.statSync(file()).mtimeMs).toBe(modified);
    // A later manual rejection must survive stale recruiting-progress evidence.
    apps("status", "--key", key, "--to", "rejected");
    const manual = fs.readFileSync(file(), "utf8");
    expect(() =>
      apps("status", "--key", key, "--from", "applied", "--to", "in progress"),
    ).toThrow(/status changed/);
    expect(fs.readFileSync(file(), "utf8")).toBe(manual);
    expect(() =>
      apps("status", "--key", key, "--from", "unknown", "--to", "in progress"),
    ).toThrow(/--from must/);
  },
);

it(
  "lets Daily's Actions stage close a duplicate row but never a Quick check",
  { timeout: 30_000 },
  () => {
    const json = (args: string[], value: unknown) => {
      const input = path.join(root, "input.json");
      fs.writeFileSync(input, JSON.stringify(value));
      return JSON.parse(apps(...args, "--input", input));
    };
    const key = JSON.parse(
      apps("check", "--company", "Acme", "--role", "Engineer", "--json"),
    ).possible.find((row: { role: string }) => row.role === "Engineer").key;
    const daily = json(["mail", "begin"], { mode: "daily" });
    // Inbox stage completes, moving the lease to the Actions stage.
    json(["mail", "sync"], {
      mode: "inbox",
      leaseId: daily.leaseId,
      startedAt: daily.startedAt,
      complete: true,
    });
    apps(
      "status",
      "--key",
      key,
      "--from",
      "applied",
      "--to",
      "rejected",
      "--lease",
      daily.leaseId,
    );
    expect(fs.readFileSync(file(), "utf8")).toMatch(
      /\| Acme \| Engineer \|.*\| Other \| rejected \|/,
    );
    json(["mail", "fail"], { leaseId: daily.leaseId, failure: "interrupted" });
    const quick = json(["mail", "begin"], { mode: "quick" });
    const analyst = JSON.parse(
      apps("check", "--company", "Acme", "--role", "Analyst", "--json"),
    ).possible.find((row: { role: string }) => row.role === "Analyst").key;
    expect(() =>
      apps(
        "status",
        "--key",
        analyst,
        "--from",
        "applied",
        "--to",
        "rejected",
        "--lease",
        quick.leaseId,
      ),
    ).toThrow(/does not belong/);
  },
);

it(
  "persists a pending handoff through the real CLI without touching action/application records",
  { timeout: 30_000 },
  () => {
    const before = fs.readFileSync(file(), "utf8");
    const input = path.join(root, "batch.json");
    fs.writeFileSync(
      input,
      JSON.stringify({
        mode: "inbox",
        complete: false,
        startedAt: "2026-11-02T12:00:00Z",
        discoveries: [
          {
            messageId: "m",
            threadId: "t",
            url: "https://mail.google.com/mail/u/0/#all/t",
            receivedAt: "2026-11-02T11:00:00Z",
            kind: "uncertain",
            summary: "Verify application match",
            reviewReason: "Multiple Acme roles",
          },
        ],
      }),
    );
    apps("mail", "sync", "--input", input);
    apps("mail", "sync", "--input", input);
    const state = JSON.parse(apps("mail", "list", "--json"));
    expect(state.discoveries).toHaveLength(1);
    expect(state.inboxAt).toBeUndefined();
    expect(fs.existsSync(path.join(root, "records/actions.json"))).toBe(false);
    expect(fs.readFileSync(file(), "utf8")).toBe(before);
  },
);
