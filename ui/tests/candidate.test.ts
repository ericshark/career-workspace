import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCandidate,
  checkTailoringScope,
  checkFinalReport,
  changedUnits,
  expandAssessment,
  normalizeRequirementEvidence,
  resumeUnits,
} from "@/lib/claude/candidate";
import { validateEvidence, visibleFragment } from "@/lib/resumeEvidence";
import { texToPlain } from "@/lib/scoring/verify";
import { contentHash } from "@/lib/claude/inputs";
import { fixtureScore } from "@/lib/claude/fixtures";
import type { CandidateSubmission, VerifiedTailorReport } from "@/lib/types";

const review = fixtureScore("2026-10-08").result;
const master = String.raw`\documentclass{article}
\begin{document}\section{Experience}
\resumeSubheading{Engineer}{2025}{Co}{NYC}
\resumeItem{Built Python backend services}
\resumeItem{Wrote tests}
\section{Projects}\resumeProjectHeading{Example Auth Service | Python}{2026}
\resumeItem{Built authentication API}
\section{Skills}\textbf{Languages}{: Python}
\end{document}`;
const after = "Built Python backend services with PostgreSQL";
const career =
  after + "\nWrote tests\nBuilt authentication API\nAWS production experience";
const submission: CandidateSubmission = {
  candidateHash: contentHash(master),
  edits: [{ before: "Built Python backend services", after }],
  changes: [{ requirementId: "r1", after, careerQuote: after }],
};
function apply(s: CandidateSubmission = submission) {
  return applyCandidate(master, master, s, career, review);
}
function report(tex: string): VerifiedTailorReport {
  return {
    candidateHash: contentHash(tex),
    visualPassed: true,
    readingOrderPassed: true,
    changes: submission.changes,
    support: [
      {
        after,
        supported: true,
        reason: "Career record describes this implemented service",
      },
    ],
    requirements: review.requirements
      .filter((r) => r.bucket !== 3)
      .map((r) => ({
        id: r.id,
        presence: "absent",
        placement: null,
        quote: "",
      })),
    notes: "",
  };
}

