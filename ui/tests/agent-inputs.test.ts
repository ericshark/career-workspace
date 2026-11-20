import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contentHash,
  loadInputSnapshot,
  assertSourcesCurrent,
  REVIEW_RULES,
  TAILOR_RULES,
  reviewCareer,
} from "@/lib/claude/inputs";
import { runAgent } from "@/lib/claude/agent";
import { normalizeReview } from "@/lib/claude/schemas";
import { fixtureAnalysis, fixtureScore } from "@/lib/claude/fixtures";
import { buildScorePrompt } from "@/lib/claude/score";
import { buildTailorPrompt } from "@/lib/claude/tailor";
import { buildBrief } from "@/lib/brief";
import type { RunRecord } from "@/lib/runs";

const sdk = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: sdk.query }));
const roots: string[] = [];
beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "fixture"));
afterEach(() => {
  roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true }));
  roots.length = 0;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
function snapshotRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-inputs-"));
  roots.push(root);
  const files = {
    "profile/career.md":
      "## Contact\nPrivate contact details.\n## Eligibility\nPrivate screening details.\n## Target Roles\nBackend engineering.\n## Projects\nFinished Python project.",
    "profile/goals.md":
      "## Target roles\nBackend\n## Other\nprivate unrelated\n## Locations\nNYC",
    "source/tech/resume.tex": String.raw`\begin{document}\section{Experience}\resumeItem{Built Python API}\end{document}`,
    [REVIEW_RULES]: "classify\n## Job brief\n\nbrief\n",
    [TAILOR_RULES]: "tailor",
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
describe("immutable explicit agent inputs", () => {
  it("supplies career facts, embedded target roles and visible text without reading goals.md", () => {
    const root = snapshotRoot();
    fs.unlinkSync(path.join(root, "profile/goals.md"));
    const snapshot = loadInputSnapshot("tech", root);
    fs.writeFileSync(path.join(root, "profile/career.md"), "changed");
    expect(snapshot.careerMd).toContain("Finished Python project");
    expect(Object.isFrozen(snapshot.sources.hashes)).toBe(true);
    expect(snapshot.sources.hashes).not.toHaveProperty("profile/goals.md");
    expect(snapshot.resumeVisible).toContain("## Experience");
    const prompt = buildScorePrompt(
      { jobPost: "Injected instructions", resume: "tech" },
      snapshot,
    );
    expect(prompt).toContain("## Target Roles\nBackend engineering.");
    expect(prompt).not.toMatch(
      /Private contact|Private screening|## Eligibility|## Contact/,
    );
    expect(prompt).not.toContain("<target_goals>");
    expect(prompt.indexOf("Finished Python project")).toBeLessThan(
      prompt.indexOf("Injected instructions"),
    );
    expect(() => assertSourcesCurrent(snapshot.sources, root)).toThrow(
      /Source changed/,
    );
  });
  it("rejects source aliases inside the workspace, including source stamps", () => {
    const root = snapshotRoot();
    const snapshot = loadInputSnapshot("tech", root);
    const file = path.join(root, "profile/career.md");
    const alternate = path.join(root, "profile/alias.md");
    fs.renameSync(file, alternate);
    fs.symlinkSync(alternate, file);
    expect(() => loadInputSnapshot("tech", root)).toThrow(/Source outside/);
    expect(() => assertSourcesCurrent(snapshot.sources, root)).toThrow(
      /Source changed/,
    );
  });
  it("rejects missing and malformed stamps", () => {
    expect(() => assertSourcesCurrent(undefined)).toThrow(/predates/);
    expect(() => assertSourcesCurrent({ version: 1, hashes: {} })).toThrow(
      /Incomplete/,
    );
  });
  it("validates legacy goals hashes when present, without requiring them in new snapshots", () => {
    const root = snapshotRoot();
    const snapshot = loadInputSnapshot("tech", root);
    expect(() => assertSourcesCurrent(snapshot.sources, root)).not.toThrow();
    const goals = path.join(root, "profile/goals.md");
    const legacy = {
      version: 1 as const,
      hashes: {
        ...snapshot.sources.hashes,
        "profile/goals.md": contentHash(fs.readFileSync(goals)),
      },
    };
    expect(() => assertSourcesCurrent(legacy, root)).not.toThrow();
    fs.writeFileSync(goals, "changed");
    expect(() => assertSourcesCurrent(legacy, root)).toThrow(/Source changed/);
  });
  it("rejects symlink escapes", () => {
    const root = snapshotRoot();
    const career = path.join(root, "profile/career.md");
    fs.unlinkSync(career);
    fs.symlinkSync("/etc/passwd", career);
    expect(() => loadInputSnapshot("tech", root)).toThrow(/outside/);
  });
});

it("supplies Tailor with the full career, exact selected master, saved job context and complete review evidence", () => {
  const root = snapshotRoot();
  const snapshot = loadInputSnapshot("tech", root);
  const record: RunRecord = {
    version: 2,
    ...fixtureScore("2026-10-20"),
    request: {
      resume: "tech",
      jobPost: "# Backend role\nBuild Python services. Docker preferred.",
    },
    savedAt: "2026-10-20T10:00:00Z",
  };
  const brief = buildBrief(record, "backend-role");
  const prompt = buildTailorPrompt(
    brief,
    contentHash(snapshot.resumeTex),
    snapshot,
  );
  expect(prompt).toContain(
    `<career_record>\n${snapshot.careerMd}\n</career_record>`,
  );
  expect(prompt).toContain(
    `<master_tex path="source/tech/resume.tex">\n${snapshot.resumeTex}\n</master_tex>`,
  );
  expect(prompt).toContain(record.request.jobPost);
  expect(prompt).toContain(contentHash(snapshot.resumeTex));
  const data = JSON.parse(
    prompt.match(/<tailoring_brief>\n([\s\S]*?)\n<\/tailoring_brief>/)![1],
  );
  expect(data).not.toHaveProperty("mode");
  expect(
    data.underrepresented.find((r: { id: string }) => r.id === "r5").career,
  ).toBe("partial");
  expect(
    data.onResume.length +
      data.underrepresented.length +
      data.unsupported.length,
  ).toBe(record.result.requirements.length);
  expect(data.missingTerms).toEqual(record.result.match.termsMissing);
  expect(data.recommendedChanges).toEqual(record.result.recommendedChanges);
  expect(data.unsupported.map((r: { text: string }) => r.text)).toContain(
    "AWS",
  );
});

describe("SDK isolation and metrics", () => {
  it("removes builtins/settings, preserves structured output, and records available usage", async () => {
    sdk.query.mockImplementation(async function* () {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "StructuredOutput", input: {} }],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        structured_output: { ok: true },
        duration_ms: 23,
        duration_api_ms: 20,
        num_turns: 2,
        usage: { input_tokens: 10, output_tokens: 4 },
      };
    });
    const out = await runAgent({
      prompt: "data",
      systemPrompt: "rules",
      tools: [],
      settingSources: [],
      model: "claude-sonnet-5-5",
      allowedTools: [],
      maxTurns: 6,
      outputSchema: { type: "object" },
      decide: (name) => ({ allow: name === "StructuredOutput" }),
    });
    expect(sdk.query.mock.calls[0][0].options).toMatchObject({
      tools: [],
      settingSources: [],
      systemPrompt: "rules",
      maxTurns: 6,
      outputFormat: { type: "json_schema" },
    });
    expect(out.structuredOutput).toEqual({ ok: true });
    expect(out.metrics).toMatchObject({
      sdkDurationMs: 23,
      apiDurationMs: 20,
      turns: 2,
      inputTokens: 10,
      outputTokens: 4,
      toolCalls: 1,
    });
    expect(out.metrics.cacheReadTokens).toBeUndefined();
  });
  it("never invents unavailable API/turn/token counts", async () => {
    sdk.query.mockImplementation(async function* () {
      yield { type: "result", subtype: "success" };
    });
    const out = await runAgent({
      prompt: "x",
      model: "claude-sonnet-5-5",
      allowedTools: [],
      maxTurns: 1,
    });
    expect(out.metrics.apiDurationMs).toBeUndefined();
    expect(out.metrics.turns).toBeUndefined();
  });
});

