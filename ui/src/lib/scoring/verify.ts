// Deterministic text checks: quote verification (career.md, resume, job post), LaTeX → visible text,
// and term matching with a small alias table. Pure functions (no fs).

/** Canonical form for quote comparison: strips emphasis/code markers, unifies quotes and dashes, collapses whitespace. */
export function normalizeQuote(s: string): string {
  return s
    .replace(/\*\*|__|`/g, "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/---?/g, "-")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalized, case-insensitive substring check of `quote` against `text`. career.md is written in
 * first person ("I built …") while quotes come back resume-style ("Built …"), so a leading "I " and
 * trailing punctuation are ignored.
 */
export function verifyQuote(quote: string, text: string): boolean {
  const q = normalizeQuote(quote)
    .toLowerCase()
    .replace(/^i /, "")
    .replace(/[.;,:]+$/, "");
  // An empty quote is a substring of everything; never count it as verified.
  if (q === "") return false;
  return normalizeQuote(text).toLowerCase().includes(q);
}

/** Case-insensitive variant for the job post (pasted text often changes case in headings). */
export function postContains(quote: string, post: string): boolean {
  const q = normalizeQuote(quote).toLowerCase();
  if (q === "") return false;
  return normalizeQuote(post).toLowerCase().includes(q);
}

/** Read template definitions without using any preamble text as resume evidence. */
export function templateDefinitions(
  tex: string,
): Map<string, { args: number; body: string }> {
  const preamble = tex
    .replace(/(?<!\\)%.*$/gm, "")
    .split("\\begin{document}")[0];
  const definitions = new Map<string, { args: number; body: string }>();
  const pattern =
    /\\(?:newcommand|renewcommand)\*?\s*\{\\([a-zA-Z]+)\}\s*(?:\[(\d+)\])?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(preamble))) {
    const start = pattern.lastIndex;
    let end = start,
      depth = 1;
    for (; end < preamble.length && depth; end++) {
      if (preamble[end] === "\\" && /[{}]/.test(preamble[end + 1] ?? "")) {
        end++;
        continue;
      }
      if (preamble[end] === "{") depth++;
      if (preamble[end] === "}") depth--;
    }
    if (!depth)
      definitions.set(match[1], {
        args: Number(match[2] ?? 0),
        body: preamble.slice(start, end - 1),
      });
    pattern.lastIndex = end;
  }
  return definitions;
}

/**
 * Visible text of a Jake's-template resume: drops the preamble, comments and layout commands, keeps
 * command arguments (\textbf{Python} → Python, \href{url}{text} → text). Good enough for substring
 * checks, not a TeX renderer.
 */
export function texToPlain(tex: string): string {
  let s = tex.replace(/(?<!\\)%.*$/gm, "");
  const definitions = templateDefinitions(s);
  const begin = s.indexOf("\\begin{document}");
  if (begin < 0) return "";
  s = s.slice(begin + "\\begin{document}".length).split("\\end{document}")[0];
  s = s.split("\\endinput")[0];
  // An argument consumed by an empty/hidden macro is source text, not visible evidence.
  // The recursive call sees only the definition body, with no preamble definitions of its own.
  for (const [name, definition] of definitions) {
    if (
      normalizeQuote(
        texToPlain(`\\begin{document}${definition.body}\\end{document}`),
      )
    )
      continue;
    const uses = new RegExp(`\\\\${name}(?![a-zA-Z])`, "g");
    let use: RegExpExecArray | null;
    while ((use = uses.exec(s))) {
      let end = uses.lastIndex;
      for (let n = 0; n < definition.args; n++) {
        while (/\s/.test(s[end] ?? "") && end < s.length) end++;
        if (s[end] !== "{") break;
        let depth = 1;
        end++;
        while (end < s.length && depth) {
          if (s[end] === "{") depth++;
          if (s[end] === "}") depth--;
          end++;
        }
      }
      s = s.slice(0, use.index) + " " + s.slice(end);
      uses.lastIndex = use.index;
    }
  }
  if (/\\(?:textcolor|color)\s*\{white\}/.test(s)) return ""; // fail closed for hidden color scopes
  // Hidden boxes and disabled branches must not supply visible evidence. Remove balanced arguments.
  s = s.replace(/\\textcolor\s*\{white\}\s*\{[^}]*\}/g, "");
  s = s.replace(/\\iffalse[\s\S]*?\\fi\b/g, "");
  const hidden =
    /\\(?:phantom|hphantom|vphantom|pdfinfo|pdfcatalog|newcommand|renewcommand)\b/g;
  let hit: RegExpExecArray | null;
  while ((hit = hidden.exec(s))) {
    let end = hidden.lastIndex;
    while (/\s/.test(s[end] ?? "") && end < s.length) end++;
    while (s[end] === "{" || s[end] === "[") {
      const opening = s[end],
        closing = opening === "{" ? "}" : "]";
      let depth = 1;
      end++;
      while (end < s.length && depth) {
        if (s[end] === opening) depth++;
        if (s[end] === closing) depth--;
        end++;
      }
      while (/\s/.test(s[end] ?? "") && end < s.length) end++;
    }
    s = s.slice(0, hit.index) + " " + s.slice(end);
    hidden.lastIndex = hit.index;
  }
  s = s
    .replace(/(?<!\\)%.*$/gm, "") // comments
    .replace(/\\href\{[^}]*\}/g, "") // keep only the link text argument
    .replace(/\\(?:begin|end)\{[^}]*\}(?:\[[^\]]*\])?(\{[^}]*\})*/g, " ")
    .replace(
      /\\(?:vspace|hspace|setlength|addtolength)\*?\{[^}]*\}(\{[^}]*\})?/g,
      " ",
    )
    .replace(/\$\|\$/g, "|")
    .replace(/\\\\/g, " ")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, " ") // command names (+ optional args)
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\$/g, "");
  return s.replace(/[ \t]+/g, " ");
}

/** Only visible document text counts as resume evidence. */
export function verifyResumeQuote(quote: string, tex: string): boolean {
  return verifyQuote(quote, texToPlain(tex));
}

// Equivalent spellings, so "Postgres" on the resume satisfies "PostgreSQL" in the post.
const ALIASES: string[][] = [
  ["postgres", "postgresql"],
  ["javascript", "js"],
  ["typescript", "ts"],
  ["ci/cd", "ci cd", "cicd", "continuous integration"],
  ["kubernetes", "k8s"],
  ["node.js", "nodejs", "node"],
  ["react", "react.js", "reactjs"],
  ["next.js", "nextjs"],
  ["rest", "restful", "rest api", "rest apis"],
  ["llm", "llms", "large language model", "large language models"],
  ["aws", "amazon web services"],
  ["gcp", "google cloud"],
  ["oauth", "oauth2", "oauth 2.0"],
  ["jwt", "json web token", "json web tokens"],
  ["sql", "structured query language"],
  ["golang", "go"],
  ["c#", "csharp"],
  ["unit testing", "unit tests"],
  ["api", "apis"],
];

function normTerm(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

/** All spellings that count for `term` (the term itself plus its alias group). */
export function termVariants(term: string): string[] {
  const t = normTerm(term);
  const group = ALIASES.find((g) => g.includes(t));
  return group ? [...new Set([t, ...group])] : [t];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `term` (or an alias) appears in `text` as a whole word, case-insensitive. */
export function termFound(term: string, text: string): boolean {
  const hay = text.toLowerCase().replace(/\s+/g, " ");
  return termVariants(term).some((v) =>
    // Word-ish boundaries that still work for terms like "c#", "node.js", "ci/cd".
    new RegExp(`(?<![a-z0-9])${escapeRe(v)}(?![a-z0-9])`).test(hay),
  );
}
