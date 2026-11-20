import { describe, expect, it } from "vitest";
import {
  contentDiff,
  factualUnits,
  validateEvidence,
} from "@/lib/resumeEvidence";
import { verifyResumeQuote } from "@/lib/scoring/verify";
import { fixtureScore } from "@/lib/claude/fixtures";
import { localDate, laneForResume } from "@/lib/config";
const review = fixtureScore("2026-10-08").result;
const wrap = (s: string) => `\\begin{document}\n${s}\n\\end{document}`;
const master = wrap(
  "\\section{Experience}\n\\resumeItem{Built Python APIs}\n\\textbf{Skills}{: Python, SQL}",
);
const tailored = wrap(
  "\\section{Experience}\n\\resumeItem{Built Python APIs with tests}\n\\textbf{Skills}{: Python, SQL}",
);
const career = "Built Python APIs with tests";
const report = {
  changes: [{ requirementId: "resume", after: career, careerQuote: career }],
  requirements: [],
  notes: "",
};

describe("visible evidence and complete factual coverage", () => {
  it("comments, preambles, trailing and hidden text cannot supply resume evidence", () => {
    for (const tex of [
      `% \\begin{document}\n\\newcommand{\\secret}{Invisible}\n${master}`,
      `Invisible\n${master}`,
      `${master}\nInvisible`,
      wrap("% Invisible"),
      wrap("\\phantom{Invisible}"),
      wrap("\\iffalse Invisible\\fi"),
    ])
      expect(verifyResumeQuote("Invisible", tex)).toBe(false);
  });
  it("hidden macro arguments and preamble-injected claims cannot bypass evidence coverage", () => {
    const hidden = "\\newcommand{\\hide}[1]{}\n" + wrap("\\hide{Invisible}");
    expect(verifyResumeQuote("Invisible", hidden)).toBe(false);
    const before =
      "\\newcommand{\\resumeItem}[1]{#1}\n" + wrap("\\resumeItem{Built APIs}");
    const injected = before.replace("{#1}", "{#1 with invented results}");
    expect(() =>
      validateEvidence(
        review,
        { changes: [], requirements: [], notes: "" },
        before,
        injected,
        career,
      ),
    ).toThrow(/Template macro/);
  });
  it("covers complete new units and ignores formatting and reordering", () => {
    expect(
      validateEvidence(review, report, master, tailored, career).added,
    ).toEqual([career]);
    const reordered = wrap(
      "\\textbf{Skills}{: Python, SQL}\n\\resumeItem{Built \\textbf{Python} APIs}\n\\section{Experience}",
    );
    expect(
      contentDiff(
        wrap("Summary of work across teams"),
        wrap("Summary of work\n across teams"),
      ),
    ).toEqual({ added: [], removed: [] });
    expect(contentDiff(master, reordered)).toEqual({ added: [], removed: [] });
    expect(
      factualUnits(
        wrap("\\resumeSubheading{Orchard Systems}{May 2025}{Intern}{Remote}"),
      ),
    ).toEqual(["Orchard Systems", "May 2025", "Intern", "Remote"]);
  });
  it("rejects missing coverage, fragmentary text, unknown references, duplicates and false career quotes", () => {
    for (const invalid of [
      { ...report, changes: [] },
      { ...report, changes: [{ ...report.changes[0], after: "Python APIs" }] },
      {
        ...report,
        changes: [{ ...report.changes[0], requirementId: "unknown" }],
      },
      { ...report, changes: [...report.changes, ...report.changes] },
      {
        ...report,
        changes: [{ ...report.changes[0], careerQuote: "not in career" }],
      },
      {
        ...report,
        requirements: [
          {
            id: "unknown",
            presence: "absent" as const,
            placement: null,
            quote: "",
          },
        ],
      },
    ])
      expect(() =>
        validateEvidence(review, invalid, master, tailored, career),
      ).toThrow();
  });
  it("uses New York dates and inherits the tailored master lane", () => {
    expect(localDate(new Date("2026-10-09T02:00:00Z"))).toBe("2026-10-08");
    expect(localDate(new Date("2026-03-08T06:00:00Z"), 1)).toBe("2026-03-09");
    expect(laneForResume("tailored/acme", "datacenter")).toBe("bridge");
  });
});
