// Deterministic visible factual units for Jake's template. No raw-source evidence fallback.
import {
  normalizeQuote,
  texToPlain,
  verifyQuote,
  templateDefinitions,
  verifyResumeQuote,
} from "./scoring/verify";
import { AgentError } from "./claude/agent";
import type { ClaudeTailorReport, ScoreResult } from "./types";

export interface ContentDiff {
  added: string[];
  removed: string[];
}

/** Read balanced macro arguments so nested formatting never splits a factual unit. */
function group(
  text: string,
  start: number,
): { value: string; end: number } | null {
  let i = start;
  while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  if (text[i] !== "{") return null;
  const begin = ++i;
  let depth = 1;
  for (; i < text.length; i++) {
    if (text[i] === "\\" && /[{}%]/.test(text[i + 1] ?? "")) {
      i++;
      continue;
    }
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0)
      return { value: text.slice(begin, i), end: i + 1 };
  }
  return null;
}
export const visibleFragment = (s: string) =>
  normalizeQuote(texToPlain(`\\begin{document}${s}\\end{document}`));

export interface EditableUnit {
  start: number;
  end: number;
  text: string;
  owner: string;
  kind: string;
}

/** Balanced groups, including nested formatting and escaped braces; malformed TeX fails closed. */
function editableGroup(
  tex: string,
  at: number,
): { start: number; end: number; value: string } {
  while (/\s/.test(tex[at] ?? "") && at < tex.length) at++;
  if (tex[at] !== "{")
    throw new AgentError("Expected a LaTeX argument", "verification");
  const start = at;
  let depth = 0;
  for (; at < tex.length; at++) {
    let slashes = 0;
    for (let j = at - 1; j >= 0 && tex[j] === "\\"; j--) slashes++;
    if (slashes % 2) continue;
    if (tex[at] === "{") depth++;
    if (tex[at] === "}" && --depth === 0)
      return { start, end: at + 1, value: tex.slice(start + 1, at) };
  }
  throw new AgentError("Unbalanced LaTeX argument", "verification");
}