describe("review repairs", () => {
  it("repairs slips in place instead of discarding the review", () => {
    const out = fixtureAnalysis();
    const [prominent, noQuote, noPlacement, stray] = out.requirements;
    Object.assign(prominent, {
      resume: "bullet",
      resumeQuote: "x",
      placement: "prominent",
      fix: "light",
    });
    Object.assign(noQuote, {
      career: "strong",
      careerQuote: " ",
      fix: "heavy",
    });
    Object.assign(noPlacement, {
      resume: "skills",
      resumeQuote: "x",
      placement: null,
    });
    Object.assign(stray, { resume: "absent", resumeQuote: "x" });
    out.requirements.push({ ...out.requirements[0] });
    out.recommendedChanges.push({
      action: "surface",
      requirementId: "unknown",
      text: "x",
    });
    normalizeReview(out);
    expect(prominent.fix).toBeNull();
    // Claude's credit stands even without a quote: quotes never change a score.
    expect(noQuote.career).toBe("strong");
    expect(noPlacement.placement).toBe("buried");
    expect(stray.resumeQuote).toBe("");
    expect(new Set(out.requirements.map((r) => r.id)).size).toBe(
      out.requirements.length,
    );
    expect(out.recommendedChanges.at(-1)!.requirementId).toBe("");
  });
  it("hashes exact source bytes", () =>
    expect(contentHash("a")).not.toBe(contentHash("a\n")));
});

