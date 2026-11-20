// A run classifies and verifies one immutable snapshot, never whichever files happen to exist later.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CAREER_ROOT, resolveInside } from "../paths";
import { texToPlain } from "../scoring/verify";
import type { ResumeCategory, SourceStamp } from "../types";
import { AgentError } from "./agent";
import { reviewInstructions } from "./prompts";

export const REVIEW_RULES = "prompts/review-job.md";
export const TAILOR_RULES = "prompts/tailor-resume.md";
export const QUESTIONS_RULES = "prompts/answer-questions.md";
export const COVER_RULES = "prompts/cover-letter.md";
export const FOLLOWUP_RULES = "prompts/review-followup.md";
export const contentHash = (text: string | Buffer): string =>
  createHash("sha256").update(text).digest("hex");

export interface InputSnapshot {
  readonly careerMd: string;
  readonly resumeTex: string;
  readonly resumeVisible: string;
  readonly reviewRules: string;
  readonly tailorRules: string;
  readonly jobBriefRules: string;
  readonly sources: SourceStamp;
}

/**
 * Drops resume templates ("Example bullets" blocks and the
 * Summary Statements section), which restate facts already in "What I did" / "Key facts". The
 * result is a line subset of career.md, so quotes taken from it still verify against the full file.
 */
function careerWithoutTemplates(markdown: string): string {
  const kept: string[] = [];
  let skipping: "bullets" | "section" | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^## /.test(line))
      skipping = /^## Summary Statements\b/i.test(line) ? "section" : null;
    else if (/^\*\*Example bullets/i.test(line)) skipping = "bullets";
    else if (skipping === "bullets" && /^(\*\*|---|### )/.test(line))
      skipping = null;
    if (!skipping) kept.push(line);
  }
  return kept.join("\n");
}

function omitCareerSections(markdown: string, sections: RegExp): string {
  let skipping = false;
  return careerWithoutTemplates(markdown)
    .split(/\r?\n/)
    .filter((line) => {
      if (/^## /.test(line)) skipping = sections.test(line);
      return !skipping;
    })
    .join("\n");
}

/** Review evaluates work evidence; contact details and administrative screening are not inputs. */
export function reviewCareer(markdown: string): string {
  return omitCareerSections(
    markdown,
    /^## (?:Contact|Eligibility|Application Eligibility|Fixed Fields)\s*$/i,
  );
}

/** Preserve section names in the supplied visible text; raw TeX alone obscures placement. */
export function visibleResume(tex: string): string {
  return texToPlain(tex.replace(/\\section\{([^}]+)\}/g, "\n## $1\n"));
}

/** Read one workspace file, refusing anything that resolves outside the Career root. */
function readSource(rel: string, root: string): string {
  const file = resolveInside(root, rel);
  if (
    !file ||
    file !== path.join(/* turbopackIgnore: true */ fs.realpathSync(root), rel)
  )
    throw new AgentError(`Source outside Career: ${rel}`, "source-conflict");
  if (!fs.existsSync(file))
    throw new AgentError(`Missing ${rel}`, "source-conflict");
  return fs.readFileSync(file, "utf8");
}

export interface QuestionsInputs {
  readonly questionsRules: string;
  readonly careerEvidence: string;
}

/** Reuse factual evidence, omitting resume templates, summary copy, and contact details. */
export function applicationCareer(markdown: string): string {
  return omitCareerSections(markdown, /^## Contact\s*$/i);
}

export function loadQuestionsInputs(root = CAREER_ROOT): QuestionsInputs {
  return Object.freeze({
    questionsRules: readSource(QUESTIONS_RULES, root),
    careerEvidence: applicationCareer(readSource("profile/career.md", root)),
  });
}

export interface CoverInputs {
  readonly coverRules: string;
  readonly resumeVisible: string;
  readonly careerEvidence: string;
}

/** Inputs for a cover letter: the selected master or tailored resume and current career facts. */
export function loadCoverInputs(
  resumeTex: string,
  root = CAREER_ROOT,
): CoverInputs {
  return Object.freeze({
    coverRules: readSource(COVER_RULES, root),
    resumeVisible: visibleResume(readSource(resumeTex, root)),
    careerEvidence: applicationCareer(readSource("profile/career.md", root)),
  });
}

export interface FollowupInputs {
  readonly followupRules: string;
  readonly resumeVisible: string;
  readonly careerEvidence: string;
}

/** Inputs for a review follow-up: the same career view and master resume the review scored. */
export function loadFollowupInputs(
  resume: ResumeCategory,
  root = CAREER_ROOT,
): FollowupInputs {
  return Object.freeze({
    followupRules: readSource(FOLLOWUP_RULES, root),
    resumeVisible: visibleResume(
      readSource(`source/${resume}/resume.tex`, root),
    ),
    careerEvidence: reviewCareer(readSource("profile/career.md", root)),
  });
}

export function loadInputSnapshot(
  resume: ResumeCategory,
  root = CAREER_ROOT,
): InputSnapshot {
  const files = [
    "profile/career.md",
    `source/${resume}/resume.tex`,
    REVIEW_RULES,
    TAILOR_RULES,
  ];
  const contents = files.map((rel) => readSource(rel, root));
  const review = reviewInstructions(contents[2]);
  const hashes = Object.freeze(
    Object.fromEntries(files.map((rel, i) => [rel, contentHash(contents[i])])),
  );
  return Object.freeze({
    careerMd: contents[0],
    resumeTex: contents[1],
    resumeVisible: visibleResume(contents[1]),
    reviewRules: review.systemPrompt,
    tailorRules: contents[3],
    jobBriefRules: review.jobBrief.trimEnd(),
    sources: Object.freeze({ version: 1 as const, hashes }),
  });
}

export function assertSourcesCurrent(
  stamp: SourceStamp | undefined,
  root = CAREER_ROOT,
): void {
  if (!stamp || stamp.version !== 1)
    throw new AgentError(
      "This review predates source snapshots. Review the job again before tailoring.",
      "source-conflict",
    );
  // Old records keep their original keys/hashes. Validate those bytes at the new canonical path.
  const legacyPaths: Record<string, string> = {
    ".claude/skills/apply/classification.md": REVIEW_RULES,
    ".claude/skills/build-resume/tailoring.md": TAILOR_RULES,
  };
  const hashes: Record<string, string> = {};
  for (const [storedPath, hash] of Object.entries(stamp.hashes ?? {})) {
    const rel = legacyPaths[storedPath] ?? storedPath;
    if (rel in hashes && hashes[rel] !== hash)
      throw new AgentError(
        `Conflicting source hashes (${rel})`,
        "source-conflict",
      );
    hashes[rel] = hash;
  }
  if (
    !["profile/career.md", REVIEW_RULES, TAILOR_RULES].every(
      (rel) => typeof hashes[rel] === "string",
    ) ||
    !Object.keys(hashes).some((rel) =>
      /^source\/(tech|general|datacenter)\/resume\.tex$/.test(rel),
    )
  )
    throw new AgentError(
      "Incomplete source snapshot. Review the job again before tailoring.",
      "source-conflict",
    );
  for (const [rel, hash] of Object.entries(hashes)) {
    // Pre-inline reviews recorded these instructions separately. Compare current canonical text,
    // never the archived file, and leave persisted stamps untouched.
    if (rel === "prompts/job-brief.md") {
      const current = reviewInstructions(readSource(REVIEW_RULES, root));
      if (contentHash(current.jobBrief) !== hash)
        throw new AgentError(
          `Source changed (${rel}). Review the job again before tailoring.`,
          "source-conflict",
        );
      continue;
    }
    const file = resolveInside(root, rel);
    if (
      !file ||
      file !==
        path.join(/* turbopackIgnore: true */ fs.realpathSync(root), rel) ||
      !fs.existsSync(file) ||
      !sourceHashMatches(rel, fs.readFileSync(file, "utf8"), hash)
    )
      throw new AgentError(
        `Source changed (${rel}). Review the job again before tailoring.`,
        "source-conflict",
      );
  }
}

function sourceHashMatches(rel: string, text: string, hash: string): boolean {
  if (contentHash(text) === hash) return true;
  // The review system text is unchanged when only the brief moves into its own section.
  if (rel === REVIEW_RULES) {
    try {
      return contentHash(reviewInstructions(text).systemPrompt) === hash;
    } catch {
      return false;
    }
  }
  return false;
}
