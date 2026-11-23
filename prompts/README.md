# Model prompts and workflows

Edit the files here to change what the UI's model calls are told. The server reads them from `CAREER_ROOT/prompts/` on every call and sends their text; there is no other runtime copy. Code lives in [ui/src/lib/claude](../ui/src/lib/claude/).

## What to edit

| Change                                 | Where                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Quick Add extraction                   | [quick-add.md](quick-add.md)                                                            |
| Saved job-brief instructions           | Inline in quick-add.md **and** review-job.md (keep identical; a test checks)            |
| Workshop task suggestions              | [workshop-tasks.md](workshop-tasks.md)                                                  |
| Application-question answers           | [answer-questions.md](answer-questions.md)                                              |
| Cover letters                          | [cover-letter.md](cover-letter.md)                                                      |
| Review follow-up answers               | [review-followup.md](review-followup.md)                                                |
| Fit/Match judgment and recommendations | [review-job.md](review-job.md)                                                          |
| Resume tailoring and evidence rules    | [tailor-resume.md](tailor-resume.md)                                                    |
| Which facts a call receives            | [inputs.ts](../ui/src/lib/claude/inputs.ts) and each workflow's prompt builder          |
| Models and defaults                    | [config.ts](../ui/src/lib/config.ts)                                                    |
| JSON response contracts                | [schemas.ts](../ui/src/lib/claude/schemas.ts), [jobBrief.ts](../ui/src/lib/jobBrief.ts) |
| SDK settings and metrics               | [agent.ts](../ui/src/lib/claude/agent.ts)                                               |

