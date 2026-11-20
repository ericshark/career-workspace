import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureScore, FIXTURE_POST } from "@/lib/claude/fixtures";
import type { RunRecord } from "@/lib/runs";

// CAREER_ROOT is read when lib/paths.ts loads: point it at a temp dir and import fresh.
let root: string;
async function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "reviews-"));
  process.env.CAREER_ROOT = root;
  vi.resetModules();
  return {
    reviews: await import("@/lib/reviews"),
    brief: await import("@/lib/brief"),
    runs: await import("@/lib/runs"),
  };
}
afterEach(() => {
  delete process.env.CAREER_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

function run(link = "https://boards.greenhouse.io/fixture/jobs/9"): RunRecord {
  const { result, analysis } = fixtureScore("2026-10-07", link);
  return {
    version: 2,
    request: {
      jobPost: FIXTURE_POST,
      resume: "tech",
      link,
      source: "LinkedIn",
    },
    analysis,
    result,
    savedAt: "2026-10-07T12:00:00Z",
  };
}

describe("saved reviews", () => {
  it("writes <slug>.json (canonical) + <slug>.md (rendered) under records/reviews", async () => {
    const { reviews } = await setup();
    const rec = run();
    const saved = reviews.saveReview(rec);
    expect(saved).toEqual({
      slug: "fixture-co-backend-engineer",
      jsonPath: "records/reviews/fixture-co-backend-engineer.json",
      mdPath: "records/reviews/fixture-co-backend-engineer.md",
    });
    const json = JSON.parse(
      fs.readFileSync(path.join(root, saved.jsonPath), "utf8"),
    );
    expect(json.request.jobPost).toBe(FIXTURE_POST);
    expect(json.decision).toBe("undecided");
    const md = fs.readFileSync(path.join(root, saved.mdPath), "utf8");
    expect(md).toContain("# Review: Fixture Co — Backend Engineer (New Grad)");
    expect(md).toContain("Candidate Fit:");
    expect(md).toContain(
      "### 3 · Not demonstrated in career.md\n\n- AWS (nice)",
    );
    expect(md).toContain("**Work requirements needing stronger evidence**");
    expect(md).toContain("missing evidence does not establish inability");
    expect(md).not.toContain("## Hard blockers");
    expect(md).toContain("Missing keywords: OAuth2, AWS");
    expect(md).toContain(FIXTURE_POST.trim());
  });

  it("re-saving the same run reuses its files; a different run gets -2", async () => {
    const { reviews } = await setup();
    const a = run();
    expect(reviews.saveReview(a).slug).toBe("fixture-co-backend-engineer");
    expect(reviews.saveReview(a, "applied").slug).toBe(
      "fixture-co-backend-engineer",
    );
    expect(reviews.saveReview(run()).slug).toBe(
      "fixture-co-backend-engineer-2",
    );
    const list = reviews.listReviews();
    expect(list).toHaveLength(2);
    expect(
      list.find((r) => r.slug === "fixture-co-backend-engineer")?.decision,
    ).toBe("applied");
  });

  it("renders deterministically (same JSON → same Markdown)", async () => {
    const { reviews } = await setup();
    const rec = run();
    expect(reviews.renderReviewMarkdown(rec)).toBe(
      reviews.renderReviewMarkdown(rec),
    );
  });

  it("fences a post that itself contains backticks", async () => {
    const { reviews } = await setup();
    const rec = run();
    rec.request.jobPost = "Use ``` fences ```\n## Not a heading";
    const md = reviews.renderReviewMarkdown(rec);
    expect(md).toContain("````text\nUse ``` fences ```");
  });
});

describe("tailoring brief", () => {
  it("carries both scores, the three buckets and the full post", async () => {
    const { brief } = await setup();
    const rec = run();
    const b = brief.buildBrief(rec, "fixture-co-backend-engineer");
    expect(b).toMatchObject({
      master: "source/tech/resume.tex",
      outputTex: "source/tailored/fixture-co-backend-engineer/resume.tex",
      outputPdf: "resumes/tailored/fixture-co-backend-engineer/Resume.pdf",
      jobDescription: FIXTURE_POST,
    });
    expect(b.fit.total).toBe(rec.result.fit.total);
    expect(b.match.total).toBe(rec.result.match.total);
    expect(b.unsupported.map((u) => u.text)).toEqual(["AWS"]);
    expect(
      b.onResume.length + b.underrepresented.length + b.unsupported.length,
    ).toBe(rec.result.requirements.length);
    expect(b).not.toHaveProperty("mode");
    expect(b.underrepresented.find((r) => r.id === "r5")?.career).toBe(
      "partial",
    );
  });
});

describe("discardReview (Skip)", () => {
  const header =
    "| Date | Company | Role | Lane | Resume | Fit | Match | Source | Status | Next (action + date) | Link | Record ID |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  async function setupDiscard() {
    const mods = await setup();
    const discard = await import("@/lib/discardReview");
    const rec = run();
    mods.runs.persistRun(rec);
    const saved = mods.reviews.findSaved(rec.result.runId)!;
    return { ...mods, discard, rec, saved };
  }

  it("deletes the cached run and both saved review files", async () => {
    const { reviews, runs, discard, rec, saved } = await setupDiscard();
    const cache = path.join(root, "ui/.cache/runs", `${rec.result.runId}.json`);
    expect(fs.existsSync(cache)).toBe(true);
    await discard.discardReview(rec.result.runId);
    expect(fs.existsSync(cache)).toBe(false);
    expect(fs.existsSync(path.join(root, saved.summary.jsonPath))).toBe(false);
    expect(fs.existsSync(path.join(root, saved.summary.mdPath))).toBe(false);
    expect(reviews.findSaved(rec.result.runId)).toBeNull();
    expect(runs.loadRun(rec.result.runId)).toBeNull();
  });

  it("refuses when a tracker row points at the review", async () => {
    const { discard, rec, saved } = await setupDiscard();
    fs.mkdirSync(path.join(root, "records"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "records/applications.md"),
      `# Applications\n\n${header}| 2026-10-07 | Fixture Co | Backend Engineer | tech | tech | 85 | 61 | LinkedIn | applied |  |  | ${rec.result.runId} |\n`,
    );
    await expect(discard.discardReview(rec.result.runId)).rejects.toThrow(
      /tracker row/,
    );
    expect(fs.existsSync(path.join(root, saved.summary.jsonPath))).toBe(true);
  });

  it("refuses a logged review and rejects unknown ids", async () => {
    const { discard, runs, rec } = await setupDiscard();
    runs.recordDecision(rec.result.runId, "later");
    await expect(discard.discardReview(rec.result.runId)).rejects.toThrow(
      /logged/,
    );
    await expect(discard.discardReview("missing-run-id")).rejects.toThrow(
      /Unknown review/,
    );
  });
  it("removes a uniquely linked To apply row and review while preserving tailored files", async () => {
    const { discard, rec, saved, runs } = await setupDiscard();
    const file = path.join(root, "records/applications.md");
    fs.writeFileSync(
      file,
      `# Applications\n\n${header}| 2026-10-07 | Fixture Co | Backend Engineer | tech | tech | 85 | 61 | LinkedIn | to apply |  |  | ${rec.result.runId} |\n`,
    );
    runs.recordDecision(rec.result.runId, "later");
    const artifact = path.join(root, "resumes/tailored/example/resume.pdf");
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, "keep");
    await discard.discardReview(rec.result.runId);
    expect(fs.readFileSync(file, "utf8")).not.toContain(rec.result.runId);
    expect(fs.existsSync(path.join(root, saved.summary.jsonPath))).toBe(false);
    expect(fs.readFileSync(artifact, "utf8")).toBe("keep");
  });
  it("rejects ambiguous links and retains the complete review", async () => {
    const { discard, rec, saved } = await setupDiscard();
    const line = `| 2026-10-07 | Fixture Co | Backend Engineer | tech | tech | 85 | 61 | LinkedIn | to apply |  |  | ${rec.result.runId} |\n`;
    fs.writeFileSync(
      path.join(root, "records/applications.md"),
      header + line + line,
    );
    await expect(discard.discardReview(rec.result.runId)).rejects.toThrow(
      /Multiple tracker/,
    );
    expect(fs.existsSync(path.join(root, saved.summary.jsonPath))).toBe(true);
  });
  it("restores quarantined review files when the tracker write fails", async () => {
    const { discard, rec, saved } = await setupDiscard();
    const file = path.join(root, "records/applications.md");
    const text =
      header +
      `| 2026-10-07 | Fixture Co | Backend Engineer | tech | tech | 85 | 61 | LinkedIn | to apply |  |  | ${rec.result.runId} |\n`;
    fs.writeFileSync(file, text);
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === file) throw new Error("Simulated tracker write failure");
      rename(from, to);
    });
    try {
      await expect(discard.discardReview(rec.result.runId)).rejects.toThrow(
        /Simulated/,
      );
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    expect(fs.existsSync(path.join(root, saved.summary.jsonPath))).toBe(true);
    expect(fs.existsSync(path.join(root, saved.summary.mdPath))).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, "ui/.cache/runs", rec.result.runId + ".json"),
      ),
    ).toBe(true);
  });
  it("refuses a concurrent tracker edit without discarding files", async () => {
    const { discard, rec, saved } = await setupDiscard();
    const file = path.join(root, "records/applications.md");
    fs.writeFileSync(file, header);
    const operation = discard.discardReview(rec.result.runId);
    fs.appendFileSync(file, "\nExternal edit\n");
    await expect(operation).rejects.toThrow(/file changed/);
    expect(fs.existsSync(path.join(root, saved.summary.jsonPath))).toBe(true);
  });
});

