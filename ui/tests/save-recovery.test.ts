import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { seedResumes, removeTestRoot } from "./seedResumes";

let root: string;
async function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "save-recovery-"));
  seedResumes(root);
  fs.mkdirSync(path.join(root, "records"));
  fs.copyFileSync(
    path.join(import.meta.dirname, "fixtures/applications.one-row.md"),
    path.join(root, "records/applications.md"),
  );
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
  const apps = await import("@/lib/applications");
  const file = path.join(root, "records/applications.md");
  fs.writeFileSync(file, apps.migrateV2ToV3(fs.readFileSync(file, "utf8")));
  return {
    apps,
    quick: await import("@/lib/quick"),
    undo: await import("@/lib/undo"),
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  removeTestRoot(root);
});
const job = (submissionId: string) => ({
  submissionId,
  link: "https://example.test/jobs/recovery",
  description:
    "Recovery Co — Backend Engineer. Build Python APIs and test reliable services.",
});

it("finishes a failed record save on retry without adding another tracker row", async () => {
  const { quick, apps, undo } = await setup();
  const req = { jobs: [job("recovery-card-001")] };
  const extracted = quick.fixtureQuickBatch(req.jobs);
  const blocked = path.join(
    root,
    "records/reviews/recovery-backend-engineer.json",
  );
  fs.mkdirSync(blocked, { recursive: true });
  const first = await quick.quickAddBatch(
    extracted,
    req,
    "2026-10-30",
    undo.saveUndo,
  );
  expect(first.error).toBeTruthy();
  expect(first.remaining).toEqual([1]);
  expect(
    (await apps.readApplications()).rows.filter(
      (r) => r.company === "Recovery Co",
    ),
  ).toHaveLength(1);
  fs.rmdirSync(blocked);
  const retried = await quick.quickAddBatch(
    extracted,
    req,
    "2026-10-31",
    undo.saveUndo,
  );
  expect(retried.error).toBeUndefined();
  expect(retried.added).toHaveLength(1);
  const rows = (await apps.readApplications()).rows.filter(
    (r) => r.company === "Recovery Co",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].date).toBe("2026-10-30");
  expect(JSON.parse(fs.readFileSync(blocked, "utf8")).id).toBe(
    rows[0].recordId,
  );
  await undo.undoLog(retried.added[0].undoId);
  expect(
    (await apps.readApplications()).rows.filter(
      (r) => r.company === "Recovery Co",
    ),
  ).toHaveLength(0);
});

it(
  "replays the same submission once but allows separately pasted identical jobs with warnings",
  { timeout: 15_000 },
  async () => {
    const { quick, apps, undo } = await setup();
    const req = { jobs: [job("concurrent-card-001")] };
    const extracted = quick.fixtureQuickBatch(req.jobs);
    const results = await Promise.all([
      quick.quickAddBatch(extracted, req, "2026-10-30", undo.saveUndo),
      quick.quickAddBatch(extracted, req, "2026-10-30", undo.saveUndo),
    ]);
    expect(
      (await apps.readApplications()).rows.filter(
        (r) => r.company === "Recovery Co",
      ),
    ).toHaveLength(1);
    expect(results.every((r) => !r.error)).toBe(true);
    const separate = { jobs: [job("separate-card-002")] };
    const second = await quick.quickAddBatch(
      extracted,
      separate,
      "2026-10-30",
      undo.saveUndo,
    );
    expect(second.added).toHaveLength(1);
    expect(second.added[0].duplicates?.exact.length).toBeGreaterThan(0);
    expect(
      (await apps.readApplications()).rows.filter(
        (r) => r.company === "Recovery Co",
      ),
    ).toHaveLength(2);
    await undo.undoLog(second.added[0].undoId);
    expect(
      (await apps.readApplications()).rows.filter(
        (r) => r.company === "Recovery Co",
      ),
    ).toHaveLength(1);
  },
);

