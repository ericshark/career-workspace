// Quick add: no review. One small model call (Haiku, no tools, no CLAUDE.md/skills loaded) extracts
// the tracker fields; code adds posting age, lane and the duplicate check; the workspace owner submits the card; then the row
// is written (Fit/Match blank). UI batch adds save a concise brief in records/reviews/.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  NotFoundError,
  readApplications,
  upsertApplication,
  type UndoTarget,
} from "./applications";
import { AgentError, runAgent } from "./claude/agent";
import { QuickBatchSchema, quickBatchJsonSchema } from "./claude/schemas";
import { checkDuplicates } from "./dupCheck";
import { atomicWrite, ConflictError } from "./fileStore";
import { CAREER_ROOT } from "./paths";
import { saveQuick } from "./reviews";
import { postingAge } from "./scoring/age";
import { isMissingRole, jobKeyFromUrl } from "./duplicates";
import { isMissingJobIdentity } from "./jobIdentity";
import { makeSlug } from "./slug";
import { sourceFromLink } from "./sources";
import type {
  DuplicateReport,
  QuickBatchResult,
  QuickExtract,
  QuickJob,
  QuickRecord,
  QuickResult,
  ReviewDecision,
} from "./types";

import {
  PROVIDER_LABELS,
  laneForResume,
  quickModel,
  type Provider,
} from "./config";
import { readPreferences } from "./preferences";
import { formatJobBrief } from "./jobBrief";
import { quickInstructions, fillInstructions } from "./claude/prompts";
export { QUICK_MODEL } from "./config";

export interface QuickRequest {
  jobPost: string;
  originalJobPost?: string;
  jobBrief?: import("./jobBrief").JobBrief;
  link?: string;
  source?: string;
}

/** Pending extraction, kept on disk between "extract" and "log" (survives a page refresh). */
interface PendingQuick {
  request: QuickRequest;
  result: QuickResult;
  today: string;
  postFormat?: "brief";
  undo?: UndoTarget;
  input?: QuickLogInput;
}

/** The one placeholder Quick add uses when a post doesn't name its employer. */
export const UNKNOWN_COMPANY = "Unknown";
const DEFAULT_QUICK_ROLE = "Software Engineer";

function quickRole(role: string): string {
  return isMissingRole(role) ? DEFAULT_QUICK_ROLE : role.trim();
}

const pendingDir = () => path.join(CAREER_ROOT, "ui", ".cache", "quick");
const receiptsDir = () =>
  path.join(CAREER_ROOT, "ui", ".cache", "quick-receipts");
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Deterministic part: posting age, lane, duplicates, slug. Pure apart from the duplicate check. */
export function prepareQuick(
  extract: QuickExtract,
  req: QuickRequest,
  today: string,
  quickId: string = randomUUID(),
  duplicates = checkDuplicates({
    link: req.link,
    jobId: extract.jobId,
    company: extract.company,
    role: extract.role,
  }),
): QuickResult {
  return {
    quickId,
    extract,
    age: postingAge(extract.postedText, extract.postedDate, req.jobPost, today),
    duplicates,
    lane: laneForResume(extract.suggestedResume),
    suggestedSlug: makeSlug(extract.company, extract.role),
  };
}

/** Fixture extraction for UI_FIXTURES=1: first line = "Company — Role", no model call. */
export function fixtureQuick(jobPost: string): QuickExtract {
  const first = jobPost.trim().split(/\n/)[0] ?? "";
  const [company, role] = first.split(/\s+[—-]\s+/);
  return {
    company: company?.trim() || "Fixture Co",
    role: quickRole(role?.split(/\.\s/)[0] ?? ""),
    location: "New York, NY",
    workMode: "unknown",
    level: "",
    postedText: /posted [^.\n]*/i.exec(jobPost)?.[0] ?? "",
    postedDate: "",
    jobId: "",
    suggestedResume: "tech",
  };
}

export function savePending(p: PendingQuick): void {
  fs.mkdirSync(pendingDir(), { recursive: true });
  atomicWrite(
    path.join(pendingDir(), `${p.result.quickId}.json`),
    JSON.stringify(p),
  );
}

