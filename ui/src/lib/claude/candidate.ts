// Exact edits plus a template-aware diff: every changed visible content unit requires provenance.
import type {
  CandidateEvidence,
  CandidateSubmission,
  VerifiedTailorReport,
  ScoreResult,
} from "../types";
import {
  normalizeQuote,
  texToPlain,
  verifyQuote,
  verifyResumeQuote,
} from "../scoring/verify";
import {
  editableUnits as resumeUnits,
  type EditableUnit,
} from "../resumeEvidence";
export { editableUnits as resumeUnits } from "../resumeEvidence";

function clean(tex: string): string {
  return tex.replace(/(?<!\\)%.*$/gm, "");
}

import { contentHash } from "./inputs";
import { AgentError } from "./agent";
import type { TailorAssessment } from "./schemas";

function scaffold(tex: string, units: EditableUnit[]): string {
  let out = "";
  let end = 0;
  for (const u of units) {
    out += tex.slice(end, u.start);
    end = u.end;
  }
  return (out + tex.slice(end)).replace(/\s+/g, " ").trim();
}

export function changedUnits(
  master: string,
  candidate: string,
): EditableUnit[] {
  const original = resumeUnits(master);
  return resumeUnits(candidate).filter(
    (u) =>
      !original.some(
        (o) =>
          o.kind === u.kind &&
          o.owner === u.owner &&
          o.text === u.text &&
          JSON.stringify(
            master.slice(o.start, o.end).match(/\\href\{[^}]*\}/g) ?? [],
          ) ===
            JSON.stringify(
              candidate.slice(u.start, u.end).match(/\\href\{[^}]*\}/g) ?? [],
            ),
      ),
  );
}

/**
 * TeX primitives that read/write other files or run commands. pdflatex compiles whatever Claude
 * wrote, so a prompt-injected post could try \input{/home/...} to leak a file into the PDF.
 * Comments are ignored. Returns the first offending command, or null.
 */
export function findForbiddenTex(tex: string): string | null {
  // The one \input every master resume has: TeX Live's glyphtounicode table (keeps PDF text ATS-readable).
  if (tex.includes("^^")) return "^^";
  const code = tex
    .replace(/(?<!\\)%.*$/gm, "")
    .replace(/\\input\s*\{glyphtounicode\}/g, "");
  const m =
    /\\(input|include|includeonly|openin|openout|read|readline|write|immediate|catcode|csname|special|InputIfFileExists|IfFileExists|directlua|scantokens)(?![a-zA-Z])/.exec(
      code,
    );
  return m ? m[0] : null;
}

export function checkEvidence(
  master: string,
  tex: string,
  changes: CandidateEvidence[],
  career: string,
  review: ScoreResult,
): void {
  const changed = changedUnits(master, tex);
  const seen = new Set<string>();
  for (const c of changes) {
    const key = normalizeQuote(c.after);
    if (seen.has(key))
      throw new AgentError("Duplicate change evidence", "verification");
    seen.add(key);
    if (
      c.requirementId !== "resume" &&
      !review.requirements.some(
        (r) => r.id === c.requirementId && r.bucket !== 3,
      )
    )
      throw new AgentError(
        `Unsupported/unknown requirement ${c.requirementId}`,
        "verification",
      );
    if (!verifyQuote(c.careerQuote, career) || !verifyResumeQuote(c.after, tex))
      throw new AgentError(
        `Invalid change evidence: ${c.after}`,
        "verification",
      );
    if (!changed.some((u) => normalizeQuote(c.after) === u.text))
      throw new AgentError(
        "Evidence must quote a whole changed bullet, complete skills row, summary, project heading or date",
        "verification",
      );
  }
  for (const u of changed)
    if (!changes.some((c) => normalizeQuote(c.after) === u.text))
      throw new AgentError(
        `Missing evidence for changed ${u.kind}: ${u.text}`,
        "verification",
      );
}

