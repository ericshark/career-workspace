// Exercise real edits, checks and publication with offline model/build substitutes.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTailor } from "@/lib/claude/tailor";
import {
  loadInputSnapshot,
  contentHash,
  REVIEW_RULES,
  TAILOR_RULES,
} from "@/lib/claude/inputs";
import { fixtureScore } from "@/lib/claude/fixtures";
import type { CandidateSubmission, JobEvent } from "@/lib/types";
import type { TailorAssessment } from "@/lib/claude/schemas";
const state = vi.hoisted(() => ({
  root: `/tmp/career-tailor-test-${crypto.randomUUID()}`,
  run: undefined as any,
  agent: vi.fn(),
  codexLoop: vi.fn(),
  build: vi.fn(),
  update: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/paths", async (original) => ({
  ...(await original<typeof import("@/lib/paths")>()),
  CAREER_ROOT: state.root,
  resolveExpected: (rel: string) => path.join(state.root, rel),
  canonicalRelative: (rel: string) => rel,
}));
vi.mock("@/lib/claude/agent", async (original) => ({
  ...(await original<typeof import("@/lib/claude/agent")>()),
  runAgent: state.agent,
}));
vi.mock("@/lib/claude/codex", () => ({ runCodexToolLoop: state.codexLoop }));
vi.mock("@/lib/build", () => ({ runBuild: state.build }));
vi.mock("@/lib/runs", () => ({
  loadRun: () => state.run,
  updateRun: state.update,
}));
vi.mock("@/lib/reviews", () => ({ saveReview: state.save }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (_n: string, _d: string, _s: unknown, handler: unknown) => ({
    handler,
  }),
  createSdkMcpServer: (opts: unknown) => opts,
}));
const master = String.raw`\documentclass{article}\begin{document}\section{Experience}\resumeItem{Built Python backend services}\end{document}`;
const first = "Built Python backend services with PostgreSQL";
const second = "Built Python backend services with PostgreSQL and Redis";
const evidence = (after: string) => [
  { requirementId: "r1", after, careerQuote: after },
];
const candidate = (
  current: string,
  before: string,
  after: string,
): CandidateSubmission => ({
  candidateHash: contentHash(current),
  edits: [{ before, after }],
  changes: evidence(after),
});
// The agent's final assessment: verdicts by change index; code re-attaches the submitted evidence.
const report = (tex: string): TailorAssessment => ({
  candidateHash: contentHash(tex),
  visualPassed: true,
  readingOrderPassed: true,
  support: [
    {
      change: 0,
      supported: true,
      reason: "Career record describes this implemented service",
    },
  ],
  requirements: state.run.result.requirements
    .filter((r: any) => r.bucket !== 3)
    .map((r: any) => ({
      id: r.id,
      presence: "absent",
      placement: null,
      quote: "",
    })),
  notes: "",
});
const submitter = (opts: any): ((s: CandidateSubmission) => Promise<any>) =>
  opts.mcpServers.resume.tools[0].handler;