describe("reviewCareer", () => {
  it("keeps work evidence as a line subset, excluding templates and administrative sections", () => {
    const md = [
      "## Contact",
      "Private phone and home location.",
      "## Eligibility",
      "US citizen.",
      "## Fixed Fields",
      "Availability date.",
      "## Experience",
      "### Intern — Acme",
      "**What I did:** Built FastAPI services.",
      "**Key facts & numbers:**",
      "- 40+ tests",
      "",
      "**Example bullets: Technical (default):**",
      "- Built FastAPI services.",
      "",
      "**Example bullets: General / non-technical:**",
      "- Collaborated with teams.",
      "",
      "---",
      "### Tutor — College",
      "**What I did:** Tutored students.",
      "**Example bullets: Technical:**",
      "- Tutored 50+ students.",
      "### Next — Co",
      "**Dates:** 2025",
      "## Summary Statements",
      "- **Tech resume:** Full-stack engineer.",
      "## Skills",
      "Python",
    ].join("\n");
    const trimmed = reviewCareer(md);
    expect(trimmed).not.toMatch(/Example bullets|Collaborated|Tutored 50\+/);
    expect(trimmed).not.toMatch(/Summary Statements|Full-stack engineer/);
    expect(trimmed).not.toMatch(
      /Contact|Eligibility|US citizen|Fixed Fields|Availability date|Private phone/,
    );
    for (const kept of [
      "**What I did:** Built FastAPI services.",
      "- 40+ tests",
      "---",
      "**What I did:** Tutored students.",
      "### Next — Co",
      "**Dates:** 2025",
      "## Skills",
      "Python",
    ])
      expect(trimmed).toContain(kept);
    const lines = new Set(md.split("\n"));
    expect(trimmed.split("\n").every((l) => lines.has(l))).toBe(true);
  });

  it.each(["tech", "general", "datacenter"] as const)(
    "supplies only the selected %s resume's visible content and the exact pasted job",
    (resume) => {
      const root = snapshotRoot();
      for (const category of ["tech", "general", "datacenter"]) {
        const file = path.join(root, `source/${category}/resume.tex`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
          file,
          String.raw`\documentclass{article}
% Hidden preamble marker
\begin{document}\section{Experience}\resumeItem{Selected ${category} evidence}\end{document}`,
        );
      }
      const jobPost = "Backend role. Python APIs required. Docker preferred.";
      const prompt = buildScorePrompt(
        { resume, jobPost },
        loadInputSnapshot(resume, root),
      );
      expect(prompt).toContain(
        `<selected_resume path="source/${resume}/resume.tex">`,
      );
      expect(prompt).toContain(`## Experience`);
      expect(prompt).toContain(`Selected ${resume} evidence`);
      for (const other of ["tech", "general", "datacenter"].filter(
        (r) => r !== resume,
      ))
        expect(prompt).not.toContain(`Selected ${other} evidence`);
      expect(prompt).not.toMatch(
        /documentclass|Hidden preamble|Private contact|Private screening/,
      );
      expect(prompt).toContain(`<job_post>\n${jobPost}\n</job_post>`);
      expect(prompt).toContain("Finished Python project.");
    },
  );
});