export function loadPending(quickId: string): PendingQuick | null {
  if (!ID_RE.test(quickId)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(pendingDir(), `${quickId}.json`), "utf8"),
    ) as PendingQuick;
  } catch {
    return null;
  }
}

export interface QuickLogInput {
  decision: "submitted" | "later";
  company: string;
  role: string;
  resume: string;
  lane: "tech" | "bridge";
  source: string;
  link?: string;
  date?: string;
}

/** The record kept in records/reviews/ for a logged quick add. Pure. */
export function quickRecord(
  p: PendingQuick,
  input: QuickLogInput,
  now = new Date(),
): QuickRecord {
  const decision: ReviewDecision =
    input.decision === "submitted" ? "applied" : "later";
  return {
    version: 2,
    kind: "quick",
    id: p.result.quickId,
    savedAt: now.toISOString(),
    reviewedAt: p.today,
    request: {
      jobPost: p.request.jobPost,
      ...(p.request.jobBrief ? { jobBrief: p.request.jobBrief } : {}),
      ...(p.request.originalJobPost
        ? { originalJobPost: p.request.originalJobPost }
        : {}),
      ...(input.link || p.request.link
        ? { link: input.link || p.request.link }
        : {}),
      ...(input.source ? { source: input.source } : {}),
    },
    ...(p.postFormat ? { postFormat: p.postFormat } : {}),
    extract: { ...p.result.extract, company: input.company, role: input.role },
    age: p.result.age,
    decision,
    resume: input.resume,
    slug: makeSlug(input.company, input.role),
  };
}

/**
 * Write the tracker row (Fit/Match blank; a saved-for-later row for the same posting is updated, not
 * duplicated) and keep the description. Retries once if applications.md changed in between.
 */
export async function logQuick(
  quickId: string,
  input: QuickLogInput,
  today: string,
  retainPending = false,
): Promise<{
  upsert: Awaited<ReturnType<typeof upsertApplication>>;
  mdPath: string;
  slug: string;
}> {
  const p = loadPending(quickId);
  if (!p) throw new NotFoundError("Unknown quick add (extract it again)");
  input = p.input ?? { ...input, role: quickRole(input.role) };
  if (retainPending) today = p.today;
  p.input = input;
  savePending(p);
  const link = input.link?.trim() || p.request.link || "";
  let upsert: Awaited<ReturnType<typeof upsertApplication>> | null = null;
  for (let i = 0; i < 2 && !upsert; i++) {
    const { fileHash } = await readApplications();
    try {
      upsert = await upsertApplication(
        {
          fileHash,
          reviewId: quickId,
          decision: input.decision,
          ...(input.date ? { date: input.date } : {}),
          row: {
            company: input.company,
            role: input.role,
            lane: input.lane,
            resume: input.resume,
            fit: null,
            match: null,
            source: input.source,
            ...(link ? { link } : {}),
            recordId: quickId,
          },
        },
        today,
        (undo) => {
          p.undo = undo;
          savePending(p);
        },
      );
    } catch (e) {
      if (!(e instanceof ConflictError) || i === 1) throw e;
    }
  }
  // Another request may have committed this same submission while we waited for the lock.
  const journal = loadPending(quickId);
  if (journal?.undo) upsert!.undo = journal.undo;
  const saved = saveQuick(quickRecord(p, { ...input, link }));
  if (!retainPending)
    fs.rmSync(path.join(pendingDir(), `${quickId}.json`), { force: true });
  return { upsert: upsert!, mdPath: saved.mdPath, slug: saved.slug };
}

// ───────────── batch quick add: jobs entered one by one, one call, every job logged as applied ─────────────

/** One job as entered in the Quick add list: an optional URL and its own description. */
export interface QuickBatchJob {
  /** Stable for retries of this card; a new paste/edit gets a new identity. */
  submissionId?: string;
  link?: string;
  description: string;
}

export interface QuickBatchRequest {
  jobs: QuickBatchJob[];
  /** A source picked in the UI for the whole batch; overrides per-job detection. */
  source?: string;
  /** Which plan's fast model reads the batch (default Claude). */
  provider?: Provider;
}

/**
 * Each job goes in its own numbered block, so the model never has to find where one job ends:
 * the boundaries come from the UI, and the model only reads the fields of each block.
 */
