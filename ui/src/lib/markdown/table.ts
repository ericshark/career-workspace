// Generic GFM table split/parse/serialize. Owner: Agent A. Spec: docs/03-data-layer.md ("Parsing: split, don't rewrite").
// Round-trip invariant: joinTable(splitTable(text, header)) === text (byte-identical).
//
// We deliberately avoid a markdown AST: AST round-trips reformat whitespace and escaping. Instead the
// file is cut into prefix | header | separator | body lines | suffix, and only `body` is ever edited.
import type { SplitTable } from "../types";

// A GFM delimiter row, e.g. `|---|:--:|` or `| ---- | ---- |`.
const SEPARATOR_RE = /^\|(\s*:?-+:?\s*\|)+\s*$/;

/** Split `text` around the table whose header line equals `headerLine` (trailing whitespace ignored). */
export function splitTable(text: string, headerLine: string): SplitTable {
  // Line endings are detected once from the file and reused on write. Mixed endings are not supported.
  const eol: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = text.endsWith("\n");
  const notFound: SplitTable = {
    found: false,
    prefix: text,
    header: "",
    separator: "",
    body: [],
    suffix: "",
    eol,
    endsWithNewline,
  };

  // Splitting on the exact eol (not a regex) keeps join(eol) an exact inverse of split(eol).
  const lines = text.split(eol);
  const want = headerLine.trimEnd();
  const h = lines.findIndex((l) => l.trimEnd() === want);
  // The header must be directly followed by a separator row, otherwise it isn't this table.
  if (h < 0 || h + 1 >= lines.length || !SEPARATOR_RE.test(lines[h + 1].trim()))
    return notFound;

  // Body = every following line that starts with `|`, up to the first line that doesn't.
  let end = h + 2;
  while (end < lines.length && lines[end].startsWith("|")) end++;

  const rest = lines.slice(end);
  return {
    found: true,
    // Everything before the header, including the eol that ends the previous line.
    prefix: lines
      .slice(0, h)
      .map((l) => l + eol)
      .join(""),
    header: lines[h],
    separator: lines[h + 1],
    body: lines.slice(h + 2, end),
    // Starts with the eol that terminated the last table line (if any line follows it, or the file
    // ends with a newline, in which case `rest` is [""]). Empty if the table ends the file with no eol.
    suffix: rest.length ? eol + rest.join(eol) : "",
    eol,
    endsWithNewline,
  };
}

/** Reassemble a SplitTable into the original text (with whatever `body` now holds). */
export function joinTable(t: SplitTable): string {
  if (!t.found) return t.prefix;
  return t.prefix + [t.header, t.separator, ...t.body].join(t.eol) + t.suffix;
}

/** Split one table line into trimmed cells (unescapes `\|`). Returns null if it isn't a table row. */
export function parseRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  // Split on unescaped pipes only. The leading piece (before the first `|`) is always empty; the
  // trailing piece (after the closing `|`) is empty when the row is properly closed. Drop both.
  const pieces = trimmed.split(/(?<!\\)\|/);
  pieces.shift();
  if (pieces.length && pieces[pieces.length - 1].trim() === "") pieces.pop();
  return pieces.map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Serialize cells as `| a | b |` (escapes `|`, collapses newlines/tabs). No column alignment. */
export function serializeRow(cells: string[]): string {
  const escape = (c: string) =>
    c
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .replace(/\|/g, "\\|");
  return "| " + cells.map(escape).join(" | ") + " |";
}

/** True if every cell is empty (the placeholder row). */
export function isPlaceholderRow(cells: string[]): boolean {
  return cells.every((c) => c === "");
}