export function applyCandidate(
  master: string,
  current: string,
  submission: CandidateSubmission,
  career: string,
  review: ScoreResult,
): string {
  if (submission.candidateHash !== contentHash(current))
    throw new AgentError(
      "Stale candidate hash; use the last returned hash",
      "verification",
    );
  // Resolve all matches before applying any edit. Overlap and duplicate snippets are ambiguous.
  const ranges = submission.edits
    .map((e) => {
      const start = current.indexOf(e.before);
      if (start < 0 || current.indexOf(e.before, start + 1) >= 0)
        throw new AgentError(
          "Replacement must match exactly once",
          "verification",
        );
      return { start, end: start + e.before.length, after: e.after };
    })
    .sort((a, b) => a.start - b.start);
  if (ranges.some((r, i) => i > 0 && r.start < ranges[i - 1].end))
    throw new AgentError("Overlapping edits", "verification");
  let tex = current;
  for (const r of [...ranges].reverse())
    tex = tex.slice(0, r.start) + r.after + tex.slice(r.end);
  const hit = findForbiddenTex(tex);
  if (hit) throw new AgentError(`Forbidden TeX command ${hit}`, "guard");
  const original = clean(master);
  const candidate = clean(tex);
  const oldUnits = resumeUnits(original);
  const units = resumeUnits(candidate);
  if (scaffold(original, oldUnits) !== scaffold(candidate, units))
    throw new AgentError(
      "Protected template, contact, education or job heading changed",
      "guard",
    );
  // Content slots permit typography, not arbitrary TeX instructions hidden inside a bullet.
  for (const u of units) {
    const snippet = candidate.slice(u.start, u.end);
    const links = [...snippet.matchAll(/\\href\{([^}]+)\}/g)].map((m) => m[1]);
    for (const link of links) {
      if (!master.includes(`\\href{${link}}`) && !career.includes(link))
        throw new AgentError(
          "New project/content link is not in the career record",
          "verification",
        );
    }
    const commands = snippet.match(/\\[a-zA-Z]+/g) ?? [];
    if (
      commands.some(
        (c) =>
          ![
            "\\resumeItem",
            "\\textbf",
            "\\emph",
            "\\href",
            "\\underline",
            "\\sim",
          ].includes(c),
      )
    )
      throw new AgentError(
        "Formatting/commands changed inside content",
        "guard",
      );
  }
  checkScope(oldUnits, units);
  checkEvidence(master, tex, submission.changes, career, review);
  return tex;
}

/** Bound every candidate against the original master, so repair rounds cannot accumulate a rewrite. */
function checkScope(original: EditableUnit[], candidate: EditableUnit[]): void {
  const projectNames = (units: EditableUnit[]) =>
    units
      .filter((u) => u.kind === "project")
      .map((u) => u.text.split("|")[0].trim());
  const beforeProjects = projectNames(original);
  const afterProjects = projectNames(candidate);
  if (
    beforeProjects.length !== afterProjects.length ||
    beforeProjects.filter((name) => !afterProjects.includes(name)).length > 1
  )
    throw new AgentError(
      "Keep the project count and replace at most one project",
      "guard",
    );

  const beforeBullets = original.filter((u) => u.kind === "bullet");
  const afterBullets = candidate.filter((u) => u.kind === "bullet");
  const available = new Map<string, number>();
  const key = (u: EditableUnit) => JSON.stringify([u.owner, u.text]);
  for (const unit of afterBullets)
    available.set(key(unit), (available.get(key(unit)) ?? 0) + 1);
  let retained = 0;
  for (const unit of beforeBullets) {
    const count = available.get(key(unit)) ?? 0;
    if (count > 0) {
      retained++;
      available.set(key(unit), count - 1);
    }
  }
  // This is a product scope bound, not an ATS rule or a measure of semantic support.
  const changeLimit = Math.max(1, Math.floor(beforeBullets.length / 2));
  if (beforeBullets.length - retained > changeLimit)
    throw new AgentError(
      `Keep more of the master: at most ${changeLimit} original bullets may change or be removed`,
      "guard",
    );
  if (afterBullets.length > beforeBullets.length + 1)
    throw new AgentError(
      "Tailoring may add at most one net new bullet",
      "guard",
    );
}