describe("controlled resume candidates", () => {
  it("uses explicit fragment rendering and complete skills evidence in both validators", () => {
    expect(texToPlain("Python")).toBe("");
    expect(visibleFragment("\\textbf{Python}")).toBe("Python");
    expect(resumeUnits(master).find((u) => u.kind === "skills")?.text).toBe(
      "Languages: Python",
    );
    const unit = "Languages: Python, TypeScript";
    const changes = [
      {
        requirementId: "resume",
        after: unit,
        careerQuote: "Python, TypeScript",
      },
    ];
    const request = {
      candidateHash: contentHash(master),
      edits: [{ before: ": Python", after: ": Python, TypeScript" }],
      changes,
    };
    const tex = applyCandidate(
      master,
      master,
      request,
      "Python, TypeScript",
      review,
    );
    expect(
      validateEvidence(
        review,
        { changes, requirements: [], notes: "" },
        master,
        tex,
        "Python, TypeScript",
      ).added,
    ).toContain(unit);
    expect(() =>
      applyCandidate(
        master,
        master,
        {
          ...request,
          changes: [{ ...changes[0], after: ": Python, TypeScript" }],
        },
        "Python, TypeScript",
        review,
      ),
    ).toThrow(/whole changed/);
    expect(() =>
      applyCandidate(
        master,
        master,
        { ...request, changes: [{ ...changes[0], requirementId: "" }] },
        "Python, TypeScript",
        review,
      ),
    ).toThrow(/Unsupported/);
    expect(() =>
      applyCandidate(
        master,
        master,
        { ...request, changes: [...changes, ...changes] },
        "Python, TypeScript",
        review,
      ),
    ).toThrow(/Duplicate/);
  });
  it("requires evidence when an existing claim moves to another project in either workflow", () => {
    const moved = master.replace("Built authentication API", "Wrote tests");
    expect(() =>
      validateEvidence(
        review,
        { changes: [], requirements: [], notes: "" },
        master,
        moved,
        career,
      ),
    ).toThrow(/Incomplete report/);
    expect(() =>
      validateEvidence(
        review,
        {
          changes: [
            {
              requirementId: "resume",
              after: "Wrote tests",
              careerQuote: "Wrote tests",
            },
          ],
          requirements: [],
          notes: "",
        },
        master,
        moved,
        career,
      ),
    ).not.toThrow();
  });
  it("applies a verified exact edit and checks the matching final report", () => {
    const tex = apply();
    expect(tex).toContain(after);
    expect(() =>
      checkFinalReport(
        master,
        tex,
        report(tex),
        career,
        review,
        contentHash(tex),
      ),
    ).not.toThrow();
  });
  it.each([
    ["stale hash", { ...submission, candidateHash: "a".repeat(64) }, /Stale/],
    [
      "missing snippet",
      { ...submission, edits: [{ before: "missing", after }] },
      /exactly once/,
    ],
    [
      "overlap",
      {
        ...submission,
        edits: [
          { before: "Built Python", after },
          { before: "Python backend", after },
        ],
      },
      /Overlapping/,
    ],
    ["missing evidence", { ...submission, changes: [] }, /Missing evidence/],
    [
      "partial evidence",
      {
        ...submission,
        changes: [{ requirementId: "r1", after: "Python", careerQuote: after }],
      },
      /whole changed/,
    ],
    [
      "false quote",
      {
        ...submission,
        changes: [{ requirementId: "r1", after, careerQuote: "invented" }],
      },
      /Invalid change evidence/,
    ],
    [
      "unsupported requirement",
      {
        ...submission,
        changes: [{ requirementId: "r6", after, careerQuote: after }],
      },
      /Unsupported/,
    ],
  ] as const)("rejects %s", (_name, input, error) =>
    expect(() => apply(input as CandidateSubmission)).toThrow(error),
  );
  it.each(["\\documentclass{article}", "{Engineer}", "{2025}"])(
    "protects template/job identities: %s",
    (before) =>
      expect(() =>
        apply({
          ...submission,
          edits: [{ before, after: before + "changed" }],
          changes: [],
        }),
      ).toThrow(/Protected|LaTeX/),
  );
  it("denies TeX file reads and formatting changes inside content", () => {
    expect(() =>
      apply({
        ...submission,
        edits: [{ before: "Wrote tests", after: "\\input{/etc/passwd}" }],
      }),
    ).toThrow(/Forbidden/);
    expect(() =>
      apply({
        ...submission,
        edits: [{ before: "Wrote tests", after: "\\vspace{-20pt}Wrote tests" }],
      }),
    ).toThrow(/Formatting/);
  });
  it("allows one evidenced project replacement within the shared scope", () => {
    const input = {
      ...submission,
      edits: [
        {
          before: "Example Auth Service | Python",
          after: "NewProject | Python",
        },
      ],
      changes: [
        {
          requirementId: "r1",
          after: "NewProject | Python",
          careerQuote: "NewProject | Python",
        },
        { requirementId: "r1", after: "2026", careerQuote: "2026" },
        {
          requirementId: "r1",
          after: "Built authentication API",
          careerQuote: "Built authentication API",
        },
      ],
    };
    expect(() =>
      applyCandidate(
        master,
        master,
        input,
        "NewProject | Python 2026 Built authentication API",
        review,
      ),
    ).not.toThrow();
  });
  it("requires provenance when existing bullets move to a different project/job", () => {
    const tex = master.replace("Built authentication API", "Wrote tests");
    expect(changedUnits(master, tex).map((u) => u.text)).toContain(
      "Wrote tests",
    );
  });
  it("rejects stale, missing, unsupported or visually failed final reports", () => {
    const tex = apply();
    const good = report(tex);
    for (const patch of [
      { candidateHash: "a".repeat(64) },
      { visualPassed: false },
      { readingOrderPassed: false },
      { support: [] },
      { changes: [] },
      { requirements: [] },
      { support: [{ after, supported: false, reason: "Unsupported" }] },
    ])
      expect(() =>
        checkFinalReport(
          master,
          tex,
          { ...good, ...patch },
          career,
          review,
          contentHash(tex),
        ),
      ).toThrow();
  });
  it("parses content slots from all actual masters and accepts an unchanged candidate", () => {
    for (const category of ["tech", "general", "datacenter"]) {
      const tex = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          `../../source/${category}/resume.tex`,
        ),
        "utf8",
      );
      expect(resumeUnits(tex).length).toBeGreaterThan(10);
      expect(() =>
        applyCandidate(
          tex,
          tex,
          { candidateHash: contentHash(tex), edits: [], changes: [] },
          career,
          review,
        ),
      ).not.toThrow();
    }
  });
});