export function buildQuickBatchPrompt(jobs: QuickBatchJob[]): string {
  const blocks = jobs
    .map(
      (j, i) => `<job number="${i + 1}">
Job ${i + 1}
URL: ${j.link?.trim() || "none"}
Description:
${j.description.trim()}
</job>`,
    )
    .join("\n\n");
  const { userPrompt } = quickInstructions("quick-add.md");
  return `${fillInstructions(userPrompt, {
    jobCount: String(jobs.length),
    plural: jobs.length === 1 ? "" : "s",
    unknownCompany: UNKNOWN_COMPANY,
  })}
<job_posts>
${blocks}
</job_posts>`;
}

/** Missing extracted facts are unknown, not a reason to reject an otherwise valid job. */
function normalizeQuickBatch(output: unknown): unknown {
  if (!output || typeof output !== "object" || !("jobs" in output))
    return output;
  if (!Array.isArray(output.jobs)) return output;
  const placeholder = (value: unknown) =>
    value == null
      ? "Unknown"
      : typeof value === "string"
        ? value.trim() || "Unknown"
        : value;
  return {
    ...output,
    jobs: output.jobs.map((job: unknown) => {
      if (!job || typeof job !== "object") return job;
      const fields = job as Record<string, unknown>;
      const brief = fields.jobBrief;
      return {
        ...fields,
        company: placeholder(fields.company),
        role:
          fields.role == null || typeof fields.role === "string"
            ? quickRole(fields.role ?? "")
            : fields.role,
        ...Object.fromEntries(
          [
            "location",
            "level",
            "postedText",
            "postedDate",
            "jobId",
            "link",
          ].map((key) => [key, fields[key] ?? ""]),
        ),
        workMode:
          fields.workMode === "" ? "unknown" : (fields.workMode ?? "unknown"),
        jobBrief:
          brief == null || (typeof brief === "object" && !Array.isArray(brief))
            ? (() => {
                const data = (brief ?? {}) as Record<string, unknown>;
                return {
                  ...data,
                  overview: placeholder(data.overview),
                  ...Object.fromEntries(
                    ["experience", "location", "compensation"].map((key) => [
                      key,
                      data[key] ?? "",
                    ]),
                  ),
                  responsibilities: data.responsibilities ?? [],
                  qualifications: data.qualifications ?? [],
                };
              })()
            : brief,
      };
    }),
  };
}

/** One fast-model call (Haiku or Luna) with no tools that reads every entered job. */
export async function extractQuickBatch(
  jobs: QuickBatchJob[],
  signal?: AbortSignal,
  provider: Provider = "claude",
  effort?: "low" | "medium" | "high",
): Promise<QuickJob[]> {
  const preferences = readPreferences();
  const model = preferences.selections[provider].quick ?? quickModel(provider);
  const chosenEffort =
    effort ?? preferences.operationEfforts[`quick:${model}`] ?? "low";
  const run = await runAgent({
    operation: "quick",
    prompt: buildQuickBatchPrompt(jobs),
    systemPrompt: quickInstructions("quick-add.md").systemPrompt,
    tools: [],
    model,
    effort: chosenEffort,
    allowedTools: [],
    maxTurns: 3,
    signal,
    settingSources: [],
    outputSchema: quickBatchJsonSchema(),
    decide: (tool) =>
      tool === "StructuredOutput"
        ? { allow: true }
        : { allow: false, reason: "Quick add has no tools" },
  });
  if (run.subtype !== "success")
    throw new AgentError(
      `${PROVIDER_LABELS[provider]} did not return the jobs' details (${run.subtype})`,
      "claude",
    );
  const parsed = QuickBatchSchema.safeParse(
    normalizeQuickBatch(run.structuredOutput),
  );
  if (!parsed.success)
    throw new AgentError(
      `${PROVIDER_LABELS[provider]} returned invalid jobs' details: ${parsed.error.issues
        .slice(0, 4)
        .map(
          (issue) => `${issue.path.join(".") || "response"}: ${issue.message}`,
        )
        .join("; ")}`,
      "claude",
    );
  return parsed.data.jobs;
}

