import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureScore, FIXTURE_POST } from "@/lib/claude/fixtures";
import {
  buildCoverPrompt,
  buildQuestionsPrompt,
  unsupportedNumbers,
} from "@/lib/claude/extras";
import {
  loadCoverInputs,
  loadQuestionsInputs,
  applicationCareer,
} from "@/lib/claude/inputs";
import {
  CoverLetterSchema,
  QuestionsSchema,
  questionsJsonSchema,
} from "@/lib/claude/schemas";
import type { RunRecord } from "@/lib/runs";
import type { QuickRecord } from "@/lib/types";

const repo = path.resolve(import.meta.dirname, "../..");

describe("extras inputs stay small", () => {
  it("the questions prompt supplies explicit career evidence without fixed answers", () => {
    const prompt = buildQuestionsPrompt(
      { careerEvidence: "Supported FastAPI experience" },
      "Job post text",
      "Why us?",
    );
    expect(prompt).toContain(
      "<career_record>\nSupported FastAPI experience\n</career_record>",
    );
    expect(prompt).not.toContain("<fixed_answers>");
    expect(prompt).toContain("<questions>\nWhy us?\n</questions>");
    expect(prompt).not.toContain("<review_context>");
    for (const body of [
      "Orchard Systems",
      "Queue Monitor",
      "## Skills",
      "## Contact",
    ])
      expect(prompt).not.toContain(body);
  });

  it("questions entered one per box become numbered blocks, multi-part ones kept whole", () => {
    const prompt = buildQuestionsPrompt(
      { careerEvidence: "Supported experience" },
      "Job",
      [
        "Tell us about a project.\n(a) What did you build?\n(b) What was hard?",
        " Why us? ",
      ],
    );
    expect(prompt).toContain(
      '<questions>\n<question number="1">\nQuestion 1\nTell us about a project.\n(a) What did you build?\n(b) What was hard?\n</question>\n\n<question number="2">\nQuestion 2\nWhy us?\n</question>\n</questions>',
    );
    expect(prompt).toMatch(/exactly one answer entry per block/);
  });

  it("the cover-letter loader reads current trimmed career facts without a sample letter", async () => {
    await setup();
    const inputs = loadCoverInputs("source/tech/resume.tex", root);
    expect(inputs.resumeVisible).toContain("## Experience");
    expect(inputs.careerEvidence).toContain("## Experience");
    expect(inputs.careerEvidence).not.toContain("## Contact");
    expect(inputs).not.toHaveProperty("goldStandard");
    expect(fs.existsSync(path.join(root, "source/tech/cover-letter.tex"))).toBe(
      false,
    );
    fs.unlinkSync(path.join(root, "profile/career.md"));
    expect(() => loadCoverInputs("source/tech/resume.tex", root)).toThrow(
      /Missing profile\/career.md/,
    );
  });

  it("the letter prompt sends career and selected-resume facts with a direct final task", () => {
    const prompt = buildCoverPrompt(
      {
        resumeVisible: "## Experience\nSelected resume content",
        careerEvidence: "Current supported career facts",
      },
      "Job post text",
      "Company: Acme",
    );
    expect(prompt).toContain(
      "<resume>\n## Experience\nSelected resume content",
    );
    expect(prompt).toContain(
      "<career_record>\nCurrent supported career facts\n</career_record>",
    );
    expect(prompt).toContain("<review_context>\nCompany: Acme");
    expect(prompt).not.toContain("story bank");
    expect(prompt.trim().endsWith("voice, structure and truth rules.")).toBe(
      true,
    );
    expect(prompt.indexOf("</job_post>")).toBeLessThan(
      prompt.indexOf("Write the workspace owner's cover letter"),
    );
  });

  it("flags numbers the resume does not contain", () => {
    const resume = "Honors, May 2025 · 3-1-1 routing · 74 tests";
    expect(
      unsupportedNumbers("In 2025 I wrote 74 tests for 3-1-1.", resume),
    ).toEqual([]);
    expect(
      unsupportedNumbers("I cut costs 35% for 1,000 users.", resume),
    ).toEqual(["35", "1,000"]);
  });

  it("schemas accept the documented shapes", () => {
    expect(
      QuestionsSchema.safeParse({
        company: { name: "Acme", whatTheyDo: "Builds rockets." },
        answers: [
          {
            question: "Why?",
            options: ["A", "B", "C"],
            needsUser: "",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      QuestionsSchema.safeParse({
        company: { name: "", whatTheyDo: "" },
        answers: [{ question: "Why?", options: [], needsUser: "" }],
      }).success,
    ).toBe(false);
    expect(
      CoverLetterSchema.safeParse({ letter: "x".repeat(300), namedFacts: [] })
        .success,
    ).toBe(true);
  });
});

// CAREER_ROOT is read when lib/paths.ts loads: point it at a temp dir and import fresh.
let root: string;
async function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "extras-"));
  process.env.CAREER_ROOT = root;
  for (const rel of [
    "profile/career.md",
    "prompts/answer-questions.md",
    "prompts/cover-letter.md",
    "source/tech/resume.tex",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), path.join(root, rel));
  }
  vi.resetModules();
  return {
    extras: await import("@/lib/extras"),
    reviews: await import("@/lib/reviews"),
    runs: await import("@/lib/runs"),
  };
}
afterEach(() => {
  delete process.env.CAREER_ROOT;
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

const quick = (): QuickRecord => ({
  version: 2,
  kind: "quick",
  id: "quick-0001-abcd",
  savedAt: "2026-10-19T12:00:00Z",
  reviewedAt: "2026-10-19",
  request: { jobPost: FIXTURE_POST, link: "https://example.com/job/1" },
  extract: {
    company: "Fixture Co",
    role: "Backend Engineer",
    location: "Remote",
    workMode: "remote",
    level: "entry",
    postedText: "",
    postedDate: "",
    jobId: "",
    suggestedResume: "tech",
  },
  age: {
    band: "unknown",
    date: null,
    days: null,
    quote: "",
  } as QuickRecord["age"],
  decision: "applied",
  resume: "tech",
});

describe("generateExtras (fixtures)", () => {
  it("saves answers and a letter with a quick add; question sets append", async () => {
    const { extras, reviews } = await setup();
    const saved = reviews.saveQuick(quick());
    const target = { kind: "quick" as const, id: "quick-0001-abcd" };
    await extras.generateExtras(
      {
        target,
        questions: ["Why us?", "Tell us about a project you built.", " "],
        coverLetter: true,
        model: "claude-sonnet-5-5",
      },
      undefined,
      true,
    );
    const second = await extras.generateExtras(
      { target, questions: "Anything else?", model: "claude-sonnet-5-5" },
      undefined,
      true,
    );
    expect(second.questions).toHaveLength(2);
    for (const answer of second.questions![0].result.answers) {
      expect(answer.options).toHaveLength(3);
      expect(answer).not.toHaveProperty("kind");
      expect(answer.needsUser).toBe("");
    }
    expect(second.coverLetter?.resume).toBe("tech");
    expect(second.coverLetter?.result.letter).toMatch(/^Dear Hiring Manager/);
    const md = fs.readFileSync(path.join(root, saved.mdPath), "utf8");
    expect(md).toContain("## Application extras");
    expect(md).toContain("### Cover letter");
    expect(md.indexOf("## Application extras")).toBeLessThan(
      md.indexOf("## Original job post"),
    );
  });

  it("saves extras with a review and uses the selected resume", async () => {
    const { extras, runs, reviews } = await setup();
    const { result, analysis } = fixtureScore(
      "2026-10-19",
      undefined,
      undefined,
      "run-0001-abcd",
    );
    const rec: RunRecord = {
      version: 2,
      request: { jobPost: FIXTURE_POST, resume: "tech" },
      analysis,
      result,
      savedAt: "2026-10-19T12:00:00Z",
    };
    runs.persistRun(rec);
    const out = await extras.generateExtras(
      {
        target: { kind: "review", id: "run-0001-abcd" },
        coverLetter: true,
        resume: "tech",
        model: "claude-sonnet-5-5",
      },
      undefined,
      true,
    );
    expect(out.coverLetter?.resume).toBe("tech");
    expect(runs.loadRun("run-0001-abcd")?.extras?.coverLetter).toBeTruthy();
    const summary = reviews
      .listReviews()
      .find((r) => r.id === "run-0001-abcd")!;
    expect(fs.readFileSync(path.join(root, summary.mdPath), "utf8")).toContain(
      "### Cover letter",
    );
  });

  it("rejects empty requests, unknown records and unsafe resumes", async () => {
    const { extras, reviews } = await setup();
    reviews.saveQuick(quick());
    const model = "claude-sonnet-5-5" as const;
    await expect(
      extras.generateExtras(
        {
          target: { kind: "quick", id: "quick-0001-abcd" },
          questions: "  ",
          model,
        },
        undefined,
        true,
      ),
    ).rejects.toThrow(/questions or ask/);
    await expect(
      extras.generateExtras(
        {
          target: { kind: "quick", id: "missing-0001" },
          coverLetter: true,
          model,
        },
        undefined,
        true,
      ),
    ).rejects.toThrow(/Unknown quick add/);
    expect(() => extras.resumeTexPath("../../etc")).toThrow();
    expect(() => extras.resumeTexPath("tailored/../x")).toThrow();
    expect(extras.resumeTexPath("tailored/acme-swe")).toBe(
      "source/tailored/acme-swe/resume.tex",
    );
  });
});

it("requests only open-ended answer options without a classification field", () => {
  expect(JSON.stringify(questionsJsonSchema())).not.toContain('"kind"');
  expect(
    QuestionsSchema.safeParse({
      company: { name: "Acme", whatTheyDo: "Builds software" },
      answers: [
        { question: "Why us?", options: ["One answer"], needsUser: "" },
      ],
    }).success,
  ).toBe(false);
});

it.each([2, 3, 4, 5])(
  "requires exactly three answer variants, received %i",
  (count) => {
    const parsed = QuestionsSchema.safeParse({
      company: { name: "Acme", whatTheyDo: "Builds software" },
      answers: [
        {
          question: "Why this role?",
          options: Array.from({ length: count }, (_, i) => `Variant ${i + 1}`),
          needsUser: "",
        },
      ],
    });
    expect(parsed.success).toBe(count === 3);
  },
);

it("trims copied resume wording and contact details but keeps factual scope and skill levels", () => {
  const career = applicationCareer(
    [
      "## Resume usage rules",
      "No invented facts.",
      "## Contact",
      "Private phone and email",
      "",
      "## Experience",
      "### Intern",
      "**What I did:** Built FastAPI services.",
      "**Key facts & numbers:**",
      "- Tested services.",
      "**Example bullets: Technical:**",
      "- Resume template wording.",
      "## Skills",
      "Python: Proficient. Kubernetes: Explored.",
      "## Summary Statements",
      "Copied summary wording.",
    ].join("\n"),
  );
  expect(career).toContain("Built FastAPI services");
  expect(career).toContain("No invented facts");
  expect(career).toContain("Kubernetes: Explored");
  expect(career).not.toMatch(
    /Private phone|## Contact|Resume template wording|Copied summary wording/,
  );
});

it("requires current career evidence and reloads edits for the next question call", async () => {
  await setup();
  const file = path.join(root, "profile/career.md");
  fs.writeFileSync(file, "## Experience\nBuilt a supported API.");
  expect(loadQuestionsInputs(root).careerEvidence).toContain("supported API");
  fs.writeFileSync(file, "## Experience\nAdded current experience.");
  expect(loadQuestionsInputs(root).careerEvidence).toContain(
    "current experience",
  );
  fs.unlinkSync(file);
  expect(() => loadQuestionsInputs(root)).toThrow(/Missing profile\/career.md/);
});

it("sends career evidence in the actual question query and preserves ranked variant order", async () => {
  const agent = await import("@/lib/claude/agent");
  const result = {
    company: { name: "Acme", whatTheyDo: "Builds software" },
    answers: [
      {
        question: "Why this role?",
        options: [
          "Best supported answer",
          "Different evidence",
          "Different emphasis",
        ],
        needsUser: "",
      },
    ],
  };
  const query = vi.spyOn(agent, "runAgent").mockResolvedValue({
    subtype: "success",
    structuredOutput: result,
    metrics: {},
    durationMs: 0,
    denied: [],
  });
  try {
    const { answerQuestions } = await import("@/lib/claude/extras");
    const answers = await answerQuestions(
      {
        questionsRules: "Use career facts; strongest variant first.",
        careerEvidence: "Built a supported FastAPI service.",
      },
      "Acme job brief",
      ["Why this role?"],
      "claude-sonnet-5-5",
    );
    expect(query).toHaveBeenCalledTimes(1);
    const sent = query.mock.calls[0][0];
    expect(sent.prompt).toContain(
      "<career_record>\nBuilt a supported FastAPI service.\n</career_record>",
    );
    expect(sent.prompt).toContain("Acme job brief");
    expect(sent.prompt).not.toMatch(/<resume>|<fixed_answers>/);
    expect(sent.maxTurns).toBe(3);
    expect(sent.tools).toEqual([]);
    expect(answers.answers[0].options).toEqual(result.answers[0].options);
  } finally {
    query.mockRestore();
  }
});

it("generates questions without resume or letter files", async () => {
  const { extras, reviews } = await setup();
  reviews.saveQuick(quick());
  fs.rmSync(path.join(root, "source"), { recursive: true });
  fs.unlinkSync(path.join(root, "prompts/cover-letter.md"));
  const result = await extras.generateExtras(
    {
      target: { kind: "quick", id: "quick-0001-abcd" },
      questions: ["Why this role?"],
      model: "claude-sonnet-5-5",
    },
    undefined,
    true,
  );
  expect(result.questions![0].result.answers[0].options).toHaveLength(3);
});

it("generates a cover letter without question rules or sample letter files", async () => {
  const { extras, reviews } = await setup();
  reviews.saveQuick(quick());
  fs.unlinkSync(path.join(root, "prompts/answer-questions.md"));
  const result = await extras.generateExtras(
    {
      target: { kind: "quick", id: "quick-0001-abcd" },
      coverLetter: true,
      model: "claude-sonnet-5-5",
    },
    undefined,
    true,
  );
  expect(result.coverLetter?.result.letter).toMatch(/^Dear Hiring Manager/);
});

it("rejects numeric substrings that are not whole supported numeric tokens", () => {
  expect(unsupportedNumbers("I wrote 15 tests.", "150 tests in 2025")).toEqual([
    "15",
  ]);
});

it.each([false, true])(
  "cover calls use current evidence and retry unsupported numbers (exhaust=%s)",
  async (exhaust) => {
    const agent = await import("@/lib/claude/agent");
    const letter = (number: number) =>
      `Dear Hiring Manager,\n\nI'm interested in helping your team build dependable software. At Orchard Systems I worked on ${number} unit tests, which gave me practical experience checking behavior carefully. I'd enjoy bringing that approach to the work described in this role.\n\nThank you for your consideration.\n\nSincerely,\nthe workspace owner`;
    const result = (number: number) => ({
      subtype: "success",
      structuredOutput: {
        letter: letter(number),
        namedFacts: ["Orchard Systems"],
      },
      metrics: {},
      durationMs: 0,
      denied: [],
    });
    const query = vi
      .spyOn(agent, "runAgent")
      .mockResolvedValueOnce(result(88))
      .mockResolvedValueOnce(result(exhaust ? 88 : 17));
    try {
      const { writeCoverLetter } = await import("@/lib/claude/extras");
      const pending = writeCoverLetter(
        {
          coverRules: "Use current career facts.",
          careerEvidence: "At Orchard Systems, wrote 17 unit tests.",
          resumeVisible: "Orchard Systems software internship",
        },
        "Acme job brief",
        "claude-sonnet-5-5",
      );
      if (exhaust)
        await expect(pending).rejects.toThrow(
          /numbers absent from the supplied career and resume evidence/,
        );
      else expect((await pending).letter).toContain("17 unit tests");
      expect(query).toHaveBeenCalledTimes(2);
      const sent = query.mock.calls[0][0];
      expect(sent.systemPrompt).toBe("Use current career facts.");
      expect(sent.prompt).toContain(
        "<career_record>\nAt Orchard Systems, wrote 17 unit tests.\n</career_record>",
      );
      expect(sent.prompt).toContain(
        "<resume>\nOrchard Systems software internship\n</resume>",
      );
      expect(sent.prompt).not.toMatch(/gold_standard|story bank/);
      expect(query.mock.calls[1][0].prompt).toContain("(88)");
      expect(sent.maxTurns).toBe(3);
    } finally {
      query.mockRestore();
    }
  },
);

it("accepts numbers that come from the job's company and role", async () => {
  const agent = await import("@/lib/claude/agent");
  const query = vi.spyOn(agent, "runAgent").mockResolvedValue({
    subtype: "success",
    structuredOutput: {
      letter:
        "Dear Hiring Manager,\n\nI'm excited about the Software Engineer, New Grad 2027 role at 23andMe because it centers on building dependable software that people rely on every day.\n\nThank you for your consideration.\n\nSincerely,\nthe workspace owner",
      namedFacts: [],
    },
    metrics: {},
    durationMs: 0,
    denied: [],
  } as Awaited<ReturnType<typeof agent.runAgent>>);
  try {
    const { writeCoverLetter } = await import("@/lib/claude/extras");
    const result = await writeCoverLetter(
      {
        coverRules: "Use current career facts.",
        careerEvidence: "Backend internship.",
        resumeVisible: "Software internship",
      },
      "Acme job brief",
      "claude-sonnet-5-5",
      undefined,
      undefined,
      "23andMe\nSoftware Engineer, New Grad 2027",
    );
    expect(result.letter).toContain("New Grad 2027");
    expect(query).toHaveBeenCalledTimes(1);
  } finally {
    query.mockRestore();
  }
});

it("loads career facts again for the next cover letter", async () => {
  await setup();
  const file = path.join(root, "profile/career.md");
  fs.writeFileSync(file, "## Experience\nCurrent supported backend work.");
  expect(
    loadCoverInputs("source/tech/resume.tex", root).careerEvidence,
  ).toContain("backend work");
  fs.writeFileSync(file, "## Experience\nUpdated supported frontend work.");
  expect(
    loadCoverInputs("source/tech/resume.tex", root).careerEvidence,
  ).toContain("frontend work");
});

describe("the workspace owner's note", () => {
  it("goes after the job post in both prompts and is omitted when blank", () => {
    const inputs = {
      careerEvidence: "Supported experience",
      resumeVisible: "Resume text",
    };
    const questions = buildQuestionsPrompt(
      inputs,
      "Job post",
      ["Why us?"],
      undefined,
      "Keep it casual; mention my homelab",
    );
    const cover = buildCoverPrompt(
      inputs,
      "Job post",
      undefined,
      [],
      "Keep it casual",
    );
    for (const prompt of [questions, cover]) {
      expect(prompt).toContain("<eric_note>\nKeep it casual");
      expect(prompt.indexOf("<eric_note>")).toBeGreaterThan(
        prompt.indexOf("</job_post>"),
      );
      expect(prompt).toMatch(/does not relax the truth rules/);
    }
    expect(
      buildQuestionsPrompt(inputs, "Job", ["Why us?"], undefined, "  "),
    ).not.toContain("<eric_note>");
    expect(buildCoverPrompt(inputs, "Job")).not.toContain("<eric_note>");
  });

  it("counts numbers the workspace owner typed in the note as evidence for the letter", async () => {
    const agent = await import("@/lib/claude/agent");
    const letter = `Dear Hiring Manager,\n\nI'm interested in helping your team build dependable software, and I've spent 3 years around Chicago's tech community learning how teams ship. I'd enjoy bringing a careful, practical approach to the work described in this role and learning from the people doing it.\n\nThank you for your consideration.\n\nSincerely,\nthe workspace owner`;
    const query = vi.spyOn(agent, "runAgent").mockResolvedValue({
      subtype: "success",
      structuredOutput: { letter, namedFacts: [] },
      metrics: {},
      durationMs: 0,
      denied: [],
    });
    try {
      const { writeCoverLetter } = await import("@/lib/claude/extras");
      const inputs = {
        coverRules: "Rules",
        resumeVisible: "Resume",
        careerEvidence: "Career",
      };
      await expect(
        writeCoverLetter(inputs, "Job", "claude-sonnet-5-5"),
      ).rejects.toThrow(/numbers absent/);
      query.mockClear();
      const out = await writeCoverLetter(
        inputs,
        "Job",
        "claude-sonnet-5-5",
        undefined,
        undefined,
        "",
        "Mention my 3 years in Chicago",
      );
      expect(out.letter).toBe(letter);
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      query.mockRestore();
    }
  });

  it("is saved with the answer set and the letter", async () => {
    const { extras, reviews } = await setup();
    const saved = reviews.saveQuick(quick());
    const out = await extras.generateExtras(
      {
        target: { kind: "quick", id: "quick-0001-abcd" },
        questions: ["Why us?"],
        coverLetter: true,
        note: "  Keep it casual  ",
        model: "claude-sonnet-5-5",
      },
      undefined,
      true,
    );
    expect(out.questions![0].note).toBe("Keep it casual");
    expect(out.coverLetter?.note).toBe("Keep it casual");
    const md = fs.readFileSync(path.join(root, saved.mdPath), "utf8");
    expect(md).toContain("Note: Keep it casual");
  });
});

it("stops and awaits the sibling Extras call when one generation fails", async () => {
  const { extras, reviews } = await setup();
  reviews.saveQuick(quick());
  const model = await import("@/lib/claude/extras");
  let cleaned = false;
  const answers = vi
    .spyOn(model, "answerQuestions")
    .mockRejectedValue(new Error("Questions failed"));
  const letter = vi.spyOn(model, "writeCoverLetter").mockImplementation(
    (_inputs, _post, _model, _review, signal) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => {
          Promise.resolve().then(() => {
            cleaned = true;
            reject(new Error("Letter cancelled"));
          });
        });
      }),
  );
  try {
    await expect(
      extras.generateExtras(
        {
          target: { kind: "quick", id: "quick-0001-abcd" },
          questions: ["Why us?"],
          coverLetter: true,
          model: "gpt-6.1-sol",
        },
        undefined,
        false,
      ),
    ).rejects.toThrow("Questions failed");
    expect(cleaned).toBe(true);
    expect(
      (reviews.findSaved("quick-0001-abcd")!.record as QuickRecord).extras,
    ).toBeUndefined();
  } finally {
    answers.mockRestore();
    letter.mockRestore();
  }
});

it("retains new factual career sections in the actual questions prompt on every load", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "career-question-coverage-"),
  );
  try {
    fs.mkdirSync(path.join(root, "profile"));
    fs.mkdirSync(path.join(root, "prompts"));
    fs.writeFileSync(path.join(root, "prompts/answer-questions.md"), "Rules");
    const sections = [
      "Professional Identity",
      "Current Status",
      "Role-specific positioning",
      "Career & Interview Story Bank",
      "Freelance / Independent Work",
      "Projects",
      "Skills",
      "New factual section",
    ];
    const career = sections
      .map((heading, i) => `## ${heading}\nSupported fact ${i}`)
      .join("\n");
    const file = path.join(root, "profile/career.md");
    fs.writeFileSync(file, career);
    const prompt = buildQuestionsPrompt(
      loadQuestionsInputs(root),
      "Job",
      "Why us?",
    );
    for (const heading of sections) expect(prompt).toContain(`## ${heading}`);
    fs.appendFileSync(file, "\nUpdated supported evidence");
    expect(
      buildQuestionsPrompt(loadQuestionsInputs(root), "Job", "Why us?"),
    ).toContain("Updated supported evidence");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
