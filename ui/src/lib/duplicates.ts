// Duplicate / repost detection against applications.md rows and saved reviews. Pure.
// Exact = same normalized URL or same ATS job id. Possible = same company + similar title, different posting.
import type {
  ApplicationRow,
  DuplicateMatch,
  DuplicateReport,
  SavedReviewSummary,
} from "./types";

// Query params that identify the job itself; everything else (utm_*, refId, trk, …) is tracking noise.
const KEEP_PARAMS = ["gh_jid", "currentjobid", "jk", "jobid", "job_id"];

/** Lowercase host without www, no fragment, only job-id query params, no trailing slash. "" if unparseable. */
export function normalizeUrl(link: string): string {
  const raw = link.trim();
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...u.searchParams.entries()]
    .filter(([k]) => KEEP_PARAMS.includes(k.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
    .sort();
  const p = u.pathname.replace(/\/+$/, "");
  return `${host}${p}${params.length ? "?" + params.join("&") : ""}`;
}

/**
 * Stable job identity from a posting URL, e.g. "greenhouse:8011770003", "lever:<uuid>",
 * "linkedin:4012345678". Null when the URL's format isn't recognized.
 */
export function jobKeyFromUrl(link: string): string | null {
  let u: URL;
  try {
    u = new URL(
      /^https?:\/\//i.test(link.trim())
        ? link.trim()
        : `https://${link.trim()}`,
    );
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const q = (k: string) => {
    for (const [key, v] of u.searchParams)
      if (key.toLowerCase() === k) return v;
    return null;
  };
  let m: RegExpExecArray | null;

  const gh = q("gh_jid");
  if (gh && /^\d+$/.test(gh)) return `greenhouse:${gh}`;
  if (host.includes("greenhouse.io") && (m = /\/jobs\/(\d+)/.exec(path)))
    return `greenhouse:${m[1]}`;
  if (host.includes("lever.co") && (m = /\/([0-9a-f-]{36})/i.exec(path)))
    return `lever:${m[1].toLowerCase()}`;
  if (host.includes("ashbyhq.com") && (m = /\/([0-9a-f-]{36})/i.exec(path)))
    return `ashby:${m[1].toLowerCase()}`;
  if (host.includes("linkedin.com")) {
    const cj = q("currentjobid");
    if (cj && /^\d+$/.test(cj)) return `linkedin:${cj}`;
    if ((m = /\/jobs\/view\/(?:[^/]*-)?(\d{6,})/.exec(path)))
      return `linkedin:${m[1]}`;
  }
  if (host.includes("indeed.com")) {
    const jk = q("jk");
    if (jk) return `indeed:${jk.toLowerCase()}`;
  }
  if (
    host.includes("myworkdayjobs.com") &&
    (m = /_((?:JR|R|REQ)?-?\d{3,}(?:-\d+)?)$/i.exec(path))
  )
    return `workday:${u.hostname.toLowerCase()}:${m[1].toUpperCase()}`;
  if (host.includes("smartrecruiters.com") && (m = /\/(\d{6,})/.exec(path)))
    return `smartrecruiters:${m[1]}`;
  if (host.includes("workable.com") && (m = /\/j\/([0-9A-F]{6,})/i.exec(path)))
    return `workable:${m[1].toUpperCase()}`;
  if (host.includes("wellfound.com") && (m = /\/jobs\/(\d+)/.exec(path)))
    return `wellfound:${m[1]}`;
  if (host.includes("workatastartup.com") && (m = /\/jobs\/(\d+)/.exec(path)))
    return `yc:${m[1]}`;
  // School subdomains (csicuny.joinhandshake.com) and /jobs, /stu/jobs, /job-search paths share one id.
  if (
    host.includes("joinhandshake.com") &&
    (m = /\/(?:jobs|job-search)\/(\d+)/.exec(path))
  )
    return `handshake:${m[1]}`;
  return null;
}

const COMPANY_FILLER = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "technologies",
  "technology",
  "labs",
  "the",
]);

// Matching compares every tracker row with every saved review, so the same few hundred company names
// are normalized thousands of times per request. The function is pure; remember its results.
const companyCache = new Map<string, string>();
const COMPANY_CACHE_LIMIT = 5_000;

/** "Brightpath, Inc." → "brightpath" */
export function normalizeCompany(name: string): string {
  const cached = companyCache.get(name);
  if (cached !== undefined) return cached;
  const normalized = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !COMPANY_FILLER.has(w))
    .join(" ");
  if (companyCache.size >= COMPANY_CACHE_LIMIT) companyCache.clear();
  companyCache.set(name, normalized);
  return normalized;
}