/** Fixture batch for UI_FIXTURES=1: each job is read by fixtureQuick, no model call. */
export function fixtureQuickBatch(jobs: QuickBatchJob[]): QuickJob[] {
  return jobs.map((j, i) => {
    const { suggestedResume: _, ...e } = fixtureQuick(j.description);
    return {
      ...e,
      job: i + 1,
      link: /https?:\/\/\S+/.exec(j.description)?.[0] ?? "",
      jobBrief: {
        overview: `${e.role} at ${e.company}. This fixture role involves software development and delivery.`,
        experience: "",
        responsibilities: ["Build and maintain software for the team"],
        qualifications: ["Software development experience"],
        location: e.location,
        compensation: "",
      },
    };
  });
}

const URL_RE = /https?:\/\/[^\s<>"'()[\]]+/g;
const POSTING_PATH_RE = /job|career|position|opening|vacanc|apply|requisition/i;

/**
 * Whether a URL found inside a description plausibly is the posting or its application page: a known
 * job board, a recognized ATS job URL, or a jobs-like path. Pasted descriptions also carry footer
 * links (EEO notices, privacy policies, company home pages) that must not become the row's link.
 */
export function looksLikePostingUrl(link: string): boolean {
  if (sourceFromLink(link) || jobKeyFromUrl(link)) return true;
  try {
    return POSTING_PATH_RE.test(new URL(link).pathname);
  } catch {
    return false;
  }
}

/**
 * The link for one job: the URL the workspace owner entered; else the model's link if it really is in the job's
 * description and looks like a posting; else the first posting-like URL in the description. Never a
 * URL the job lacks; no link is better than a wrong one.
 */
export function jobLink(
  enteredLink: string,
  modelLink: string,
  description: string,
): string {
  if (enteredLink.trim()) return enteredLink.trim();
  const link = modelLink.trim();
  if (link && description.includes(link) && looksLikePostingUrl(link))
    return link;
  const urls = (description.match(URL_RE) ?? []).map((u) =>
    u.replace(/[.,;:!?]+$/, ""),
  );
  return urls.find(looksLikePostingUrl) ?? "";
}

/** Source for a batch job: the link's job board, else the board the text named, else Other. */
export function pickSource(link: string, named: string): string {
  return sourceFromLink(link) ?? (named.trim() || "Other");
}

function normalizeLink(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).toString();
  } catch {
    return "";
  }
}

/**
 * True for the placeholder (and older wordings such as "Not stated in post") used when a post
 * doesn't name its employer. Two such jobs with the same title are usually different employers, so
 * company + title can't identify them; only a link or job id can.
 */
export function isUnknownCompany(company: string): boolean {
  return /^unknown$|^not (stated|named|specified|listed|disclosed)\b/i.test(
    company.trim(),
  );
}

export type QuickUndoRecord = UndoTarget & { kind: "quick"; quickSlug: string };

interface QuickReceipt {
  request: QuickBatchJob;
  added: QuickBatchResult["added"][number];
  job: QuickJob;
}

