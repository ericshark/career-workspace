// Shared contracts for the whole app. Source of truth: ui/docs/05-api.md and ui/docs/03-data-layer.md.
// Parallel agents code against these types; change them only deliberately (and update the docs).

// ───────────── applications.md (03-data-layer.md) ─────────────

// Older rows may carry legacy statuses; lib/status.ts normalizes them on read.
export const STATUSES = [
  "to apply",
  "applied",
  "in progress",
  "no response",
  "rejected",
  // Rejected after the application had reached In progress (assessment, interview, ...).
  "unsuccessful",
] as const;
export type Status = (typeof STATUSES)[number];

/** Exact header of the application table (v3); if the file's header differs, the UI goes read-only. */
export const APPLICATIONS_HEADER =
  "| Date | Company | Role | Lane | Resume | Fit | Match | Source | Status | Next (action + date) | Link | Record ID |";
export const APPLICATIONS_HEADER_V2 =
  "| Date | Company | Role | Lane | Resume | Fit | Match | Source | Status | Next (action + date) | Link |";
/** The v1 header (single Score + tailoring Lvl). Only `migrateV1ToV2` reads it. */
export const APPLICATIONS_HEADER_V1 =
  "| Date | Company | Role | Lane | Resume | Lvl | Score | Source | Status | Next (action + date) | Link |";

export interface ApplicationRow {
  foundLink?: import("./foundLink").FoundLink;
  /** Set when the last search found nothing, or the workspace owner dismissed the Find button. */
  linkLookup?: import("./foundLink").LinkLookup;
  date: string; // YYYY-MM-DD: submit date for submitted rows, save date for `to apply`
  company: string;
  role: string;
  lane: "tech" | "bridge";
  resume: string; // tech | general | datacenter | hourly | tailored/<slug>
  fit: string; // Candidate Fit "0".."100", or "" for hand-added rows
  match: string; // Resume Match "0".."100", or ""
  source: string;
  status: Status | string; // unknown statuses are kept as-is (just not counted)
  next: string;
  link: string;
  recordId?: string; // empty for old or manually added rows
  // derived at read time, never written:
  key: string; // sha1(date|company|role|link)
  lineIndex: number; // index into the table body at read time
}

/** Result of splitting a markdown file around one table (prefix/suffix are kept byte-for-byte). */
export interface SplitTable {
  found: boolean;
  prefix: string; // everything before the header line
  header: string;
  separator: string;
  body: string[]; // raw body lines (including the placeholder row, malformed rows)
  suffix: string; // everything after the table body
  eol: "\n" | "\r\n";
  endsWithNewline: boolean;
}

export type ReadOnlyState = false | { reason: string };

export interface ApplicationsPayload {
  rows: ApplicationRow[];
  malformed: { lineIndex: number; text: string }[];
  fileHash: string; // sha256 of applications.md at read time
  readOnly: ReadOnlyState;
  /** Follow-up work that did not finish after the row was already saved (the edit itself succeeded). */
  warnings?: string[];
}

export interface NewApplication {
  reviewId?: string;
  fileHash: string;
  decision: "submitted" | "later";
  /** Submit date (submitted) or save date (later). Defaults to today. */
  date?: string;
  row: {
    company: string;
    role: string;
    lane: "tech" | "bridge";
    resume: string; // "tech" | "general" | "datacenter" | `tailored/${slug}`
    fit: number | null; // 0..100
    match: number | null; // 0..100
    source: string;
    next?: string;
    link?: string;
    recordId?: string;
  };
}

/** POST /api/applications response: the fresh payload plus whether a `to apply` row was updated. */
export interface UpsertResult extends ApplicationsPayload {
  action: "inserted" | "updated";
  rowKey: string;
  /** Present on logs from the Apply page: POST /api/applications/undo with it within two minutes. */
  undoId?: string;
}

/** PATCH /api/applications body: at least one change. */
export interface RowChange {
  fileHash: string;
  key: string;
  lineIndex?: number; // disambiguates repeated postings against fileHash
  status?: Status;
  next?: string; // single line, ≤200 chars
  source?: string; // single line, ≤200 chars
  /** Submit date for a `to apply` → `applied` flip (default today). */
  date?: string;
  resume?: string;
  fit?: number | null;
  match?: number | null;
}