/** Extract only existing template content slots. All other bytes form the protected scaffold. */
export function editableUnits(tex: string): EditableUnit[] {
  // Blank comments without shifting offsets; comment-only macros must not define editable slots.
  const code = tex.replace(/(?<!\\)%.*$/gm, (comment) =>
    " ".repeat(comment.length),
  );
  const start = code.indexOf("\\begin{document}");
  if (start < 0 || !tex.includes("\\end{document}"))
    throw new AgentError("Missing document boundary", "verification");
  const units: EditableUnit[] = [];
  const body = code.slice(
    start,
    code.indexOf("\\end{document}") + "\\end{document}".length,
  );
  let section = "";
  let owner = "";
  const re =
    /\\(section|resumeSubheading|resumeSubSubheading|resumeProjectHeading|resumeItem|textbf|item)(?![A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const pos = start + m.index;
    const name = m[1];
    if (name === "section") {
      const g = editableGroup(tex, pos + m[0].length);
      section = g.value;
      owner = section;
      continue;
    }
    if (name === "resumeSubheading" || name === "resumeSubSubheading") {
      let at = pos + m[0].length;
      const values: string[] = [];
      for (let i = 0; i < (name === "resumeSubheading" ? 4 : 2); i++) {
        const g = editableGroup(tex, at);
        values.push(g.value);
        at = g.end;
      }
      owner = values.join(" | ");
      re.lastIndex = at - start;
      continue;
    }
    if (name === "resumeProjectHeading") {
      const title = editableGroup(tex, pos + m[0].length);
      const date = editableGroup(tex, title.end);
      owner = title.value;
      units.push({
        start: title.start + 1,
        end: title.end - 1,
        text: visibleFragment(title.value),
        owner: "project heading",
        kind: "project",
      });
      units.push({
        start: date.start + 1,
        end: date.end - 1,
        text: visibleFragment(date.value),
        owner: title.value,
        kind: "date",
      });
      re.lastIndex = date.end - start;
      continue;
    }
    if (name === "resumeItem") {
      const g = editableGroup(tex, pos + m[0].length);
      units.push({
        start: pos,
        end: g.end,
        text: visibleFragment(g.value),
        owner,
        kind: "bullet",
      });
      re.lastIndex = g.end - start;
      continue;
    }
    if (name === "textbf" && /skills/i.test(section)) {
      const label = editableGroup(tex, pos + m[0].length);
      let at = label.end;
      while (/\s/.test(tex[at] ?? "") && at < tex.length) at++;
      if (tex[at] === "{") {
        const value = editableGroup(tex, at);
        units.push({
          start: value.start + 1,
          end: value.end - 1,
          text: visibleFragment(`${label.value}${value.value}`),
          owner: label.value,
          kind: "skills",
        });
        re.lastIndex = value.end - start;
      }
    }
    if (name === "item" && section === "Summary") {
      const g = editableGroup(tex, pos + m[0].length);
      units.push({
        start: g.start + 1,
        end: g.end - 1,
        text: visibleFragment(g.value),
        owner: "Summary",
        kind: "summary",
      });
      re.lastIndex = g.end - start;
    }
  }
  return units;
}

export function factualUnits(tex: string): string[] {
  let body =
    tex
      .replace(/(?<!\\)%.*$/gm, "")
      .split("\\begin{document}")[1]
      ?.split("\\end{document}")[0] ?? "";
  const units: string[] = [];
  const macro =
    /\\(resumeItem|resumeSubItem|resumeSubheading|resumeSubSubheading|resumeProjectHeading|section)\b/g;
  const sizes: Record<string, number> = {
    resumeItem: 1,
    resumeSubItem: 1,
    resumeSubheading: 4,
    resumeSubSubheading: 2,
    resumeProjectHeading: 2,
    section: 1,
  };
  let match: RegExpExecArray | null;
  const spans: { start: number; end: number }[] = [];
  while ((match = macro.exec(body))) {
    let end = macro.lastIndex;
    for (let n = 0; n < sizes[match[1]]; n++) {
      const arg = group(body, end);
      if (!arg) throw new Error(`Malformed factual unit: ${match[1]}`);
      const text = visibleFragment(arg.value);
      if (text) units.push(text);
      end = arg.end;
    }
    spans.push({ start: match.index, end });
    macro.lastIndex = end;
  }
  // Logical boundaries capture contact rows, skill categories and full paragraphs. Physical source
  // wrapping is whitespace, so a formatter cannot turn an unchanged paragraph into new claims.
  for (const span of spans.reverse())
    body = body.slice(0, span.start) + "\0" + body.slice(span.end);
  for (const line of body.split(
    /\0|\\\\|\\item\b|(?=\\textbf\s*\{[^}]*\}\s*\{\s*:)/,
  )) {
    const text = visibleFragment(line);
    if (text && text !== "|" && !/^[-\d.]+$/.test(text)) units.push(text);
  }
  return units;
}

/** Compare multisets: moving a unit or changing formatting does not create a claim. */
export function contentDiff(master: string, tailored: string): ContentDiff {
  const before = factualUnits(master),
    after = factualUnits(tailored);
  const subtract = (a: string[], b: string[]) => {
    const remaining = [...b];
    return a.filter((s) => {
      const i = remaining.indexOf(s);
      if (i < 0) return true;
      remaining.splice(i, 1);
      return false;
    });
  };
  return { added: subtract(after, before), removed: subtract(before, after) };
}

export function validateEvidence(
  review: ScoreResult,
  report: ClaudeTailorReport,
  master: string,
  tailored: string,
  career: string,
): ContentDiff {
  // Preamble changes must not smuggle new printed claims into unchanged macro arguments.
  // Spacing/font changes normalize away; factual changes belong in visible document units.
  const originalDefinitions = templateDefinitions(master);
  const body =
    tailored.replace(/(?<!\\)%.*$/gm, "").split("\\begin{document}")[1] ?? "";
  for (const [name, definition] of templateDefinitions(tailored)) {
    if (!new RegExp(`\\\\${name}(?![a-zA-Z])`).test(body)) continue;
    const signature = visibleFragment(definition.body);
    const original = originalDefinitions.get(name);
    if (
      (original && signature !== visibleFragment(original.body)) ||
      (!original && signature.replace(/#[1-9]/g, "").trim())
    )
      throw new Error(
        "Template macro changes must not introduce or hide factual content",
      );
  }
  const diff = contentDiff(master, tailored);
  const ids = new Set(review.requirements.map((r) => r.id));
  const seen = new Set<string>();
  for (const change of report.changes) {
    const after = normalizeQuote(change.after);
    if (change.requirementId !== "resume" && !ids.has(change.requirementId))
      throw new Error("Unknown requirement reference");
    if (seen.has(after)) throw new Error("Duplicate report entry");
    seen.add(after);
    if (
      !factualUnits(tailored).includes(after) ||
      !verifyResumeQuote(change.after, tailored) ||
      !verifyQuote(change.careerQuote, career)
    )
      throw new Error("Unverifiable factual change");
  }
  const originalUnits = editableUnits(master);
  const movedOrChanged = editableUnits(tailored).filter(
    (u) =>
      !originalUnits.some(
        (o) => o.kind === u.kind && o.owner === u.owner && o.text === u.text,
      ),
  );
  if (
    [...diff.added, ...movedOrChanged.map((u) => u.text)].some(
      (s) => !seen.has(s),
    )
  )
    throw new Error(
      "Incomplete report: every added or rewritten factual unit needs complete visible text and career evidence",
    );
  const references = new Set<string>();
  for (const r of report.requirements) {
    if (!ids.has(r.id) || references.has(r.id))
      throw new Error("Unknown or duplicate requirement reference");
    references.add(r.id);
  }
  return diff;
}