const finished = (structuredOutput: unknown) => ({
  subtype: "success",
  structuredOutput,
  durationMs: 1,
  metrics: {},
  denied: [],
});
const write = (rel: string, text: string) => {
  const file = path.join(state.root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const events: JobEvent[] = [];
const run = (signal = new AbortController().signal, overwrite = false) =>
  runTailor(
    {
      runId: "test-run-123",
      slug: "acme-python",
      overwrite,
      model: "claude-sonnet-5-5",
    },
    (e) => events.push(e),
    signal,
  );
beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  write("profile/career.md", `${first}\n${second}`);
  write("profile/goals.md", "## Target roles\nBackend\n## Locations\nNYC");
  write("source/tech/resume.tex", master);
  write(REVIEW_RULES, "Classify\n## Job brief\n\nBrief\n");
  write(TAILOR_RULES, "Tailor");
  state.run = {
    version: 2,
    request: { jobPost: "Job", resume: "tech" },
    ...fixtureScore("2026-10-08"),
    savedAt: "",
  };
  state.run.result.meta.sources = loadInputSnapshot("tech", state.root).sources;
  state.update.mockImplementation((_id, change) => {
    change(state.run);
    return state.run;
  });
  state.build.mockImplementation(async (rel: string) => {
    const dir = path.join(state.root, path.dirname(rel), "artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const text = fs.readFileSync(path.join(state.root, rel), "utf8");
    for (const file of ["candidate.png", "candidate.pdf", "visible.txt"])
      fs.writeFileSync(path.join(dir, file), text);
    return {
      ok: true,
      pages: 1,
      fillPct: 97,
      ats: "PASS",
      warnings: [],
      failures: [],
      pdfPath: path.join(dir, "candidate.pdf"),
      pngPath: path.join(dir, "candidate.png"),
      raw: "",
    };
  });
});
afterEach(() => fs.rmSync(state.root, { recursive: true, force: true }));

describe("tailoring orchestration", () => {
  it("runs ChatGPT models through the tool loop with the same controlled submit", async () => {
    state.codexLoop.mockImplementation(async (opts) => {
      expect(opts).toMatchObject({ model: "gpt-6.1-sol", maxTurns: 20 });
      expect(opts.tool.name).toBe("submit_candidate");
      expect(opts.tool.inputSchema.required).toEqual([
        "candidateHash",
        "edits",
        "changes",
      ]);
      const response = await opts.tool.call(
        candidate(master, "Built Python backend services", first),
      );
      expect(response.content[1].type).toBe("image");
      return finished(
        report(master.replace("Built Python backend services", first)),
      );
    });
    const result = await runTailor(
      { runId: "test-run-123", slug: "acme-python", model: "gpt-6.1-sol" },
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(state.agent).not.toHaveBeenCalled();
    expect(state.build).toHaveBeenCalledTimes(1);
    expect(result.meta.model).toBe("gpt-6.1-sol");
    expect(
      fs.readFileSync(path.join(state.root, result.pdfPath!), "utf8"),
    ).toContain(first);
  });
  it("builds once, publishes the inspected candidate and cleans scratch", async () => {
    state.agent.mockImplementation(async (opts) => {
      expect(opts).toMatchObject({
        tools: [],
        settingSources: [],
        maxTurns: 20,
        allowedTools: ["mcp__resume__submit_candidate"],
      });
      const response = await submitter(opts)(
        candidate(master, "Built Python backend services", first),
      );
      expect(response.isError).toBeUndefined();
      expect(response.content[1].type).toBe("image");
      return finished(
        report(master.replace("Built Python backend services", first)),
      );
    });
    const result = await run();
    expect(state.build).toHaveBeenCalledTimes(1);
    expect(result.verification).toEqual({
      report: true,
      evidence: true,
      visual: true,
      readingOrder: true,
    });
    expect(
      fs.readFileSync(path.join(state.root, result.pdfPath!), "utf8"),
    ).toContain(first);
    expect(
      fs.readFileSync(path.join(state.root, "source/tech/resume.tex"), "utf8"),
    ).toBe(master);
    expect(
      fs.readdirSync(path.join(state.root, "ui/.cache/tailor-scratch")),
    ).toEqual([]);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });
  it("repairs a failed build within the candidate limit", async () => {
    state.build.mockImplementationOnce(async () => ({
      ok: false,
      pages: 2,
      ats: null,
      failures: ["overflow"],
      warnings: [],
      pdfPath: null,
      pngPath: null,
      raw: "",
    }));
    state.agent.mockImplementation(async (opts) => {
      const submit = submitter(opts);
      const a = master.replace("Built Python backend services", first);
      await submit(candidate(master, "Built Python backend services", first));
      await submit(candidate(a, first, second));
      return finished(
        report(master.replace("Built Python backend services", second)),
      );
    });
    const result = await run();
    expect(result.repairCount).toBe(1);
    expect(state.build).toHaveBeenCalledTimes(2);
  });
  it("reuses A after B without returning B's artifacts", async () => {
    state.agent.mockImplementation(async (opts) => {
      const submit = submitter(opts);
      const a = master.replace("Built Python backend services", first);
      const b = master.replace("Built Python backend services", second);
      await submit(candidate(master, "Built Python backend services", first));
      await submit(candidate(a, first, second));
      const response = await submit(candidate(b, second, first));
      expect(
        Buffer.from(response.content[1].data, "base64").toString(),
      ).not.toContain(second);
      return finished(report(a));
    });
    const result = await run();
    expect(state.build).toHaveBeenCalledTimes(2);
    expect(
      fs.readFileSync(path.join(state.root, result.pdfPath!), "utf8"),
    ).not.toContain(second);
  });
  it.each(["missing", "stale", "unresolved", "failed-visual"])(
    "preserves existing files for a %s report",
    async (failure) => {
      write("source/tailored/acme-python/resume.tex", "old source");
      write("resumes/tailored/acme-python/Resume.pdf", "old pdf");
      state.agent.mockImplementation(async (opts) => {
        await submitter(opts)(
          candidate(master, "Built Python backend services", first),
        );
        const r = report(
          master.replace("Built Python backend services", first),
        );
        if (failure === "stale") r.candidateHash = "a".repeat(64);
        if (failure === "unresolved") r.support[0].supported = false;
        if (failure === "failed-visual") r.visualPassed = false;
        return finished(failure === "missing" ? undefined : r);
      });
      await expect(run(undefined, true)).rejects.toThrow();
      expect(
        fs.readFileSync(
          path.join(state.root, "source/tailored/acme-python/resume.tex"),
          "utf8",
        ),
      ).toBe("old source");
      expect(
        fs.readFileSync(
          path.join(state.root, "resumes/tailored/acme-python/Resume.pdf"),
          "utf8",
        ),
      ).toBe("old pdf");
      expect(state.update).not.toHaveBeenCalled();
    },
  );
  it("refuses a publication symlink to a master even with overwrite approved", async () => {
    const target = path.join(
      state.root,
      "source/tailored/acme-python/resume.tex",
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(path.join(state.root, "source/tech/resume.tex"), target);
    state.agent.mockImplementation(async (opts) => {
      await submitter(opts)(
        candidate(master, "Built Python backend services", first),
      );
      return finished(
        report(master.replace("Built Python backend services", first)),
      );
    });
    await expect(run(undefined, true)).rejects.toThrow(/symlink/);
    expect(
      fs.readFileSync(path.join(state.root, "source/tech/resume.tex"), "utf8"),
    ).toBe(master);
  });
  it("stops after three submissions and refuses a fourth", async () => {
    state.agent.mockImplementation(async (opts) => {
      for (let i = 0; i < 4; i++)
        await submitter(opts)({
          candidateHash: contentHash(master),
          edits: [],
          changes: [],
        });
      return finished(undefined);
    });
    await expect(run()).rejects.toThrow(/repair limit/);
    expect(state.build).toHaveBeenCalledTimes(1);
  });
  it("blocks legacy review inputs before invoking Claude", async () => {
    state.run.result.meta.sources = undefined;
    await expect(run()).rejects.toThrow(/predates/);
    expect(state.agent).not.toHaveBeenCalled();
  });
  it("cancels a build and waits for cleanup", async () => {
    const controller = new AbortController();
    state.build.mockImplementation(async (_r, _p, opts) => {
      controller.abort();
      await new Promise((r) => setTimeout(r, 20));
      expect(opts.signal.aborted).toBe(true);
      return { ok: false, failures: ["cancelled"] };
    });
    state.agent.mockImplementation(async (opts) => {
      await submitter(opts)({
        candidateHash: contentHash(master),
        edits: [],
        changes: [],
      });
      return finished(undefined);
    });
    await expect(run(controller.signal)).rejects.toThrow(/Cancelled/);
    expect(
      fs.readdirSync(path.join(state.root, "ui/.cache/tailor-scratch")),
    ).toEqual([]);
  });
});
