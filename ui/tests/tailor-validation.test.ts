// Offline orchestration regression: unsuccessful or incomplete reports never publish artifacts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedResumes, removeTestRoot } from "./seedResumes";
import { fixtureScore } from "@/lib/claude/fixtures";
import type { TailorAssessment } from "@/lib/claude/schemas";
vi.mock("@/lib/build", () => ({
  runBuild: vi.fn(async (rel: string) => {
    const root = process.env.CAREER_ROOT!;
    const dir = path.join(root, path.dirname(rel), "artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const pdf = path.join(dir, "resume.pdf"),
      png = path.join(dir, "page.png");
    fs.copyFileSync(path.join(root, "resumes/tech/Resume.pdf"), pdf);
    fs.writeFileSync(png, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    fs.writeFileSync(path.join(dir, "visible.txt"), "Fixture visible text");
    return {
      ok: true,
      pages: 1,
      ats: "PASS",
      pngPath: png,
      pdfPath: pdf,
      fillPct: 97,
      warnings: [],
      failures: [],
      raw: "",
    };
  }),
}));
let root: string, id: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-validation-"));
  seedResumes(root);
  fs.mkdirSync(path.join(root, "profile"), { recursive: true });
  fs.writeFileSync(path.join(root, "profile/career.md"), "New factual claim");
  process.env.CAREER_ROOT = root;
  vi.resetModules();
  const { result, analysis } = fixtureScore("2026-10-08");
  id = result.runId;
  result.meta.sources = (await import("@/lib/claude/inputs")).loadInputSnapshot(
    "tech",
  ).sources;
  (await import("@/lib/runs")).persistRun({
    version: 2,
    result,
    analysis,
    request: { jobPost: "Fixture post", resume: "tech" },
    savedAt: new Date().toISOString(),
  });
});
afterEach(() => {
  delete process.env.CAREER_ROOT;
  removeTestRoot(root);
});
async function run(
  subtype = "success",
  reportOverride?: unknown,
  rewrite = false,
) {
  const { runTailor } = await import("@/lib/claude/tailor");
  return runTailor(
    { runId: id, slug: "fixture" },
    () => {},
    new AbortController().signal,
    async (submit, snapshot, review) => {
      const { contentHash } = await import("@/lib/claude/inputs");
      const hash = contentHash(snapshot.resumeTex);
      if (rewrite) {
        const { resumeUnits } = await import("@/lib/claude/candidate");
        const unit = resumeUnits(snapshot.resumeTex).find(
          (u) => u.kind === "bullet",
        )!;
        const rejected = await submit({
          candidateHash: hash,
          edits: [
            {
              before: snapshot.resumeTex.slice(unit.start, unit.end),
              after: "\\resumeItem{New factual claim}",
            },
          ],
          changes: [],
        });
        expect(rejected).toMatchObject({ isError: true });
      }
      await submit({ candidateHash: hash, edits: [], changes: [] });
      const report: TailorAssessment = {
        candidateHash: hash,
        support: [],
        visualPassed: true,
        readingOrderPassed: true,
        notes: "Fixture unchanged copy",
        requirements: review.requirements
          .filter((r) => r.kind !== "eligibility" && r.bucket !== 3)
          .map((r) => ({
            id: r.id,
            presence: "absent",
            placement: null,
            quote: "",
          })),
      };
      return {
        subtype,
        structuredOutput:
          reportOverride === "default" ? report : reportOverride,
        denied: [],
        durationMs: 1,
        metrics: {},
      };
    },
  );
}
describe("agent and factual validation are required", () => {
  it("rejects an unsuccessful agent even after a candidate built", async () => {
    await expect(run("error_max_turns", "default")).rejects.toThrow(
      /without valid output/,
    );
    expect(
      fs.existsSync(path.join(root, "source/tailored/fixture/resume.tex")),
    ).toBe(false);
  });
  it.each([undefined, { changes: [] }, "not JSON"])(
    "rejects missing or invalid reports (%s)",
    async (report) => {
      await expect(run("success", report)).rejects.toThrow(
        /Missing or invalid/,
      );
    },
  );
  it("rejects a new claim without evidence and preserves the last valid candidate", async () => {
    const result = await run("success", "default", true);
    expect(fs.readFileSync(path.join(root, result.texPath), "utf8")).toBe(
      fs.readFileSync(path.join(root, "source/tech/resume.tex"), "utf8"),
    );
  });
  it("stores complete validated provenance while keeping an artifact unapproved", async () => {
    const result = await run("success", "default");
    expect(result.evidenceValidation).toBe("passed");
    expect(result.hashes?.pdf).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manualApproval).toBeUndefined();
    const saved = (await import("@/lib/runs")).loadRun(id)!;
    expect(saved.tailor?.result).toMatchObject({
      validationMethod: "controlled",
      candidateHash: result.hashes?.source,
    });
    expect(saved.tailor?.report).toHaveProperty(
      "candidateHash",
      result.candidateHash,
    );
    fs.rmSync(path.join(root, "ui/.cache/runs"), { recursive: true });
    expect(
      (await import("@/lib/runs")).loadRun(id)?.tailor?.result?.hashes,
    ).toEqual(result.hashes);
  });
});
