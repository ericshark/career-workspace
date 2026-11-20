// Read-only docs browser over profile|guide|records/**/*.md (allowlist from docs/05-api.md).
import fs from "node:fs";
import path from "node:path";
import { DOC_PATH_RE, DOC_ROOTS, HIDDEN_DOCS } from "./docsConfig";
import { CAREER_ROOT, resolveInside } from "./paths";
import type { DocsTreeNode } from "./types";

function walk(rel: string): DocsTreeNode[] {
  const abs = path.join(CAREER_ROOT, rel);
  const nodes: DocsTreeNode[] = [];
  for (const entry of fs
    .readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      const children = walk(childRel);
      if (children.length)
        nodes.push({ name: entry.name, path: childRel, children });
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !(childRel in HIDDEN_DOCS) // shown on another screen (e.g. applications.md → Tracker)
    ) {
      nodes.push({ name: entry.name, path: childRel });
    }
  }
  return nodes;
}

export async function docsTree(): Promise<DocsTreeNode[]> {
  return DOC_ROOTS.filter((r) =>
    fs.existsSync(
      /* turbopackIgnore: true */ path.join(
        /* turbopackIgnore: true */ CAREER_ROOT,
        r,
      ),
    ),
  ).map((r) => ({
    name: `${r}/`,
    path: r,
    children: walk(r),
  }));
}

/** Markdown for an allowlisted relative path, or null if disallowed or missing. */
export async function readDoc(relPath: string): Promise<string | null> {
  if (!DOC_PATH_RE.test(relPath)) return null;
  const real = resolveInside(CAREER_ROOT, relPath);
  if (!real) return null;
  // The realpath must still be allowlisted (a symlink could point elsewhere in the repo).
  const rel = path
    .relative(fs.realpathSync(CAREER_ROOT), real)
    .split(path.sep)
    .join("/");
  if (!DOC_PATH_RE.test(rel) || !fs.existsSync(real)) return null;
  return fs.readFileSync(real, "utf8");
}