describe("viewed metadata", () => {
  it("persists an idempotent display timestamp without changing a decision, scores, metrics or history time", async () => {
    const { runs, reviews } = await setup();
    const rec = { ...run(), viewedAt: null, decision: "undecided" as const };
    runs.persistRun(rec);
    const before = runs.loadRun(rec.result.runId)!;
    expect(reviews.listReviews()[0].viewedAt).toBeNull();
    const viewedAt = runs.markReviewViewed(rec.result.runId);
    expect(viewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(runs.markReviewViewed(rec.result.runId)).toBe(viewedAt);
    const after = runs.loadRun(rec.result.runId)!;
    expect(after).toEqual({ ...before, viewedAt });
    expect(reviews.listReviews()[0]).toMatchObject({
      viewedAt,
      decision: "undecided",
      savedAt: rec.savedAt,
    });
    fs.rmSync(path.join(root, "ui/.cache/runs"), { recursive: true });
    expect(runs.loadRun(rec.result.runId)?.viewedAt).toBe(viewedAt);
    const route = await import("@/app/api/reviews/[runId]/view/route");
    const response = await route.POST(
      new Request("http://local/view", { method: "POST" }),
      { params: Promise.resolve({ runId: rec.result.runId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ viewedAt });
  });
  it("leaves legacy reviews implicitly viewed and rejects unknown IDs", async () => {
    const { runs, reviews } = await setup();
    runs.persistRun(run());
    expect(reviews.listReviews()[0].viewedAt).toBeUndefined();
    expect(runs.markReviewViewed("unknown-id")).toBeNull();
    const route = await import("@/app/api/reviews/[runId]/view/route");
    expect(
      (
        await route.POST(new Request("http://local/view", { method: "POST" }), {
          params: Promise.resolve({ runId: "unknown-id" }),
        })
      ).status,
    ).toBe(404);
  });
  it("does not pretend that a viewed timestamp was saved when permanent storage fails", async () => {
    const { runs, reviews } = await setup();
    const rec = { ...run(), viewedAt: null };
    runs.persistRun(rec);
    const saved = reviews.findSaved(rec.result.runId)!;
    const target = path.join(root, saved.summary.jsonPath);
    fs.rmSync(target);
    fs.mkdirSync(target);
    expect(() => runs.markReviewViewed(rec.result.runId)).toThrow();
    expect(runs.loadRun(rec.result.runId)?.viewedAt).toBeNull();
  });
});

it("view metadata keeps the existing filename when the suggested slug differs", async () => {
  const { runs, reviews } = await setup();
  const rec = { ...run(), viewedAt: null };
  runs.persistRun(rec);
  const saved = reviews.findSaved(rec.result.runId)!;
  const renamed = path.join(root, "records/reviews/existing-review-name.json");
  fs.renameSync(path.join(root, saved.summary.jsonPath), renamed);
  reviews.forgetReviewCache();
  runs.markReviewViewed(rec.result.runId);
  expect(
    reviews.listReviews().filter((item) => item.id === rec.result.runId),
  ).toHaveLength(1);
  expect(reviews.findSaved(rec.result.runId)?.summary.slug).toBe(
    "existing-review-name",
  );
  expect(JSON.parse(fs.readFileSync(renamed, "utf8")).viewedAt).toBeTruthy();
});

it("keeps viewed results out of the durable queue after a server-state reload", async () => {
  const { runs } = await setup();
  const rec = { ...run(), viewedAt: null };
  runs.persistRun(rec);
  const queuePath = path.join(root, "ui/.cache/review-queue.json");
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  fs.writeFileSync(
    queuePath,
    JSON.stringify([
      {
        runId: rec.result.runId,
        status: "done",
        startedAt: 1,
        finishedAt: 2,
        queuedAt: 1,
        preview: "",
      },
    ]),
  );
  delete (globalThis as any).__careerReviewQueue;
  const queue = await import("@/lib/scoreState");
  expect(queue.reviewStatuses()).toHaveLength(1);
  runs.markReviewViewed(rec.result.runId);
  expect(queue.reviewStatuses()).toHaveLength(0);
  delete (globalThis as any).__careerReviewQueue;
  vi.resetModules();
  const restarted = await import("@/lib/scoreState");
  expect(restarted.reviewStatuses()).toHaveLength(0);
  restarted._resetReviewState();
  delete (globalThis as any).__careerReviewQueue;
});