// ───────────── progress (03-data-layer.md, 05-api.md) ─────────────

export { DAY_TARGET, WEEK_TARGET } from "./config";

export interface WeekRange {
  from: string; // YYYY-MM-DD
  to: string;
}

export interface Progress {
  maintenanceWarning?: string;
  today: { date: string; tech: number; bridge: number; target: number };
  week: {
    from: string;
    to: string;
    tech: number;
    bridge: number;
    target: number;
    expectedByToday: number;
  };
  streak: {
    days: number; // consecutive days with ≥1 application; an empty Sat/Sun never breaks it
    best: number; // longest streak ever, same rule
    appliedToday: boolean;
    activeDaysThisWeek: number; // weekdays in the week range with ≥1 application
  };
  /** Submitted applications (any lane, status ≠ `to apply`) per YYYY-MM-DD, all history. */
  byDay: Record<string, number>;
  queued: number;
  last5: ApplicationRow[];
  /** Submitted applications ever (any lane, status ≠ `to apply`). */
  allTime: number;
  rejected: number;
  /** Deprecated compatibility field; daily planning has been removed. */
  plan: null;
}

// ───────────── Claude: review / score (02-claude-integration.md, 05-api.md) ─────────────
// Claude only *classifies* (per requirement); lib/scoring/* computes every number from it.

export type ResumeCategory = "tech" | "general" | "datacenter";
/** Models the UI offers (the picker, and zod checks in the score/tailor routes). */
import { MODEL_IDS } from "./config";
export {
  MODEL_IDS,
  DEFAULT_MODEL,
  DEFAULT_REVIEW_MODEL,
  DEFAULT_TAILOR_MODEL,
  DEFAULT_EXTRAS_MODEL,
} from "./config";
export type ModelId = (typeof MODEL_IDS)[number];

export interface SourceStamp {
  version: 1;
  hashes: Record<string, string>;
}

export interface AgentMetrics {
  retryNotices?: number;
  runnerSetupMs?: number;
  modelMs?: number;
  queueWaitMs?: number;
  effort?: string;
  contextMode?: string;
  sdkDurationMs?: number;
  apiDurationMs?: number;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  toolCalls?: number;
  deniedCalls?: number;
  preparationMs?: number;
  validationMs?: number;
  buildMs?: number;
  savingMs?: number;
  totalMs?: number;
}

export type ReqKind = "eligibility" | "must" | "nice";
export type Credit = "strong" | "partial" | "none";
export type Presence = "bullet" | "skills" | "absent";
export type Placement = "prominent" | "buried";
export type FixEffort = "light" | "heavy";
export const BLOCKER_TYPES = [
  "work_auth",
  "citizenship",
  "existing_clearance",
  "license_cert",
  "graduate_degree",
  "grad_window",
  "location_onsite",
  "other",
] as const;
export type BlockerType = (typeof BLOCKER_TYPES)[number];
export type ChangeAction =
  "surface" | "emphasize" | "reorder" | "reword" | "swap" | "keep";

/** One requirement from the post, as Claude classified it. */
export interface ClaudeRequirement {
  id: string; // short id, e.g. "r1"
  text: string;
  kind: ReqKind;
  career: Credit;
  careerQuote: string; // verbatim from profile/career.md ("" when none)
  careerSection: string;
  resume: Presence;
  resumeQuote: string; // verbatim visible text from the master resume ("" when absent)
  placement: Placement | null; // null when absent
  fix: FixEffort | null; // only for supported requirements not already a prominent bullet
  terms: string[]; // the post's key terms for this requirement
}

export interface ClaudeBlocker {
  type: BlockerType;
  quote: string; // verbatim from the post
  mandatory: boolean; // explicit must / required / only
  unmet: boolean; // legacy blocker claim; new reviews do not screen eligibility
  why: string;
}

export interface RecommendedChange {
  action: ChangeAction;
  requirementId: string; // "" when general
  text: string;
}

/** What Claude returns via structured output (validated by lib/claude/schemas.ts). */
export interface DecisionBrief {
  strengths: string;
  gaps: string;
  resumeAction: string;
}

