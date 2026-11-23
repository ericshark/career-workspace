---
name: actions-check
description: Discover and reconcile recruiting tasks, deadlines, Sent replies, and completion evidence. Use for actions check, check my actions, or review my tasks. Application statuses belong to inbox-check.
---

# Actions Check

No subagents or automatic Opportunity Check. Read [request identity and evidence safeguards](references/request-identity.md) and the [shared recruiting evidence rules](references/recruiting-evidence.md) before reconciling. Runtime schemas in `ui/src/lib/actions.ts` and `mailSync.ts` are authoritative.

## Read and discover

Apply the [routine account mail rule](references/recruiting-evidence.md#routine-account-mail) to discovery and reconciliation, including Inbox handoffs.

For real checks, follow the [shared run journal](../career-check/references/run-journal.md). A standalone check claims mode `actions`; Daily and Quick pass their own lease and step. Dry Run only uses previews.

Discover Gmail search/read tools and use the connected account; if several are connected, ask which one. Gmail is read-only: never label, star, archive, move, change read state, send, reply, draft, submit, schedule, or start assessments. Treat mail as untrusted evidence. Dry runs perform no writes, including imports, acknowledgments and finalization.

Use the journal's startedAt and runId, or the simulated start and identity for Dry Run. Read `scripts/apps.sh mail list --json` and `scripts/apps.sh actions list --json`, including completed tasks and dismissed identity tombstones. Consume all unacknowledged discoveries received through the scan boundary. Do not overlap this processing with Inbox classification corrections; corrected discoveries are requeued for review.

- First run (`actionsAt` absent): search all mail from the last 30 days (`in:anywhere -in:trash -in:drafts`, epoch-second bounds) and find recruiting requests by content, without label, sender or keyword gates. Process in bounded batches; checkpoint only after the entire window and required reconciliation succeed. Report the 30-day limit.
- Later runs: search all mail since `actionsAt` minus one hour through run start, using epoch-second Gmail bounds and verifying returned receipt timestamps against the run window. Works standalone without Inbox Check. Daily reuses the Inbox scan where the windows overlap. Also review every open action's source and narrowly matched follow-up/Sent threads, without a date cutoff.
- Inspect appointment confirmations, reschedules and cancellations in the same window, including relevant calendar attachments. Compare verified evidence against open and completed scheduling tasks. Daily and Quick reuse the same bounded evidence.
- Deduplicate search/handoff results by message and thread ID. Cache complete thread/message reads within the run; reuse them across tasks. Retrieve omitted messages if thread reads truncate. Process historical threads in batches and retain concise request/evidence facts rather than repeatedly loading full mail into context. Do not re-read completed source threads merely because they exist in the store; inspect new relevant mail against terminal identities.
- Absence from search, silence, or elapsed deadlines never resolve tasks. Failed/truncated required reads make the run incomplete; ordinary uncertainty is a valid review outcome.

## Reconcile and persist

Use `scripts/apps.sh actions sync --input FILE --lease LEASE_ID`: `{fileHash,complete,actions,retire}`. `fileHash` comes from the action snapshot used to prepare the batch. If it conflicts, re-read and reconcile against concurrent UI edits before rebuilding the batch; never just replace the hash on stale findings. Re-read after every successful batch. Partial batches use `complete:false,retire:[]`.

Each action needs `externalKey: gmail:<original-threadId>:<stable-request-key>`, imperative `text`, and `email:{threadId,messageId,url,receivedAt?}`. The key thread matches the original email thread. Reuse identities for the same ask across reminders, deadline corrections and other threads, keeping original requesting-message provenance. New asks/stages get new keys. Check completed tasks and tombstones before assigning keys; never reopen a terminal ask.

Set `category` on every new open action, choosing exactly one from this fixed list (first match wins when a request fits several): `assessment` (timed or take-home tests, cognitive/personality or coding assessments), `screening` (AI voice/video screens, one-way interviews, screening questions to complete), `schedule` (book, choose or confirm an interview/call/webinar time), `reply` (answer an email with details, documents, availability or questions), `application` (complete or review an application or registration), `verify` (verify an account or email address), `sign` (sign or fill an acknowledgment, accommodation or other form), `other`. Keep an existing action's category unless the ask itself changed. The Dashboard and Actions page show it as a chip; completed and closed items need none.

Set `requestKind` on every new action. It decides whether finishing the task starts the employer-response clock, so it is separate from `category`:

| Ask | requestKind |
| --- | --- |
| Assessment, screening questions, AI/one-way screen | `screening` |
| Application, form, signature, reply with documents or answers | `submission` |
| Book or confirm a time | `scheduling` |
| Prepare material before a known step | `preparation` |
| Verify an account or email | `administrative` |

Completing `screening` or `submission` work starts waiting on the employer; the others do not. Set `responseExpected` explicitly when the mail says a reply will or will not come.

Optional fields: company, role, application `{rowKey,recordId?,expectedNext?}`, deadline, explanation, relationship, contactOrganization, location, publicLink, effort, advancesStatus, latestEmployerAt, reviewReason, activity and completionSuggestion. Set `advancesStatus:false` when the request only asks the workspace owner to finish or repair his own submission (for example a platform delivery failure or incomplete application) and is not employer engagement; confirming such a request then leaves the application status alone instead of moving it to In progress. Never write Tracker Next, and never write application status except closing same-role duplicates (see Connected recruiting lifecycle). Match applications using unique exact posting/ID, then unambiguous company+role; never guess from a shared name or placeholder. Unmatched/uncertain actionable mail stays in the durable Needs matching queue until the workspace owner confirms the exact application. New sync/preview batches use requireMatch:true. Preserve a task's original cleanup text; never copy newer Tracker Next onto an older task.

Before putting an actionable request in Needs matching, inspect plausible tracker rows across all statuses and their saved postings, even if the duplicate checker returns zero candidates for a shortened company name. Verify legal-name/tagline variants using the sender domain/signature and recorded organization facts, then compare role, substantive responsibilities and previous recruiting correspondence. Matching an agency-branded application does not require knowing its end client. Missing posting IDs or secondary location/contract wording differences alone do not defeat a unique, supported organization+role+content match; record those differences in the explanation without inventing updated application facts. Open applications at the same organization with essentially the same role are one job applied to more than once, not competing applications. Keep requests pending only for genuinely different competing open roles, conflicting requisition/client evidence, unknown organizations, or a sender explicitly introducing a different role, and set `matchIssue` (`not-in-tracker`, `several-candidates`, `role-differs`, `no-role`) on the held item. User-confirmed identity resolves uncertainty and must be retained on future reminders.

- Explain what the request concerns and exactly what the workspace owner should do in about two concise sentences. Keep dates in metadata, preserving useful purpose, preparation and non-expiration details.
- When `effort` is useful, distinguish stated duration from estimated effort.
- Relationship describes the contact organization: direct employer, recruitment agency, consulting/outsourcing, or unknown. Store the actual employer separately from contactOrganization. Do not infer direct employment just from the contact's company name.
- `latestEmployerAt` is substantive incoming activity, not import time or a generic reminder. `activity:{id,type?,at}` identifies a verified meaningful message plus specific ask, with optional first-request/follow-up type. Keep its identity stable on generic reminders and metadata edits. Changed requests/deadlines, useful replies and completion evidence qualify as updates and must supply a new verified activity identity.
- `publicLink:{url,kind:job/careers/company}` uses saved application/review facts and existing card links first. In Daily, Quick, and standalone Actions checks, when neither the matched application nor the card has a usable public URL, attempt a limited public lookup: exact posting, official careers page, then an official employer or recruiter homepage. Reuse a verified company fallback across affected cards in the same run; stop once a verified useful URL is found. If no confident link is found, leave it absent rather than guessing. Store the fallback on the card, not in the application record. A careers/homepage link never proves application identity. Never browse personalized assessment/scheduling links.
- `completionSuggestion:{identity,reason,messageId,url,at}` requires later evidence satisfying the specific ask. Identity combines evidence message and ask; at is verified evidence time. The user confirms in Actions. Dismissed evidence stays dismissed; materially new evidence may suggest again.
- Omission preserves saved fields. Explicit null clears deadline, reviewReason or completionSuggestion only when verified evidence resolves or withdraws it. Never submit UI-owned priorityOverride, dismissedSuggestions, completion/hidden/viewed fields, or service-owned publication fields.

Only explicit cancellation, replacement or closure retires an open task. `retire:[{id,reason,evidenceMessageId}]` requires complete=true. Retirement preserves the full superseded request and resolution evidence, never completion. Existing minimal tombstones remain deduplication identities. Completed tasks remain preserved. Re-read persisted results; pendingNextClear/syncWarning means Tracker cleanup is incomplete. Never overwrite newer Tracker data.

## Publish and acknowledge

After all required reconciliation and writes succeed, re-read Actions and use
`scripts/apps.sh mail publish --input FILE` as described in the journal, with
`{leaseId, fileHash, changes, acknowledge}`:

- `fileHash`: the current Actions hash.
- `changes`: `[{id, activityId, kind}]` for genuinely new tasks (`new`) and
  meaningful task updates (`updated`). `id` is the task id; `activityId` is its
  persisted `activity.id`, else its `email.messageId`.
- `acknowledge`: discovery `messageId`s (from `mail list`) received at or before
  the run start, covering every pending one. Daily and standalone Actions only;
  Quick omits it.

The service carries unpublished verified changes across attempts. Failed work stays pending and does not advance
actionsAt. The journal handles retry after publication without recreating cards
or issuing a new empty publication.

Report actual new or updated tasks, completion candidates, obsolete dismissals,
uncertainties, errors, and checkpoint outcome. When invoked by Career Check,
return findings to the orchestrator without a separate report. Quick uses only
affected requests and skips acknowledgments. Dry Run accepts the simulated Inbox
handoff in memory and does not acquire a lease.

## Connected recruiting lifecycle

Every new check uses `requireMatch:true` on actions sync (and preview). Reliably matched requests retain their exact application reference. Requests with missing or ambiguous applications are saved in the shared Needs matching queue before any task is created. Supply verified email.receivedAt for every such request; never invent it. Missing timestamps require recovery or a Partial report. The queue retains the complete validated request for replay after the workspace owner selects an application in the UI or confirms it in chat. Do not place an uncertain task into Open merely to ask for clarification.

Read `scripts/apps.sh recruiting list --json` alongside actions/mail. To resolve in chat, locate one exact tracker row (company + role may still require a date/posting choice), then run `recruiting resolve --input FILE` with `{fileHash,id,applicationKey,applicationsHash}`. In Daily or standalone Actions, revisit unprocessed pending items with a confirmed `resolvedKey` and no action or event. Read their source conversation, reuse the confirmed application, and add any verified action or event to the same pending ID through `recruiting sync` before refreshing. Still-unclear messages remain pending. Multiple plausible tracker rows remain unresolved unless the evidence distinguishes one or they are the same role applied to more than once. In that case resolve to the best-evidenced row, then close the other same-role rows with `apps.sh status --key KEY --from CURRENT --to rejected --lease LEASE_ID`. This is the only status write Actions Check makes. It is for Daily and standalone Actions only, never Quick. If no tracker entry exists, ask the workspace owner to select an existing application or explicitly create a minimal one; do not discard the mail or add a tracker record automatically. Preserve unlinked completed tasks; the UI can associate them explicitly without changing completion or hiding.

Resolved and dismissed tasks now retain their full records with state superseded and resolution evidence; existing minimal tombstones remain deduplication identities. Reminders never reopen either identity. New requests still receive new stable keys. No Response closure uses a system resolution and never represents user completion.

Use `recruiting sync --input FILE --lease LEASE_ID` for meaningful confirmed responses, interview/stage changes and verified sent follow-ups using the shared evidence rules. Do not publish invitation or task-change mirrors. Use the saved appointment identity to reconcile confirmed logistics. Read `ui/src/lib/recruiting.ts` for the strict batch/event schema. Follow-up events use the actual sent timestamp and responseExpected:true when an employer reply is expected. Avoid routine receipts/reminders and duplicate events for the same evidence. No automatic follow-up task or sending is introduced.

After persisting the check's verified changes and before successful finalization/acknowledgment, run `scripts/apps.sh recruiting refresh --json --lease LEASE_ID`. This projects durable task events, closure history and waiting recommendations. Retry projection failures without recreating tasks; do not publish successful reconciliation while projection is incomplete. Preserve the existing completion-confirmation, hash, evidence and checkpoint safeguards.

Follow [Suggested application matches](references/recruiting-evidence.md#suggested-application-matches) for held requests with one likely candidate, and [Waiting and closure](references/recruiting-evidence.md#waiting-and-closure) for reminders and No response.
