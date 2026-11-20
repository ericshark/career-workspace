import { readPreferences } from "./preferences";
import { effectiveContextMode, jobContext } from "./jobContext";
// Generate and save application extras for one saved review or quick add (POST /api/extras).
import { NotFoundError, ValidationError } from "./applications";
import {
  answerQuestions,
  coverReviewContext,
  fixtureCover,
  fixtureQuestions,
  questionsReviewContext,
  writeCoverLetter,
} from "./claude/extras";
import { loadCoverInputs, loadQuestionsInputs } from "./claude/inputs";
import { RESUMES } from "./config";
import { AgentError } from "./claude/agent";
import { findSaved, saveQuick, saveReview } from "./reviews";
import { loadRun, updateRun } from "./runs";
import { isValidSlug } from "./slug";
import type {
  ApplicationExtras,
  ModelId,
  QuickRecord,
  ScoreResult,
} from "./types";

export interface ExtrasRequest {
  target: { kind: "review" | "quick"; id: string };
  /** One string per question box (a single string is the older free-text form). */
  questions?: string | string[];
  coverLetter?: boolean;
  /** the workspace owner's note steering style and what to mention; applies to both answers and the letter. */
  note?: string;
  /** Resume being sent: a master category or tailored/<slug>. Reviews only; quick adds use their own. */
  resume?: string;
  model: ModelId;
}

interface Target {
  contextMode: string;
  jobPost: string;
  /** Company and role as extracted from the post. */
  companyAndRole: string;
  resume: string;
  review?: ScoreResult;
  save: (extras: ApplicationExtras) => void;
}

/** The .tex file of a resume key ("tech" or "tailored/<slug>"), refusing anything else. */
export function resumeTexPath(resume: string): string {
  if ((RESUMES as readonly string[]).includes(resume))
    return `source/${resume}/resume.tex`;
  const slug = /^tailored\/(.+)$/.exec(resume)?.[1];
  if (slug && isValidSlug(slug)) return `source/tailored/${slug}/resume.tex`;
  throw new ValidationError(`Unknown resume ${resume}`);
}

function loadTarget(req: ExtrasRequest): Target {
  if (req.target.kind === "review") {
    const run = loadRun(req.target.id);
    if (!run) throw new NotFoundError("Unknown review");
    const runId = run.result.runId;
    return {
      jobPost: jobContext(run.request, run.request.postFormat),
      contextMode: effectiveContextMode(run.request, run.request.postFormat),
      companyAndRole: `${run.result.company}\n${run.result.role}`,
      resume: req.resume ?? run.result.resume,
      review: run.result,
      save: (extras) => {
        const rec = updateRun(runId, (r) => {
          r.extras = extras;
        });
        if (rec) saveReview(rec);
      },
    };
  }
  const saved = findSaved(req.target.id);
  if (!saved || saved.summary.kind !== "quick")
    throw new NotFoundError("Unknown quick add");
  const record = saved.record as QuickRecord;
  return {
    jobPost: jobContext(record.request, record.postFormat),
    contextMode: effectiveContextMode(record.request, record.postFormat),
    companyAndRole: `${record.extract.company}\n${record.extract.role}`,
    resume: record.resume,
    save: (extras) => {
      const fresh = findSaved(req.target.id)?.record as QuickRecord | undefined;
      saveQuick({ ...(fresh ?? record), extras });
    },
  };
}

function currentExtras(req: ExtrasRequest): ApplicationExtras {
  if (req.target.kind === "review") return loadRun(req.target.id)?.extras ?? {};
  const saved = findSaved(req.target.id);
  return (saved?.record as QuickRecord | undefined)?.extras ?? {};
}

/**
 * Run the requested extras (in parallel when both are asked for) and save them with the record.
 * Question sets append; a new letter replaces the previous one.
 */
export async function generateExtras(
  req: ExtrasRequest,
  signal?: AbortSignal,
  fixtures = process.env.UI_FIXTURES === "1",
): Promise<ApplicationExtras> {
  const questions = Array.isArray(req.questions)
    ? req.questions.map((q) => q.trim()).filter(Boolean)
    : req.questions?.trim();
  if (!questions?.length && !req.coverLetter)
    throw new ValidationError("Paste questions or ask for a cover letter");
  const started = Date.now();
  const prefs = readPreferences();
  const target = loadTarget(req);
  const questionInputs = questions?.length ? loadQuestionsInputs() : null;
  const coverInputs = req.coverLetter
    ? loadCoverInputs(resumeTexPath(target.resume))
    : null;
  const note = req.note?.trim() || undefined;
  const at = new Date().toISOString();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const tasks = [
    questionInputs && questions?.length
      ? fixtures
        ? fixtureQuestions(questions)
        : answerQuestions(
            questionInputs,
            target.jobPost,
            questions,
            req.model,
            target.review && questionsReviewContext(target.review),
            controller.signal,
            note,
          )
      : null,
    coverInputs
      ? fixtures
        ? fixtureCover()
        : writeCoverLetter(
            coverInputs,
            target.jobPost,
            req.model,
            target.review && coverReviewContext(target.review),
            controller.signal,
            target.companyAndRole,
            note,
          )
      : null,
  ] as const;
  const [answers, letter] = await Promise.all(tasks)
    .catch(async (error) => {
      // A failed branch must stop its sibling and finish SDK cleanup before the response ends.
      controller.abort();
      await Promise.allSettled(tasks);
      throw error;
    })
    .finally(() => signal?.removeEventListener("abort", forwardAbort));
  if (signal?.aborted) throw new AgentError("Cancelled", "cancelled");
  // Re-read just before writing so a slow call never overwrites newer extras.
  const extras = { ...currentExtras(req) };
  if (answers && questions?.length)
    extras.questions = [
      ...(extras.questions ?? []),
      {
        at,
        model: req.model,
        generation: {
          effort:
            prefs.operationEfforts[`extras:${req.model}`] ??
            prefs.efforts[req.model],
          contextMode: target.contextMode,
          durationMs: Date.now() - started,
        },
        input: Array.isArray(questions) ? questions.join("\n\n") : questions,
        ...(note ? { note } : {}),
        result: answers,
      },
    ];
  if (letter)
    extras.coverLetter = {
      at,
      model: req.model,
      generation: {
        effort:
          prefs.operationEfforts[`extras:${req.model}`] ??
          prefs.efforts[req.model],
        contextMode: target.contextMode,
        durationMs: Date.now() - started,
      },
      resume: target.resume,
      ...(note ? { note } : {}),
      result: letter,
    };
  target.save(extras);
  return extras;
}