export interface ClaudeReviewOutput {
  decisionBrief?: DecisionBrief;
  company: string;
  role: string;
  location: string;
  workMode: "onsite" | "hybrid" | "remote" | "flexible" | "unknown";
  level: string;
  postedDate: string; // YYYY-MM-DD if the post states it, else ""
  postedText: string; // verbatim posting-date text from the post, else ""
  jobId: string; // req/job id stated in the post, else ""
  requirements: ClaudeRequirement[];
  /** Claude's own judgment; code only maps the score to a band and verdict. */
  fit: { score: number; summary: string };
  match: { score: number; summary: string };
  recommendation: { kind: ResumeRecKind; reason: string };
  keywords: string[]; // important posting terms; code checks which are on the resume
  gaps: string[]; // things career.md genuinely lacks (never claim them)
  blockers: ClaudeBlocker[];
  why: string[];
  recommendedChanges: RecommendedChange[];
  suggestedResume: ResumeCategory;
  suggestedSlug: string;
}

export interface ScoreRequest {
  jobBrief?: import("./jobBrief").JobBrief;
  sourceRecordId?: string;
  sourceApplicationKey?: string;
  trackerCompany?: string;
  trackerRole?: string;
  queueWaitMs?: number;
  effort?: "low" | "medium" | "high";
  jobPost: string; // 200..50_000 chars
  originalJobPost?: string;
  postFormat?: "brief"; // absent on legacy saved reviews
  resume: ResumeCategory;
  link?: string;
  source?: string;
  model?: ModelId;
  /** Score even though the link matches an existing application or saved review. */
  ignoreDuplicate?: boolean;
}

/** Evidence bucket: 1 = on the resume · 2 = in career.md, missing/underrepresented · 3 = unsupported. */
export type Bucket = 1 | 2 | 3;

export interface ReviewRequirement extends ClaudeRequirement {
  careerVerified: boolean;
  resumeVerified: boolean;
  effectiveCredit: Credit; // Claude's credit (quote checks are informational only)
  effectivePresence: Presence; // presence, absent only when the resume quote isn't on the page
  bucket: Bucket;
}

export type FitBand = "strong" | "reasonable" | "stretch" | "weak";
export interface FitScore {
  total: number;
  band: FitBand;
  summary: string; // "" on reviews saved before the LLM-scored review
}

export type MatchBand = "strong" | "moderate" | "weak";
export interface MatchScore {
  total: number | null; // null only on old reviews where nothing was scorable
  band: MatchBand | null;
  summary: string;
  termsFound: string[];
  termsMissing: string[];
}

export type VerdictKind = "apply" | "optional" | "skip" | "blocked";
export interface Verdict {
  kind: VerdictKind;
  text: string; // "Apply" · "Possible fit" · "Skip" · "Blocked → Skip"
}

export type ResumeRecKind =
  "use-master" | "light-tailor" | "tailor" | "dont-tailor";
export interface ResumeRecommendation {
  kind: ResumeRecKind;
  text: string; // current: "Use Master" / "Tailor"; legacy kinds remain readable
  reason: string;
}

/** Historical estimated Resume Match after tailoring. */
export interface Estimate {
  scenario: "light" | "full";
  current: number;
  low: number;
  high: number;
  gainLow: number;
  gainHigh: number;
}

export type AgeBand = "fresh" | "recent" | "older" | "stale" | "unknown";
export interface PostingAge {
  date: string | null; // resolved posting date
  days: number | null;
  band: AgeBand;
  source: "post" | "override" | null;
  quote: string;
  reposted: boolean;
}

export interface Blockers {
  confirmed: ClaudeBlocker[];
  check: (ClaudeBlocker & { reason: string })[]; // shown, no effect on the score
}

export interface DuplicateMatch {
  recordId?: string;
  lineIndex?: number;
  kind: "application" | "review";
  recordKind?: "quick" | "review";
  reason: "url" | "job-id" | "company-title";
  company: string;
  role: string;
  date: string;
  status: string; // row status, or the saved review's decision
  link: string;
  resume?: string;
  key?: string; // application row key (for PATCH)
  reviewPath?: string; // records/reviews/<slug>.md
  similarity?: number; // title similarity for company-title matches
}
export interface DuplicateReport {
  exact: DuplicateMatch[];
  possible: DuplicateMatch[];
}