it("exposes permanent review save failure and retries without running the model again", async () => {
  await setup();
  const { fixtureScore } = await import("@/lib/claude/fixtures");
  const runs = await import("@/lib/runs");
  const { result, analysis } = fixtureScore("2026-10-30");
  const record = {
    version: 2 as const,
    request: { jobPost: "Audit job", resume: "tech" as const },
    result,
    analysis,
    savedAt: new Date().toISOString(),
  };
  const blocked = path.join(
    root,
    "records/reviews",
    result.suggestedSlug + ".json",
  );
  fs.mkdirSync(blocked, { recursive: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  runs.persistRun(record);
  expect(runs.loadRun(result.runId)?.result.meta.persistenceWarning).toMatch(
    /not saved|could not|only/i,
  );
  const { GET, POST } = await import("@/app/api/reviews/route");
  expect(
    (
      await (await GET(new Request("http://localhost/api/reviews"))).json()
    ).items.some((i: { id: string }) => i.id === result.runId),
  ).toBe(true);
  fs.rmdirSync(blocked);
  const response = await POST(
    new Request("http://localhost/api/reviews", {
      method: "POST",
      body: JSON.stringify({ runId: result.runId }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(response.status).toBe(201);
  expect(
    runs.loadRun(result.runId)?.result.meta.persistenceWarning,
  ).toBeUndefined();
  fs.rmSync(path.join(root, "ui/.cache/runs"), { recursive: true });
  expect(runs.loadRun(result.runId)?.result.runId).toBe(result.runId);
});

it("recovers an Undo write failure and retains the original saved-for-later row for Undo", async () => {
  const { quick, apps, undo } = await setup();
  const req = { jobs: [job("undo-recovery-003")] };
  const initial = await apps.readApplications();
  await apps.upsertApplication(
    {
      fileHash: initial.fileHash,
      decision: "later",
      row: {
        company: "Recovery Co",
        role: "Backend Engineer",
        lane: "tech",
        resume: "tech",
        fit: null,
        match: null,
        source: "Other",
        link: req.jobs[0].link,
      },
    },
    "2026-10-20",
  );
  const before = fs.readFileSync(
    path.join(root, "records/applications.md"),
    "utf8",
  );
  const extracted = quick.fixtureQuickBatch(req.jobs);
  const failed = await quick.quickAddBatch(extracted, req, "2026-10-30", () => {
    throw new Error("Undo storage unavailable");
  });
  expect(failed.error).toContain("Undo storage unavailable");
  expect(quick.recoverQuickBatch(req.jobs)).toHaveLength(1);
  const retried = await quick.quickAddBatch(
    extracted,
    req,
    "2026-10-31",
    undo.saveUndo,
  );
  expect(retried.error).toBeUndefined();
  await undo.undoLog(retried.added[0].undoId);
  expect(
    fs.readFileSync(path.join(root, "records/applications.md"), "utf8"),
  ).toBe(before);
});

it("edits a selected repeated posting without changing its same-key neighbor", async () => {
  const { quick, apps, undo } = await setup();
  for (const id of ["editable-repeat-01", "editable-repeat-02"]) {
    const req = { jobs: [job(id)] };
    await quick.quickAddBatch(
      quick.fixtureQuickBatch(req.jobs),
      req,
      "2026-10-30",
      undo.saveUndo,
    );
  }
  const payload = await apps.readApplications();
  const rows = payload.rows.filter((r) => r.company === "Recovery Co");
  expect(rows[0].key).toBe(rows[1].key);
  const updated = await apps.updateRow(
    payload.fileHash,
    rows[0].key,
    { next: "Only this position" },
    "2026-10-30",
    rows[0].lineIndex,
  );
  expect(updated.rows.find((r) => r.recordId === rows[0].recordId)?.next).toBe(
    "Only this position",
  );
  expect(updated.rows.find((r) => r.recordId === rows[1].recordId)?.next).toBe(
    "",
  );
});

it("does not log a reviewed application when its Undo journal cannot be saved", async () => {
  const { apps } = await setup();
  const { POST } = await import("@/app/api/applications/route");
  const before = await apps.readApplications();
  const blocked = path.join(root, "ui/.cache/undo");
  fs.mkdirSync(path.dirname(blocked), { recursive: true });
  fs.writeFileSync(blocked, "Simulated unavailable Undo directory");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await POST(
    new Request("http://localhost/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileHash: before.fileHash,
        decision: "submitted",
        row: {
          company: "Reviewed Recovery Co",
          role: "Engineer",
          lane: "tech",
          resume: "tech",
          fit: 80,
          match: 70,
          source: "Other",
          link: "https://example.test/jobs/review-recovery",
        },
      }),
    }),
  );
  expect(response.status).toBe(500);
  expect((await apps.readApplications()).fileHash).toBe(before.fileHash);
});