function loadReceipt(id: string): QuickReceipt | null {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(receiptsDir(), `${id}.json`), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Recovery uses the stored extraction, so retrying a failed save needs no paid model call. */
export function recoverQuickBatch(jobs: QuickBatchJob[]): QuickJob[] | null {
  const recovered = jobs.map((job, i) => {
    if (!job.submissionId) return null;
    const receipt = loadReceipt(job.submissionId);
    if (receipt) return { ...receipt.job, job: i + 1 };
    const pending = loadPending(job.submissionId);
    if (!pending?.request.jobBrief) return null;
    const { suggestedResume: _, ...extract } = pending.result.extract;
    return {
      ...extract,
      job: i + 1,
      link: pending.request.link ?? "",
      source: pending.request.source ?? "Other",
      jobBrief: pending.request.jobBrief,
    };
  });
  return recovered.every((job) => job !== null) ? recovered : null;
}

/**
 * Log every entered job as applied today (resume tech, Fit/Match blank), one after another, using
 * the model's fields for it (matched by job number). Duplicate matches are informational. Stops at the first failed write. `remaining` lists the job numbers (1-based)
 * that were not handled, so the UI keeps them in its list. `saveUndo` returns each row's undo id.
 */
export async function quickAddBatch(
  extracted: QuickJob[],
  req: QuickBatchRequest,
  today: string,
  saveUndo: (r: QuickUndoRecord) => string,
  calendarToday = today,
): Promise<QuickBatchResult> {
  const out: QuickBatchResult = { added: [], skipped: [], remaining: [] };
  const byNumber = new Map<number, QuickJob>();
  for (const j of extracted) if (!byNumber.has(j.job)) byNumber.set(j.job, j);
  for (const [i, entered] of req.jobs.entries()) {
    const number = i + 1;
    const receipt = entered.submissionId
      ? loadReceipt(entered.submissionId)
      : null;
    if (receipt) {
      if (
        receipt.request.description !== entered.description ||
        (receipt.request.link ?? "") !== (entered.link ?? "")
      )
        throw new ConflictError(
          "This submission ID belongs to a different job card",
        );
      out.added.push({ ...receipt.added, job: number });
      continue;
    }
    const pending = entered.submissionId
      ? loadPending(entered.submissionId)
      : null;
    if (
      pending &&
      (pending.request.originalJobPost !== entered.description.trim() ||
        (pending.request.link ?? "") !==
          normalizeLink(
            jobLink(
              entered.link ?? "",
              pending.request.link ?? "",
              entered.description,
            ),
          ))
    )
      throw new ConflictError(
        "This submission ID belongs to a different job card",
      );
    const job = byNumber.get(number);
    if (!job) {
      out.skipped.push({
        job: number,
        company: `Job ${number}`,
        role: "",
        reason: `${PROVIDER_LABELS[req.provider ?? "claude"]} didn't read this job; it's still in your list`,
      });
      out.remaining.push(number);
      continue;
    }
    const company = pending?.input?.company ?? job.company.trim();
    const role = pending?.input?.role ?? quickRole(job.role);
    const description = entered.description.trim();
    const link = normalizeLink(
      jobLink(entered.link ?? "", job.link, description),
    );
    const duplicates = checkDuplicates({
      link,
      jobId: job.jobId,
      company,
      role,
    });
    const source =
      pending?.input?.source ??
      pending?.request.source ??
      (req.source?.trim() || "Other");
    const { job: _j, link: _l, source: _n, jobBrief, ...fields } = job;
    const extract: QuickExtract = {
      ...fields,
      company,
      role,
      suggestedResume: "tech",
    };
    const request: QuickRequest = {
      originalJobPost: description,
      jobBrief,
      jobPost: formatJobBrief(company, role, jobBrief),
      ...(link ? { link } : {}),
      source,
    };
    const result = prepareQuick(
      extract,
      { ...request, jobPost: description },
      calendarToday,
      entered.submissionId,
      duplicates,
    );
    try {
      if (!pending)
        savePending({ request, result, today, postFormat: "brief" });
      const { upsert, slug } = await logQuick(
        pending?.result.quickId ?? result.quickId,
        {
          decision: "submitted",
          company,
          role,
          resume: "tech",
          lane: result.lane,
          source,
          ...(link ? { link } : {}),
        },
        today,
        true,
      );
      // Judged on what the post stated, before the default title replaces a missing role.
      const missing: ("company" | "role")[] = [
        ...(isMissingJobIdentity(job.company) ? (["company"] as const) : []),
        ...(isMissingJobIdentity(job.role) ? (["role"] as const) : []),
      ];
      const added: QuickBatchResult["added"][number] = {
        job: number,
        company,
        role,
        source,
        ...(missing.length ? { missing } : {}),
        action: upsert.action,
        undoId: saveUndo({ ...upsert.undo, kind: "quick", quickSlug: slug }),
        quickId: pending?.result.quickId ?? result.quickId,
        duplicates: pending?.result.duplicates ?? duplicates,
      };
      fs.mkdirSync(receiptsDir(), { recursive: true });
      atomicWrite(
        path.join(receiptsDir(), `${added.quickId}.json`),
        JSON.stringify({ request: entered, added, job } satisfies QuickReceipt),
      );
      fs.rmSync(path.join(pendingDir(), `${added.quickId}.json`), {
        force: true,
      });
      out.added.push(added);
    } catch (e) {
      out.error = `${company} — ${role}: ${e instanceof Error ? e.message : String(e)}`;
      for (let n = number; n <= req.jobs.length; n++) out.remaining.push(n);
      break;
    }
  }
  return out;
}