export interface ScoreResult {
  decisionBrief?: DecisionBrief;
  source?: string;
  runId: string;
  reviewedAt: string; // YYYY-MM-DD
  company: string;
  role: string;
  location: string;
  workMode: ClaudeReviewOutput["workMode"];
  level: string;
  jobId: string;
  link: string;
  resume: ResumeCategory; // the master Resume Match was scored against
  age: PostingAge;
  fit: FitScore;
  match: MatchScore;
  verdict: Verdict;
  recommendation: ResumeRecommendation;
  estimate: Estimate | null;
  requirements: ReviewRequirement[];
  blockers: Blockers;
  why: string[];
  recommendedChanges: RecommendedChange[];
  gaps: string[]; // genuinely missing from career.md: don't claim these
  duplicates: DuplicateReport;
  suggestedResume: ResumeCategory;
  suggestedSlug: string; // already cleaned by slug.ts
  warnings: string[]; // unverified quotes and the like
  meta: {
    persistenceWarning?: string;
    originalAvailable?: boolean;
    briefAvailable?: boolean;
    model: string;
    durationMs: number;
    costUsdEstimate?: number;
    sessionId?: string;
    metrics?: AgentMetrics;
    sources?: SourceStamp;
  };
}

/** POST /api/score when the link is an exact duplicate and ignoreDuplicate wasn't set (no Claude call). */
export interface DuplicateStop {
  duplicate: DuplicateReport;
}

// ───────────── tailoring brief + tailor jobs (05-api.md) ─────────────

export interface TailoringBrief {
  company: string;
  role: string;
  master: string; // source/<category>/resume.tex
  slug: string;
  outputTex: string; // source/tailored/<slug>/resume.tex
  outputPdf: string; // resumes/tailored/<slug>/Resume.pdf
  fit: { total: number; band: FitBand; summary: string };
  match: { total: number | null; summary: string };
  recommendation: ResumeRecommendation;
  estimate: Estimate | null;
  recommendedChanges: RecommendedChange[];
  onResume: BriefItem[]; // bucket 1
  underrepresented: BriefItem[]; // bucket 2: truthful tailoring opportunities
  unsupported: { id: string; text: string }[]; // bucket 3: never add
  missingTerms: string[];
  jobDescription: string; // saved brief for new UI records, original post for older records (untrusted)
}
export interface BriefItem {
  id: string;
  text: string;
  kind: ReqKind;
  career: Credit;
  careerQuote: string;
  careerSection: string;
  resumeQuote: string;
  presence: Presence;
  fix: FixEffort | null;
  terms: string[];
}

export interface TailorRequest {
  runId: string;
  slug: string; // /^[a-z0-9]+(-[a-z0-9]+)*$/, ≤ 60 chars
  overwrite?: boolean;
  model?: ModelId;
}

/** What the tailor agent reports via structured output (validated + verified by the server). */
export interface CandidateEvidence {
  requirementId: string;
  after: string;
  careerQuote: string;
}

export interface CandidateSubmission {
  candidateHash: string;
  edits: { before: string; after: string }[];
  /** Complete evidence for changes relative to the master, including earlier repair rounds. */
  changes: CandidateEvidence[];
}

export interface VerifiedTailorReport extends ClaudeTailorReport {
  candidateHash: string;
  visualPassed: boolean;
  readingOrderPassed: boolean;
  support: { after: string; supported: boolean; reason: string }[];
}

export interface ClaudeTailorReport {
  changes: { requirementId: string; after: string; careerQuote: string }[];
  requirements: {
    id: string;
    presence: Presence;
    placement: Placement | null;
    quote: string; // verbatim visible text from the tailored resume
  }[];
  notes: string;
}

/** Parsed output of scripts/build.sh (03-data-layer.md → build output). `ok` = exit code === 0. */
export interface BuildResult {
  ok: boolean;
  pages: number | null;
  fillPct: number | null;
  ats: "PASS" | "PASS (with warnings)" | "FAIL" | null;
  warnings: string[];
  failures: string[];
  pdfPath: string | null;
  pngPath: string | null;
  raw: string;
}

export interface ArtifactHashes {
  source: string;
  pdf: string;
  career: string;
}
export interface ManualApproval {
  hashes: ArtifactHashes;
  at: string;
}