describe("one bounded tailoring scope", () => {
  const source = String.raw`\begin{document}\section{Experience}\resumeSubheading{Engineer}{2025}{Co}{NYC}
\resumeItem{Built Python APIs}
\resumeItem{Tested database services}
\resumeItem{Documented service operations}
\resumeItem{Diagnosed production errors}
\end{document}`;

  it("allows several targeted changes but rejects rewriting most original bullets", () => {
    const changed = source
      .replace("Built Python APIs", "Implemented Python REST endpoints")
      .replace(
        "Tested database services",
        "Added PostgreSQL integration tests",
      );
    expect(() => checkTailoringScope(source, changed)).not.toThrow();
    expect(() =>
      checkTailoringScope(
        source,
        changed.replace(
          "Documented service operations",
          "Created developer onboarding guides",
        ),
      ),
    ).toThrow(/at most 2 original bullets/);
    // Deleting evidence instead of rewording it still counts against the same scope.
    expect(() =>
      checkTailoringScope(
        source,
        changed.replace("\\resumeItem{Documented service operations}", ""),
      ),
    ).toThrow(/at most 2 original bullets/);
  });

  it("allows within-role reordering and truthful keyword wording without a similarity heuristic", () => {
    const reordered = source.replace(
      "\\resumeItem{Built Python APIs}\n\\resumeItem{Tested database services}",
      "\\resumeItem{Tested database services}\n\\resumeItem{Built Python APIs}",
    );
    expect(() => checkTailoringScope(source, reordered)).not.toThrow();
    expect(() =>
      checkTailoringScope(
        source,
        source.replace(
          "Built Python APIs",
          "Developed documented HTTP endpoints with FastAPI",
        ),
      ),
    ).not.toThrow();
  });

  it("limits net additions and project replacements", () => {
    const extra = "\\resumeItem{Added supported content}";
    expect(() =>
      checkTailoringScope(
        source,
        source.replace("\\end{document}", `${extra}\\end{document}`),
      ),
    ).not.toThrow();
    expect(() =>
      checkTailoringScope(
        source,
        source.replace("\\end{document}", `${extra}${extra}\\end{document}`),
      ),
    ).toThrow(/one net new bullet/);
    const projects = String.raw`\begin{document}\section{Projects}\resumeProjectHeading{One | Python}{2025}\resumeProjectHeading{Two | SQL}{2026}\end{document}`;
    expect(() =>
      checkTailoringScope(projects, projects.replace("One |", "New |")),
    ).not.toThrow();
    expect(() =>
      checkTailoringScope(
        projects,
        projects.replace("One |", "New |").replace("Two |", "Other |"),
      ),
    ).toThrow(/at most one project/);
  });

  it("measures repair rounds against the original master rather than the last candidate", () => {
    const current = apply();
    expect(() =>
      applyCandidate(
        master,
        current,
        {
          candidateHash: contentHash(current),
          edits: [
            {
              before: "Wrote tests",
              after: "Added database integration tests",
            },
          ],
          changes: [
            ...submission.changes,
            {
              requirementId: "resume",
              after: "Added database integration tests",
              careerQuote: "Added database integration tests",
            },
          ],
        },
        `${career}\nAdded database integration tests`,
        review,
      ),
    ).toThrow(/at most 1 original bullets/);
  });
});

describe("expandAssessment", () => {
  const changes = [
    { requirementId: "r1", after: "Built A", careerQuote: "Built A" },
    { requirementId: "r2", after: "Built B", careerQuote: "Built B" },
  ];
  const assessment = (support: { change: number }[]) => ({
    candidateHash: "a".repeat(64),
    visualPassed: true,
    readingOrderPassed: true,
    support: support.map((s) => ({ ...s, supported: true, reason: "ok" })),
    requirements: [],
    notes: "",
  });
  it("re-attaches the submitted evidence instead of trusting re-emitted text", () => {
    const out = expandAssessment(
      assessment([{ change: 1 }, { change: 0 }]),
      changes,
    );
    expect(out.changes).toBe(changes);
    expect(out.support.map((s) => s.after)).toEqual(["Built B", "Built A"]);
  });
  it.each([
    ["an out-of-range index", [{ change: 0 }, { change: 2 }]],
    ["a duplicate index", [{ change: 0 }, { change: 0 }]],
    ["a missing verdict", [{ change: 0 }]],
  ])("rejects %s", (_name, support) => {
    expect(() => expandAssessment(assessment(support), changes)).toThrow(
      /support verdict/,
    );
  });
});

describe("normalizeRequirementEvidence", () => {
  const tex = String.raw`\begin{document}\resumeItem{Built Python backend services}\end{document}`;
  const tracked = review.requirements.filter(
    (r) => r.kind !== "eligibility" && r.bucket !== 3,
  );
  const base = (requirements: VerifiedTailorReport["requirements"]) =>
    ({
      candidateHash: "a".repeat(64),
      visualPassed: true,
      readingOrderPassed: true,
      changes: [],
      support: [],
      requirements,
      notes: "",
    }) satisfies VerifiedTailorReport;
  it("downgrades unverifiable evidence, fills forgotten requirements and drops unknown IDs", () => {
    const [good, bad] = tracked;
    const out = normalizeRequirementEvidence(
      base([
        {
          id: good.id,
          presence: "bullet",
          placement: "prominent",
          quote: "Built Python backend services",
        },
        {
          id: bad.id,
          presence: "bullet",
          placement: "prominent",
          quote: "Led a Kubernetes migration",
        },
        { id: "unknown", presence: "absent", placement: null, quote: "" },
      ]),
      tex,
      review,
    );
    const byId = Object.fromEntries(out.requirements.map((r) => [r.id, r]));
    expect(byId[good.id].presence).toBe("bullet");
    expect(byId[bad.id]).toEqual({
      id: bad.id,
      presence: "absent",
      placement: null,
      quote: "",
    });
    expect(byId.unknown).toBeUndefined();
    // Every tracked requirement is reported; credit was only ever removed.
    expect(tracked.every((r) => byId[r.id])).toBe(true);
    expect(
      out.requirements.filter((r) => r.presence !== "absent").map((r) => r.id),
    ).toEqual([good.id]);
  });
});
