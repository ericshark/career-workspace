import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fixtureScore } from "@/lib/claude/fixtures";
import { seedResumes, removeTestRoot } from "./seedResumes";
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "Visible resume text"),
}));
vi.mock("@/lib/claude/agent", () => ({
  runAgent: vi.fn(async () => {
    throw new Error("Scoring unavailable");
  }),
}));
let root: string;
let id: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-match-"));
  seedResumes(root);
  process.env.CAREER_ROOT = root;
  vi.resetModules();
  fs.mkdirSync(path.join(root, "profile"), { recursive: true });
  fs.writeFileSync(path.join(root, "profile/career.md"), "Career facts");
  fs.mkdirSync(path.join(root, "source/tailored/example"), { recursive: true });
  fs.copyFileSync(
    path.join(root, "source/tech/resume.tex"),
    path.join(root, "source/tailored/example/resume.tex"),
  );
  fs.mkdirSync(path.join(root, "resumes/tailored/example"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(root, "resumes/tech/Resume.pdf"),
    path.join(root, "resumes/tailored/example/Resume.pdf"),
  );
  const { result, analysis } = fixtureScore("2026-11-03");
  id = result.runId;
  const { artifactHashes } = await import("@/lib/tailorApproval");
  const tailored = {
    slug: "example",
    pdfPath: "resumes/tailored/example/Resume.pdf",
    build: { ok: true, pages: 1, ats: "PASS" },
    evidenceValidation: "passed",
    hashes: artifactHashes("example"),
    actualMatch: null,
  } as any;
  (await import("@/lib/runs")).persistRun({
    version: 2,
    result,
    analysis,
    request: { jobPost: "Saved original requirements", resume: "tech" },
    savedAt: new Date().toISOString(),
    tailor: {
      slug: "example",
      actualMatch: null,
      at: new Date().toISOString(),
      result: tailored,
    },
  });
});
afterEach(() => {
  delete process.env.CAREER_ROOT;
  removeTestRoot(root);
});
it("persists lower Match with provenance while preserving original review and application bytes", async () => {
  const { loadRun } = await import("@/lib/runs");
  const before = loadRun(id)!;
  const { tailorMatchContext, recordTailorMatch } =
    await import("@/lib/tailorMatch");
  const { hashes } = tailorMatchContext(id);
  recordTailorMatch(
    id,
    {
      score: 20,
      summary: "Evidence remains limited",
      sourceHash: hashes.source,
      pdfHash: hashes.pdf,
    },
    "chat-session",
  );
  const after = loadRun(id)!;
  expect(after.result).toEqual(before.result);
  expect(after.tailor?.actualMatch).toBe(20);
  expect(after.tailor?.result?.matchAssessment?.sourceHash).toBe(hashes.source);
});
it("rejects stale assessment hashes", async () => {
  const { tailorMatchContext, recordTailorMatch } =
    await import("@/lib/tailorMatch");
  const { hashes } = tailorMatchContext(id);
  expect(() =>
    recordTailorMatch(
      id,
      {
        score: 90,
        summary: "Mismatch",
        sourceHash: "0".repeat(64),
        pdfHash: hashes.pdf,
      },
      "chat-session",
    ),
  ).toThrow(/changed/);
});
it("scoring failure leaves the validated artifact available", async () => {
  const { assessTailorMatch } = await import("@/lib/tailorMatch");
  await expect(assessTailorMatch(id)).rejects.toThrow("Scoring unavailable");
  expect(
    (await import("@/lib/runs")).loadRun(id)?.tailor?.result?.build.ok,
  ).toBe(true);
});