describe("moved prompt source compatibility", () => {
  const legacy: Record<string, string> = {
    [REVIEW_RULES]: ".claude/skills/apply/classification.md",
    [TAILOR_RULES]: ".claude/skills/build-resume/tailoring.md",
  };
  function legacyStamp(root: string) {
    const stamp = loadInputSnapshot("tech", root).sources;
    return {
      version: 1 as const,
      hashes: Object.fromEntries(
        Object.entries(stamp.hashes)
          .filter(([rel]) => rel !== "prompts/job-brief.md")
          .map(([rel, hash]) => [
            legacy[rel] ?? rel,
            rel === REVIEW_RULES ? contentHash("classify") : hash,
          ]),
      ),
    };
  }
  it("accepts old keys at canonical paths without editing the stored stamp", () => {
    const root = snapshotRoot();
    const stamp = legacyStamp(root);
    const before = JSON.stringify(stamp);
    assertSourcesCurrent(stamp, root);
    expect(JSON.stringify(stamp)).toBe(before);
    expect(fs.existsSync(path.join(root, ".claude"))).toBe(false);
  });
  it.each([REVIEW_RULES, TAILOR_RULES])(
    "rejects changed canonical rules for old keys: %s",
    (rel) => {
      const root = snapshotRoot();
      const stamp = legacyStamp(root);
      fs.writeFileSync(path.join(root, rel), "changed instructions");
      expect(() => assertSourcesCurrent(stamp, root)).toThrow(/Source changed/);
    },
  );
  it("rejects conflicting legacy/canonical entries", () => {
    const root = snapshotRoot();
    const stamp = legacyStamp(root);
    stamp.hashes[REVIEW_RULES] = "different hash";
    expect(() => assertSourcesCurrent(stamp, root)).toThrow(/Conflicting/);
  });
  it("new stamps also detect changes to job-brief instructions", () => {
    const root = snapshotRoot();
    const stamp = loadInputSnapshot("tech", root).sources;
    fs.appendFileSync(path.join(root, REVIEW_RULES), "changed brief");
    expect(() => assertSourcesCurrent(stamp, root)).toThrow(/Source changed/);
  });
});

it("validates pre-inline review and job-brief hashes using current inline content", () => {
  const root = snapshotRoot();
  const stamp = loadInputSnapshot("tech", root).sources;
  const hashes = {
    ...stamp.hashes,
    [REVIEW_RULES]: contentHash("classify"),
    "prompts/job-brief.md": contentHash("brief\n"),
  };
  assertSourcesCurrent({ version: 1, hashes }, root);
  fs.appendFileSync(path.join(root, REVIEW_RULES), "changed brief");
  expect(() => assertSourcesCurrent({ version: 1, hashes }, root)).toThrow(
    /Source changed/,
  );
});
