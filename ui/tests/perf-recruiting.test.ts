// Regression guard: reconciling recruiting history against a large tracker must stay fast. It runs
// on every Tracker edit and every recruiting poll, and was ~2.6 s per call when each workflow,
// event and task rescanned every application row. Bounds are generous (several times the measured
// time) so slow CI machines do not flake, yet far below the old quadratic cost.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
const ROWS = 1000;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-perf-"));
  fs.mkdirSync(path.join(root, "records"));
  const rows = Array.from(
    { length: ROWS },
    (_, i) =>
      `| 2026-10-${String((i % 28) + 1).padStart(2, "0")} | Company ${i} | Software Engineer ${i} | tech | tech | 80 | 70 | LinkedIn | ${i % 3 ? "applied" : "in progress"} |  | https://example.test/jobs/${i} |  |`,
  );
  fs.writeFileSync(
    path.join(root, "records/applications.md"),
    [
      "# Applications Log",
      "",
      "| Date | Company | Role | Lane | Resume | Fit | Match | Source | Status | Next (action + date) | Link | Record ID |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n"),
  );
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("reconciles a large tracker quickly and skips unchanged repeats", async () => {
  const { reconcileRecruiting } = await import("@/lib/recruiting");
  const now = new Date("2026-11-03T17:00:00Z");

  let started = performance.now();
  const first = await reconcileRecruiting(now);
  const cold = performance.now() - started;
  expect(first.workflows).toHaveLength(ROWS);
  expect(cold).toBeLessThan(1500);

  // Nothing changed: the memoized result must come back without re-projecting.
  started = performance.now();
  const again = await reconcileRecruiting(now);
  const warm = performance.now() - started;
  expect(again.workflows).toHaveLength(ROWS);
  expect(warm).toBeLessThan(150);
});

it("resolves every application reference with indexed lookups", async () => {
  const { readApplications } = await import("@/lib/applications");
  const { applicationFor } = await import("@/lib/recruitingTypes");
  const { rows } = await readApplications();
  let mismatches = 0;
  const started = performance.now();
  for (let pass = 0; pass < 200; pass++)
    for (const row of rows)
      if (applicationFor({ applicationKey: row.key }, rows) !== row)
        mismatches++;
  // 200,000 lookups: seconds if each one scanned all 1,000 rows, a few milliseconds when indexed.
  expect(mismatches).toBe(0);
  expect(performance.now() - started).toBeLessThan(300);
});