**Template rules:** quick-add.md has `## System prompt` and `## User prompt` sections (headings aren't sent; keep them). Code fills `{{jobCount}}`, `{{plural}}` and `{{unknownCompany}}` once, then appends job data; pasted content is never treated as a template. review-job.md keeps its system rules above `## Job brief`, whose text goes into the user prompt. workshop-tasks.md has `## System prompt`, `## Use my list` (Tidy tasks in the UI) and `## Plan it` (Expand) sections; the chosen mode's section is prepended to the project, existing tasks and note, which are sent as data. Other files are sent whole as the system prompt. Editing Markdown can't add evidence the input code doesn't supply.

## Career record coverage

Review, review follow-ups, application answers, and cover letters retain Professional Identity, Target Roles, Role-specific positioning, Current Status, skill levels, AI-Assisted Software Development, Creative Frontend & Design Interests, the Career & Interview Story Bank, and Freelance / Independent Work. These sections are included by the existing heading-based filters; new factual sections are retained by default. Tailor receives the full record. Interests and positioning guide emphasis, not proof of implementation; story-bank wording is background to adapt under each prompt’s style rules. Freelance work must retain its recorded scope and unresolved payment/date details. Quick Add does not use the career record.

## Calls and limits

| Operation    | Default model       | Queries                     | Max turns | Other limits                               |
| ------------ | ------------------- | --------------------------- | --------- | ------------------------------------------ |
| Quick Add    | provider fast model | One per extraction group    | 3         | 120 s abort timer per group                |
| Questions    | `gpt-6.1-terra`     | One per job                 | 3         | Route maxDuration 180 s                    |
| Cover letter | `gpt-6.1-terra`     | One, plus at most one retry | 3         | Route maxDuration 180 s                    |
| Follow-up    | `gpt-6.1-terra`     | One per question            | 3         | Route maxDuration 120 s                    |
| Review       | `gpt-6.1-terra`     | One per job                 | 6         | 120 s abort timer; route maxDuration 180 s |
| Tailor | `gpt-6.1-terra` | One agent query | 20 | 6-minute abort timer; at most 3 candidate submissions |

Quick Add uses the selected provider's fast model: `gpt-6-luna` on the default ChatGPT provider, `claude-haiku-5-5` on Claude.

Review, Tailor, and Extras (questions + letter; also used for review follow-ups) each have a model setting in the UI; Haiku is selectable. Quick Add always uses the selected provider's fast model (Haiku or Luna). ChatGPT offers Sol, Terra, and Luna; workspace preferences remember each provider's operation models independently, with Terra selected initially and the same task prompts and guards; see [ChatGPT provider](../ui/docs/02-claude-integration.md#chatgpt-provider).

Every call is a fresh SDK query with `settingSources: []`, a custom system prompt, no built-in tools, `permissionMode: "dontAsk"`, and `persistSession: false`: no CLAUDE.md, skills, or earlier chats are loaded. Output comes back as structured JSON; only Tailor gets an extra tool. The child environment is scrubbed. No secrets belong in prompt files.

## Quick Add

- **Route:** Apply → Quick add → `POST /api/quick` → [quick.ts](../ui/src/lib/quick.ts).
- **Sends:** quick-add.md, then numbered job blocks (pasted description + optional URL). No career record or resume. 1–50 cards, 25–50,000 characters each, 250,000 total. Each query takes up to four cards and 20,000 characters of job text and links. A longer individual card is sent on its own.
- **Returns:** tracker facts and a job brief per card. Code resolves links and sources, warns about possible duplicates without blocking, and logs pasted jobs as applied today with the tech master (Fit/Match blank). Each write has Undo.
- **Saves:** rows in `records/applications.md`; JSON with the original description and brief; Markdown with the brief in `records/reviews/`.

## Questions and cover letter (Extras)

- **Route:** [ExtrasPanel.tsx](../ui/src/components/ExtrasPanel.tsx) → `POST /api/extras` → [claude/extras.ts](../ui/src/lib/claude/extras.ts). Questions and letter run as separate queries, in parallel when both are asked for.
- **Both send:** a trimmed `career.md` (no Contact, Example bullets, or Summary Statements) and the saved job description. Reviewed jobs add company, role, and up to 8 required work items. An optional note from the workspace owner (style, emphasis, things to mention) goes after the job post in both; it is saved with the results, and numbers in it count as evidence for the letter's number check.
- **Questions:** answer-questions.md as system prompt; up to 30 open-ended questions (tell me about yourself, why us, why this role, experience). the workspace owner answers short logistics fields (salary, authorization, start date) himself. Returns exactly 3 ranked variants per question, with placeholders and a `needsUser` note instead of invented details. Answer sets append to the saved job.
- **Cover letter:** cover-letter.md as system prompt, plus the selected master or tailored resume text. Returns one plain-text letter and the facts it names (usually 200–300 words unless a field limit says otherwise). Numbers not found in career or resume evidence (or the job's company and role) trigger one retry, then rejection. The newest letter replaces the old one. The `source/*/cover-letter.tex` files are not read.

## Review

- **Route:** `POST /api/score` (duplicates are informational warnings with links to compare the saved postings) → [score.ts](../ui/src/lib/claude/score.ts) runs in the background; leaving the page doesn't cancel it.
- **Sends:** review-job.md; `career.md` without Contact, Example bullets, or Summary Statements; the selected master (tech, general, or datacenter) as readable text; the job post (200–50,000 characters).
- **Returns:** job facts, Fit and Match scores with summaries, requirements with evidence quotes, recommendation, changes, gaps, keywords, and a job brief. Code derives labels and verdicts, checks keywords against the resume text, and computes posting age and duplicates. Quotes are informational and never change a score.
- **Fit** compares career evidence with the job; **Match** compares only the selected resume. Location and eligibility are the workspace owner's to filter and don't affect scores.
- **Bands (code):** Fit 80–100 Strong → **Apply** · 60–79 Reasonable → **Apply** · 45–59 Possible fit → **Optional**; below 45 Weak → **Skip**. Match 80+ Strong · 60–79 Moderate · below 60 Weak. Posting age 0–3 days Fresh · 4–7 Recent · 8–30 Older · over 30 Stale.
- **Saves:** working runs in `ui/.cache/runs`; JSON/Markdown with source hashes and metrics in `records/reviews/`. A review alone doesn't log an application or edit a resume.

## Review follow-ups

- **Route:** Apply → Review → **Ask about this review** → `POST /api/followup` → [claude/followup.ts](../ui/src/lib/claude/followup.ts).
- **Sends:** review-followup.md as system prompt; the review's career view of `career.md`; the scored master as readable text; the review's scores, verdict, recommendation, requirements, gaps, changes and blockers; the job post; up to 6 earlier turns from the page; the question.
- **Returns:** one plain answer. Nothing is saved; the thread lives on the page.

## Tailor

- **Route:** from a saved review, `POST /api/tailor`. [brief.ts](../ui/src/lib/brief.ts) builds the brief; [tailor.ts](../ui/src/lib/claude/tailor.ts) runs the loop, verification, and publishing.
- **Recommendation:** Review returns **Use Master** or **Tailor**; there's one Tailor action (old Light Tailor / Don't Tailor labels display as Tailor / Use Master; the CLI's `--mode` flag is ignored).
- **Sends:** tailor-resume.md; full `career.md`; the master's TeX and path; the current candidate hash; a compact brief (requirements on/under/off the resume, evidence quotes, missing terms, recommended changes); the saved job description. Score breakdowns are left out.
- **Scope (measured against the original master):** keep sections, template, employers, and dates; keep the project count and replace at most one project; change or remove at most half the bullets (minimum 1); add at most one net bullet. Reordering within a role is free.
- **Tool:** `mcp__resume__submit_candidate` submits exact replacements plus evidence; code applies them and builds in scratch space, returning a hash, diagnostics, extracted text, and a PNG for repair.
- **Publishing:** the final assessment is tied to the candidate hash. Code requires complete evidence, an unchanged master, and build, one-page, ATS, and render success, then saves the source, PDF, and PNG. The validated copy is selected automatically; the UI shows the diff, quotes, and preview so you can switch back. Submission rechecks hashes.
- **Old reviews:** saved hashes stay valid while the prompt bytes are unchanged; changed prompts require a new review. Archived files are never used as a fallback.

## Manual work and checks

Use the UI for reviews, decisions, and tailoring. `scripts/apps.sh` (run without arguments for usage) covers tracker, schema, score, brief, and tailored-validation commands; `scripts/build.sh` builds resumes. Follow [CLAUDE.md](../CLAUDE.md) for resume and logging rules.

`scripts/verify.sh` runs offline checks, a production build, and browser workflows on disposable data. Fixture runs prove orchestration, not answer quality. Live model calls need the workspace owner's explicit authorization. See [testing](../ui/docs/09-testing.md) and [Claude integration](../ui/docs/02-claude-integration.md).

Model choices, per-operation effort, full/brief saved job context, queue behavior, and application-day defaults are documented in [the current Apply workflow](../ui/docs/04-screens.md#apply-workflow-update-2026-10-29). Initial reviews use the original paste; new saved records preserve both representations.

Application-answer style emphasizes direct answers and relevant factual examples adapted from the current career record, with the workspace owner's action and significance explained in natural language. Guidance reference: [Harvard MCS: AI for Resumes and Cover Letters](https://careerservices.fas.harvard.edu/ai-resumes-and-cover-letters/). Offline fixtures validate inputs and orchestration, not the quality of live generated writing.
