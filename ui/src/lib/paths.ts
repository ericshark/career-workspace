// Single gate for filesystem access: every path is resolved against CAREER_ROOT and checked with
// realpath, so `..` and symlink escapes can't reach files outside the allowlists in docs/05-api.md.
import fs from "node:fs";
import path from "node:path";

export const CAREER_ROOT = process.env.CAREER_ROOT
  ? path.resolve(process.env.CAREER_ROOT)
  : path.resolve(process.cwd(), "..");

export const MASTER_CATEGORIES = [
  "tech",
  "general",
  "datacenter",
  "hourly",
] as const;
export const APPLICATIONS_FILE = "records/applications.md";

/** Returns the real absolute path if `rel` stays inside `root`; otherwise null. */
export function resolveInside(root: string, rel: string): string | null {
  if (path.isAbsolute(rel) || rel.includes("\0")) return null;
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, rel);
  // Resolve symlinks on the deepest existing ancestor (the file itself may not exist yet).
  const exists = (p: string) => {
    try {
      fs.lstatSync(p);
      return true;
    } catch {
      return false;
    }
  };
  let probe = target;
  while (!exists(probe) && probe !== realRoot) probe = path.dirname(probe);
  let realProbe: string;
  try {
    realProbe = fs.realpathSync(probe);
  } catch {
    return null;
  } // dangling symlinks still redirect writes; never treat them as new files
  const rest = path.relative(probe, target);
  const real = path.join(realProbe, rest);
  const inside = real === realRoot || real.startsWith(realRoot + path.sep);
  return inside ? real : null;
}

/** Pin a namespace to its spelling: an allowed root must never redirect into another namespace. */
export function resolveExpected(rel: string): string {
  const expected = path.resolve(fs.realpathSync(CAREER_ROOT), rel);
  const real = resolveInside(CAREER_ROOT, rel);
  if (!real || real !== expected)
    throw new Error(`Unsafe canonical path: ${rel}`);
  return real;
}

/** Policy checks always use the canonical relative name, including aliases inside the workspace. */
export function canonicalRelative(rel: string): string | null {
  const real = resolveInside(CAREER_ROOT, rel);
  return real
    ? path
        .relative(fs.realpathSync(CAREER_ROOT), real)
        .split(path.sep)
        .join("/")
    : null;
}
