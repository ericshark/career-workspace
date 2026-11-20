// Heading anchors shared by the Markdown renderer (ids on h2/h3) and the docs "On this page" list,
// so both produce the same id for the same heading. GitHub-style, so existing #links keep working.

/** "Week 1 (Wed → Tue)" → "week-1-wed--tue" (lowercase, punctuation dropped, spaces → hyphens). */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Plain text of a markdown heading line's content: drops **, *, `, and [text](url) → text. */
export function stripInline(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

/** Headings of the given depths (2 = `##`, 3 = `###`), skipping fenced code, with their anchor ids. */
export function headingOutline(
  markdown: string,
  depths: number[],
): { text: string; id: string; depth: number }[] {
  const out: { text: string; id: string; depth: number }[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{2,6}) (.+?)\s*#*\s*$/.exec(line);
    if (m && depths.includes(m[1].length)) {
      const text = stripInline(m[2]);
      out.push({ text, id: headingId(text), depth: m[1].length });
    }
  }
  return out;
}

/** The h2 headings of a markdown document (skipping fenced code), with their anchor ids. */
export function h2Outline(markdown: string): { text: string; id: string }[] {
  return headingOutline(markdown, [2]).map(({ text, id }) => ({ text, id }));
}

/**
 * Anchor id of the first h2/h3 whose id starts with `prefix`'s id, so a short label like
 * `Tell me about yourself` finds `### "Tell me about yourself"`. Null when nothing matches.
 */
export function findHeadingId(markdown: string, prefix: string): string | null {
  const want = headingId(prefix);
  if (!want) return null;
  return (
    headingOutline(markdown, [2, 3]).find((h) => h.id.startsWith(want))?.id ??
    null
  );
}
