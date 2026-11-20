import { seedResumes, removeTestRoot } from "./seedResumes";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NewApplication } from "@/lib/types";

// Each test points CAREER_ROOT at a temp copy and imports the modules fresh, so the real tracker,
// reviews and archives are never touched. Archives are captured for real from the seeded masters.
let root: string;
let file: string;
const today = "2026-10-12";

async function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "undo-"));
  seedResumes(root);
  file = path.join(root, "records/applications.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(
    path.join(import.meta.dirname, "fixtures", "applications.one-row.md"),
    file,
  );
  process.env.CAREER_ROOT = root;
  vi.resetModules();
  const apps = await import("@/lib/applications");
  fs.writeFileSync(file, apps.migrateV2ToV3(fs.readFileSync(file, "utf8")));
  return {
    apps,
    undo: await import("@/lib/undo"),
    runs: await import("@/lib/runs"),
  };
}

afterEach(() => {
  delete process.env.CAREER_ROOT;
  removeTestRoot(root);
});

const newApp = (
  fileHash: string,
  decision: NewApplication["decision"] = "submitted",
  link = "https://boards.greenhouse.io/globex/jobs/42",
): NewApplication => ({
  fileHash,
  decision,
  row: {
    company: "Globex",
    role: "Backend Engineer",
    lane: "tech",
    resume: "tech",
    fit: 77,
    match: 64,
    source: "LinkedIn",
    link,
  },
});

describe("undo last log", () => {
  it("removes an inserted row and stores no resume copy", async () => {
    const { apps, undo } = await setup();
    const before = fs.readFileSync(file, "utf8");
    const { fileHash } = await apps.readApplications();
    const logged = await apps.upsertApplication(newApp(fileHash), today);
    const id = undo.saveUndo({ ...logged.undo, kind: "review" });
    await undo.undoLog(id);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(root, "records/submissions"))).toBe(false);
  });

  it("puts a saved-for-later row back when the log had updated it", async () => {
    const { apps, undo } = await setup();
    const first = await apps.upsertApplication(
      newApp((await apps.readApplications()).fileHash, "later"),
      "2026-10-10",
    );
    const saved = fs.readFileSync(file, "utf8");
    const applied = await apps.upsertApplication(
      newApp(first.fileHash, "submitted"),
      today,
    );
    expect(applied.action).toBe("updated");
    expect(applied.undo.previousLine).toContain("to apply");
    await undo.undoLog(undo.saveUndo({ ...applied.undo, kind: "review" }));
    expect(fs.readFileSync(file, "utf8")).toBe(saved);
  });

  it("refuses when the row was edited after logging, and leaves it alone", async () => {
    const { apps, undo } = await setup();
    const logged = await apps.upsertApplication(
      newApp((await apps.readApplications()).fileHash, "later"),
      today,
    );
    await apps.updateRow(
      logged.fileHash,
      logged.rowKey,
      { next: "Follow up Friday" },
      today,
    );
    const edited = fs.readFileSync(file, "utf8");
    const id = undo.saveUndo({ ...logged.undo, kind: "review" });
    await expect(undo.undoLog(id)).rejects.toThrow(/changed since/);
    expect(fs.readFileSync(file, "utf8")).toBe(edited);
  });

  it("works once, and not after it expires", async () => {
    const { apps, undo } = await setup();
    const logged = await apps.upsertApplication(
      newApp((await apps.readApplications()).fileHash, "later"),
      today,
    );
    const id = undo.saveUndo({ ...logged.undo, kind: "review" });
    await undo.undoLog(id);
    await expect(undo.undoLog(id)).rejects.toMatchObject({ status: 410 });

    const again = await apps.upsertApplication(
      newApp((await apps.readApplications()).fileHash, "later"),
      today,
    );
    const stale = undo.saveUndo(
      { ...again.undo, kind: "review" },
      Date.now() - undo.UNDO_TTL_MS - 1,
    );
    await expect(undo.undoLog(stale)).rejects.toMatchObject({ status: 410 });
    expect(fs.readFileSync(file, "utf8")).toContain("Globex");
    await expect(undo.undoLog("../../etc")).rejects.toMatchObject({
      status: 410,
    });
  });

  it("restores the review's previous decision", async () => {
    const { apps, undo, runs } = await setup();
    const { fixtureScore } = await import("@/lib/claude/fixtures");
    const { result, analysis } = fixtureScore(today);
    runs.persistRun({
      version: 2,
      request: { jobPost: "x".repeat(200), resume: "tech" },
      analysis,
      result,
      savedAt: new Date().toISOString(),
    });
    const logged = await apps.upsertApplication(
      newApp((await apps.readApplications()).fileHash, "later"),
      today,
    );
    runs.recordDecision(result.runId, "later");
    await undo.undoLog(
      undo.saveUndo({
        ...logged.undo,
        kind: "review",
        runId: result.runId,
        previousDecision: "undecided",
      }),
    );
    expect(runs.loadRun(result.runId)?.decision).toBe("undecided");
  });

  it("deletes the quick-add record that the undone log created", async () => {
    const { apps, undo } = await setup();
    const reviews = path.join(root, "records/reviews");
    fs.mkdirSync(reviews, { recursive: true });
    for (const ext of ["json", "md"])
      fs.writeFileSync(path.join(reviews, `globex-backend.${ext}`), "{}");
    const logged = await apps.upsertApplication(
      newApp((await apps.readApplications()).fileHash, "later"),
      today,
    );
    await undo.undoLog(
      undo.saveUndo({
        ...logged.undo,
        kind: "quick",
        quickSlug: "globex-backend",
      }),
    );
    expect(fs.readdirSync(reviews)).toEqual([]);
  });
});