export interface TailorResult {
  /** Missing on legacy records; explicit revalidation is required before approval. */
  validationMethod?: "controlled" | "cli";
  candidateHash?: string;
  repairCount?: number;
  verification?: {
    report: boolean;
    evidence: boolean;
    visual: boolean;
    readingOrder: boolean;
  };
  evidenceValidation?: "passed";
  hashes?: ArtifactHashes;
  manualApproval?: ManualApproval;
  contentDiff?: { added: string[]; removed: string[] };
  slug: string;
  texPath: string; // source/tailored/<slug>/resume.tex
  pdfPath: string | null;
  pngUrl: string | null; // /api/files?path=ui/.cache/png/tailored-<slug>.png
  build: BuildResult;
  mastersUnchanged: boolean;
  deniedToolCalls: string[];
  /** Factual-accuracy check: each change verified in the tailored .tex and in career.md. */
  changes: {
    requirementId: string;
    after: string;
    careerQuote: string;
    afterVerified: boolean;
    careerVerified: boolean;
  }[];
  estimate: Estimate | null;
  matchAssessment?: {
    score: number;
    summary: string;
    sourceHash: string;
    pdfHash: string;
    model: string;
    at: string;
  };
  actualMatch: number | null; // Resume Match recomputed on the tailored resume
  meta: {
    originalAvailable?: boolean;
    briefAvailable?: boolean;
    model: string;
    durationMs: number;
    costUsdEstimate?: number;
    metrics?: AgentMetrics;
  };
}

export type JobErrorKind =
  | "auth"
  | "claude"
  | "guard"
  | "build"
  | "master-changed"
  | "cancelled"
  | "timeout"
  | "dependency"
  | "verification"
  | "source-conflict";

export type JobEvent =
  | { type: "step"; text: string; at: number }
  | { type: "log"; text: string; at: number }
  | { type: "build"; result: BuildResult }
  | { type: "done"; ok: boolean; result: TailorResult }
  | { type: "error"; message: string; kind: JobErrorKind };

// ───────────── saved reviews (03-data-layer.md) ─────────────

export type ReviewDecision = "applied" | "later" | "skip" | "undecided";

/** Summary of one saved review in records/reviews/ (for duplicate checks and links). */
export interface SavedReviewSummary {
  /** null = unopened; absent on legacy records, treated as viewed. */
  viewedAt?: string | null;
  persistenceWarning?: string;
  sourceRecordId?: string;
  kind: "review" | "quick";
  /** runId for reviews, quick id for quick adds (opens the item from the history sidebar). */
  id: string;
  slug: string;
  jsonPath: string; // records/reviews/<slug>.json
  mdPath: string; // records/reviews/<slug>.md
  company: string;
  role: string;
  link: string;
  jobId: string;
  reviewedAt: string;
  savedAt: string;
  decision: ReviewDecision;
  fit: number | null; // null for quick adds
  match: number | null;
}

/** One line in the Apply page's history sidebar. */
export interface HistoryItem extends SavedReviewSummary {
  /** The matching application row's status if there is one, else the decision ("skipped", "not decided"). */
  status: string;
}

// ───────────── quick add (no review) ─────────────

/** What the quick-add model call extracts (validated by QuickSchema). */
export interface QuickExtract {
  company: string;
  role: string;
  location: string;
  workMode: "onsite" | "hybrid" | "remote" | "flexible" | "unknown";
  level: string;
  postedText: string; // verbatim posting-date text, else ""
  postedDate: string; // YYYY-MM-DD if stated, else ""
  jobId: string;
  suggestedResume: ResumeCategory;
}

/** POST /api/quick result: extracted, not written yet. */
export interface QuickResult {
  quickId: string;
  extract: QuickExtract;
  age: PostingAge;
  duplicates: DuplicateReport;
  lane: "tech" | "bridge";
  suggestedSlug: string;
}

/** One job found by the batch quick-add call (resume is always tech, so none is suggested). */
export interface QuickJob extends Omit<QuickExtract, "suggestedResume"> {
  job: number; // the entered job's number (1-based), as titled in the prompt
  link: string; // a job URL inside this job's description, else ""
  source?: string; // legacy optional field; source is now selected manually
  jobBrief: import("./jobBrief").JobBrief;
}

