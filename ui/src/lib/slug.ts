// <company-role> slugs. Owner: Agent B. Spec: docs/04-screens.md (Tailor panel), docs/09-testing.md (Slug).
import fs from "node:fs";
import path from "node:path";
import { CAREER_ROOT } from "./paths";

const MAX_LEN = 60;
// Words that add nothing to a directory name (company suffixes, seniority markers).
const FILLER = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "plc",
  "sr",
  "jr",
  "senior",
  "junior",
]);

function words(text: string): string[] {
  return text
    .replace(/\([^)]*\)/g, " ") // drop parentheticals like "(NYC)"
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !FILLER.has(w));
}

/** Lowercase ASCII, hyphen-separated, ≤ 60 chars, no leading/trailing hyphen. Drops filler like "Inc", "Sr". */
export function makeSlug(company: string, role: string): string {
  let slug = [...words(company), ...words(role)].join("-");
  if (slug.length > MAX_LEN) {
    // Cut at a word boundary where possible so we don't end on a half word.
    const cut = slug.slice(0, MAX_LEN);
    const boundary = slug[MAX_LEN] === "-";
    slug =
      boundary || !cut.includes("-") ? cut : cut.slice(0, cut.lastIndexOf("-"));
  }
  return slug.replace(/^-+|-+$/g, "");
}

/** Validate a user-supplied slug against /^[a-z0-9]+(-[a-z0-9]+)*$/ and ≤ 60 chars. */
export function isValidSlug(slug: string): boolean {
  return slug.length <= MAX_LEN && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/** If source/tailored/<slug>/ exists, return <slug>-2, -3, … until free. `root` is overridable for tests. */
export function uniqueSlug(slug: string, root: string = CAREER_ROOT): string {
  const taken = (s: string) =>
    fs.existsSync(path.join(root, "source/tailored", s));
  if (!taken(slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}