/** Manual CLI tailoring follows the same bounded content scope as UI candidates. */
export function checkTailoringScope(master: string, candidate: string): void {
  checkScope(resumeUnits(master), resumeUnits(candidate));
}

/**
 * Rebuild the full report from the agent's verdicts plus the evidence it submitted for that candidate.
 * Each submitted change needs exactly one verdict, by its index in that submission.
 */
export function expandAssessment(
  assessment: TailorAssessment,
  changes: CandidateEvidence[],
): VerifiedTailorReport {
  const seen = new Set<number>();
  for (const s of assessment.support) {
    if (s.change >= changes.length || seen.has(s.change))
      throw new AgentError(
        `Invalid support verdict for change ${s.change}`,
        "verification",
      );
    seen.add(s.change);
  }
  if (seen.size !== changes.length)
    throw new AgentError(
      "Every submitted change needs one support verdict",
      "verification",
    );
  const { support, ...rest } = assessment;
  return {
    ...rest,
    changes,
    support: support.map((s) => ({
      after: changes[s.change].after,
      supported: s.supported,
      reason: s.reason,
    })),
  };
}

/**
 * Per-requirement presence only feeds the recomputed Match, so a slip there must not discard a
 * built, evidence-checked candidate. Repairs only lower credit: an unverifiable quote or missing
 * placement becomes absent, a forgotten requirement is added as absent, unknown IDs are dropped.
 * Duplicate IDs stay ambiguous and are rejected by checkFinalReport. Claims are not touched.
 */
export function normalizeRequirementEvidence(
  report: VerifiedTailorReport,
  tex: string,
  review: ScoreResult,
): VerifiedTailorReport {
  const known = new Set(review.requirements.map((q) => q.id));
  const absent = (id: string) => ({
    id,
    presence: "absent" as const,
    placement: null,
    quote: "",
  });
  const requirements = report.requirements
    .filter((r) => known.has(r.id))
    .map((r) =>
      r.presence === "absent" ||
      r.placement === null ||
      !verifyResumeQuote(r.quote, tex)
        ? absent(r.id)
        : r,
    );
  const reported = new Set(requirements.map((r) => r.id));
  for (const q of review.requirements)
    if (q.kind !== "eligibility" && q.bucket !== 3 && !reported.has(q.id))
      requirements.push(absent(q.id));
  return { ...report, requirements };
}

export function checkFinalReport(
  master: string,
  tex: string,
  report: VerifiedTailorReport,
  career: string,
  review: ScoreResult,
  hash: string,
): void {
  if (report.candidateHash !== hash)
    throw new AgentError(
      "Final report belongs to another candidate",
      "verification",
    );
  if (!report.visualPassed || !report.readingOrderPassed)
    throw new AgentError(
      "Visual/reading-order checks did not pass",
      "verification",
    );
  checkEvidence(master, tex, report.changes, career, review);
  for (const u of changedUnits(master, tex)) {
    const support = report.support.filter(
      (s) => normalizeQuote(s.after) === u.text,
    );
    if (
      support.length !== 1 ||
      !support[0].supported ||
      !support[0].reason.trim()
    )
      throw new AgentError(`Unresolved claim: ${u.text}`, "verification");
  }
  const ids = new Set<string>();
  for (const r of report.requirements) {
    if (ids.has(r.id) || !review.requirements.some((q) => q.id === r.id))
      throw new AgentError(
        "Duplicate/unknown report requirement",
        "verification",
      );
    ids.add(r.id);
    if (
      r.presence === "absent"
        ? r.quote !== "" || r.placement !== null
        : !verifyResumeQuote(r.quote, tex) || r.placement === null
    )
      throw new AgentError(`Invalid report evidence ${r.id}`, "verification");
  }
  if (
    review.requirements.some(
      (r) => r.kind !== "eligibility" && r.bucket !== 3 && !ids.has(r.id),
    )
  )
    throw new AgentError("Incomplete requirement report", "verification");
}