/** POST /api/quick result: jobs logged with informational duplicate matches, or left for retry. */
export interface QuickBatchResult {
  added: {
    job: number; // the entered job's number (1-based)
    company: string;
    role: string;
    source: string;
    action: "inserted" | "updated";
    undoId: string;
    quickId: string; // opens the saved quick add (e.g. to attach extras)
    note?: string; // e.g. a similar earlier application worth a glance
    /** Fields the post did not state (company is "Unknown"; a missing role became the default title). */
    missing?: ("company" | "role")[];
    duplicates?: DuplicateReport;
  }[];
  skipped: { job: number; company: string; role: string; reason: string }[];
  /** Job numbers left after an incomplete extraction or write. The UI keeps them listed. */
  remaining: number[];
  error?: string; // processing stopped; a failed write may already have a tracker row
}

// ───────────── application extras (questions + cover letter) ─────────────

/** One open-ended application question with paste-ready answer options. */
export interface QuestionAnswer {
  question: string;
  options: string[];
  needsUser: string; // what the workspace owner must fill in himself, else ""
}

export interface QuestionsResult {
  company: { name: string; whatTheyDo: string };
  answers: QuestionAnswer[];
}

export interface CoverLetterResult {
  letter: string;
  namedFacts: string[]; // roles/projects/skills the letter names, for the workspace owner to check
}

/** Extras saved with a review or quick add. Question sets append; the latest letter replaces the last. */
export interface ApplicationExtras {
  questions?: {
    at: string;
    model: string;
    generation?: { effort: string; contextMode: string; durationMs: number };
    input: string;
    note?: string; // the workspace owner's steering note for this request, when he gave one
    result: QuestionsResult;
  }[];
  coverLetter?: {
    at: string;
    model: string;
    generation?: { effort: string; contextMode: string; durationMs: number };
    resume: string; // resume the letter was written from, e.g. "tech" or "tailored/<slug>"
    note?: string;
    result: CoverLetterResult;
  };
}

/** A quick add kept in records/reviews/<slug>.json. */
export interface QuickRecord {
  version: 2;
  kind: "quick";
  id: string;
  savedAt: string;
  reviewedAt: string;
  request: {
    jobBrief?: import("./jobBrief").JobBrief;
    jobPost: string;
    originalJobPost?: string;
    link?: string;
    source?: string;
  };
  originalJobPost?: string;
  postFormat?: "brief"; // absent on legacy records with the original post
  extract: QuickExtract;
  age: PostingAge;
  decision: ReviewDecision;
  resume: string;
  slug?: string;
  extras?: ApplicationExtras;
}

// ───────────── background review job (GET /api/score/status) ─────────────

export interface ReviewJobStatus {
  viewedAt?: string | null;
  sourceRecordId?: string;
  company?: string;
  role?: string;
  running: boolean;
  runId: string | null;
  status:
    | "idle"
    | "queued"
    | "paused"
    | "interrupted"
    | "running"
    | "done"
    | "error"
    | "cancelled";
  step: string | null;
  elapsedMs: number;
  startedAt: number | null;
  finishedAt?: number | null;
  preview: string; // first words of the post, for the in-progress line
  error?: string;
}

// ───────────── health, docs, errors (05-api.md) ─────────────

export interface Health {
  sdk: { ok: boolean; version?: string; error?: string };
  auth: {
    source: "plan-login" | "oauth-token" | "none";
    ok: boolean;
    checkedAt: string;
    error?: string;
  };
  apiKeyInShell: boolean; // ANTHROPIC_API_KEY present in the parent env (ignored, but warned about)
  /** ChatGPT-plan provider (Codex SDK). Optional for the UI: problems warn without failing health. */
  codex: {
    credentialDirectory?: string;
    sdk: { ok: boolean; version?: string; error?: string };
    auth: {
      source: "chatgpt-login" | "api-key-login" | "none";
      ok: boolean;
      error?: string;
    };
    apiKeyInShell: boolean; // OPENAI_API_KEY / CODEX_API_KEY present (ignored, but warned about)
  };
  careerRoot: string;
  applicationsReadOnly: ReadOnlyState;
}

export interface DocsTreeNode {
  name: string;
  path: string; // relative to CAREER_ROOT
  children?: DocsTreeNode[];
}

export type ApiErrorCode =
  | "SAVE_FAILED"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "LOCKED"
  | "CLAUDE_UNAVAILABLE"
  | "TIMEOUT"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}