const NUMERALS: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4" };
const TITLE_FILLER = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "for",
  "to",
  "in",
  "at",
  "with",
]);
const TITLE_SYNONYMS: Record<string, string> = {
  sr: "senior",
  jr: "junior",
  swe: "software engineer",
  eng: "engineer",
  dev: "developer",
  backend: "back end",
  frontend: "front end",
  fullstack: "full stack",
};

export function isMissingRole(role: string): boolean {
  return /^(?:unknown(?: role| title)?|n\/?a|not (?:stated|named|specified|listed|provided|disclosed)\b.*)?$/i.test(
    role.trim(),
  );
}

function titleTokens(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .flatMap((w) => (TITLE_SYNONYMS[w] ?? w).split(" "))
    .map((w) => NUMERALS[w] ?? w)
    .filter((w) => !TITLE_FILLER.has(w));
  return new Set(words);
}

/** Token Jaccard similarity of two job titles (0..1), with I↔1, SWE↔software engineer, etc. */
export function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export const SIMILAR_TITLE = 0.5;

export interface DuplicateQuery {
  link?: string;
  jobId?: string; // id stated in the post (compared with saved reviews' jobId)
  company?: string;
  role?: string;
}

/**
 * Compare a posting against every application row (any status) and every saved review. Each match
 * carries the row's status and date, so `to apply` vs `applied` vs `rejected` is visible.
 */
export function findDuplicates(
  q: DuplicateQuery,
  rows: ApplicationRow[],
  reviews: SavedReviewSummary[] = [],
): DuplicateReport {
  const url = q.link ? normalizeUrl(q.link) : "";
  const key = q.link ? jobKeyFromUrl(q.link) : null;
  const jobId = (q.jobId ?? "").trim().toLowerCase();
  const company = q.company ? normalizeCompany(q.company) : "";
  const exact: DuplicateMatch[] = [];
  const possible: DuplicateMatch[] = [];

  const classify = (other: {
    link: string;
    company: string;
    role: string;
    jobId?: string;
  }): { reason: DuplicateMatch["reason"]; similarity?: number } | null => {
    if (url && other.link && normalizeUrl(other.link) === url)
      return { reason: "url" };
    if (key && other.link && jobKeyFromUrl(other.link) === key)
      return { reason: "job-id" };
    if (
      jobId &&
      other.jobId &&
      other.jobId.trim().toLowerCase() === jobId &&
      company &&
      normalizeCompany(other.company) === company
    )
      return { reason: "job-id" };
    if (company && q.role && normalizeCompany(other.company) === company) {
      const similarity = titleSimilarity(q.role, other.role);
      if (similarity >= SIMILAR_TITLE)
        return {
          reason: "company-title",
          similarity: Math.round(similarity * 100) / 100,
        };
    }
    return null;
  };

  for (const r of rows) {
    const c = classify(r);
    if (!c) continue;
    const m: DuplicateMatch = {
      kind: "application",
      reason: c.reason,
      company: r.company,
      role: r.role,
      date: r.date,
      status: r.status,
      link: r.link,
      resume: r.resume,
      key: r.key,
      recordId: r.recordId || undefined,
      lineIndex: r.lineIndex,
      ...(c.similarity !== undefined ? { similarity: c.similarity } : {}),
    };
    (c.reason === "company-title" ? possible : exact).push(m);
  }
  for (const v of reviews) {
    const c = classify(v);
    if (!c) continue;
    const m: DuplicateMatch = {
      kind: "review",
      recordKind: v.kind,
      reason: c.reason,
      company: v.company,
      role: v.role,
      date: v.reviewedAt,
      status: v.decision,
      link: v.link,
      reviewPath: v.mdPath,
      ...(c.similarity !== undefined ? { similarity: c.similarity } : {}),
    };
    (c.reason === "company-title" ? possible : exact).push(m);
  }
  return { exact, possible };
}

/** The `to apply` row a submission should update instead of adding a new row (exact match only). */
export function pendingRowFor(
  q: DuplicateQuery,
  rows: ApplicationRow[],
): ApplicationRow | null {
  const { exact } = findDuplicates({ link: q.link }, rows);
  const hits = exact.filter(
    (m) => m.kind === "application" && m.status === "to apply",
  );
  if (hits.length !== 1) return null;
  const hit = hits[0];
  return (
    rows.find((r) => r.key === hit.key && r.lineIndex === hit.lineIndex) ?? null
  );
}
