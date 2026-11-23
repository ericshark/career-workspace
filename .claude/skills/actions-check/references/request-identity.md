# Request identity, deadline and evidence safeguards

This reference supports Actions Check only. Inbox Check owns application statuses (Actions Check's one exception is closing same-role duplicate rows); neither reconciliation nor discovery writes new Tracker Next text.

## Match the specific ask

Persist assessments, scheduling, replies, finish-application requests and concrete user decisions, holding unmatched actionable mail in Needs matching until its application is confirmed. Exclude receipts, rejections, informational messages and administrative counts unless they independently require action. Apply the [routine account mail rule](recruiting-evidence.md#routine-account-mail).

Compare all saved identities, including completed tasks and dismissed tombstones. A reminder or the same ask in another thread keeps the original externalKey and requesting email. Attach newer meaningful evidence through activity or completionSuggestion. Separate asks in one conversation get separate keys; a genuinely new stage gets a new key. Match employer, role, application and request content, not merely a similar subject or recruiter name. An agency's contact organization is not necessarily the hiring employer.

Application references use rowKey and optional recordId. Use a unique exact posting/ID or unambiguous employer+role match; company-only matching requires one uniquely identified application and no role in the mail. Never guess associations for placeholder companies. New uncertain requests retain reviewReason in the pending queue; use requireMatch:true and do not create an actionable card before confirmation. An imported tracker task can acquire email provenance only when its application and exact nonempty expectedNext match. Reconciliation preserves that original expectedNext for guarded completion cleanup, even if Tracker now contains a different task.

### Avoid false unmatched requests

The duplicate checker compares normalized full company names; arbitrary taglines are not removed. A zero-result query for a shortened agency name must trigger tracker-wide candidate recovery and saved-posting review, rather than a claim that no application exists. Check all statuses; corroborate aliases with sender domain/signature and organization facts. Candidate recovery is evidence gathering, not permission to match generic shared words.

A unique recorded agency + matching role + closely corresponding posting responsibilities can establish the application without an end-client name or requisition ID. Treat location and engagement wording as context to retain, not mandatory identity fields. Escalate explicit different requisitions/clients, materially different roles, competing tracker entries, or insufficient organization evidence.

Regression cases for scan review:

- **Agency alias:** `Northbeam` recruiter at `northbeam-talent.example`, Software Development Engineer, distributed systems across UI/APIs/data, testing and AI-assisted tools; one saved `Northbeam Talent, LLC - Hiring Partners` application with the same role and responsibilities, plus earlier Northbeam screening correspondence. Match that existing application. Remote/contract versus New York/contract-to-hire is worth noting, but missing client/ID does not make this unmatched. A new resume/availability ask remains a new task; do not reopen the completed AI screening.
- **Ambiguous agency:** two credible same-agency/role applications with different client/requisition identities and no distinguishing email evidence. Keep pending; do not choose the active or newest one merely for convenience.
- **Explicit separate opportunity:** a known agency names a different requisition/client or says this is another role. Do not attach it solely because there is only one existing agency application.

## Verify full evidence

Review every open task's full source thread, incoming and Sent. Follow pagination or read omitted messages individually. Reuse complete reads already obtained in this run. Search narrowly for relevant cross-thread replies. For legacy/unlinked tasks, require an unambiguous employer + role/request match before attaching provenance; otherwise retain the task and report its missing source.

A completion suggestion requires evidence that satisfies the whole ask:

- Sent replies must answer every requested item. A draft, acknowledgment or partial reply is insufficient.
- Assessment-submitted confirmation satisfies that assessment, not another stage.
- An accepted interview time may satisfy scheduling, not attendance or the interview itself.

Use stable evidence-message-plus-ask identities and verified evidence timestamps. Dismissed suggestions must stay dismissed across repeat imports. Clear a stale suggestion with explicit null only when verified evidence invalidates it. The user confirms completion in Actions; never retire as a shortcut.

Only explicit withdrawal, superseding content or confirmed application closure permits retirement. Include the evidence message ID. Do not infer resolution from elapsed deadlines, expiration, silence, a missing search result or In Progress status. Completed tasks remain completed.

## Preserve deadline meaning and precision

`email.receivedAt` is the original requesting message's Gmail internal_date (epoch milliseconds converted to ISO) or verified connector receipt instant. It is not import time, a reminder date or an unrelated Sent timestamp. Omit unavailable timestamps and report the limitation; do not invent precision.

A deadline has New York calendar date, original wording, optional offset-qualified at, and optional kind requested/expires. An explicit instant must fall on that New York date. Date-only deadlines remain date-only. A requested completion window does not imply expiration; preserve stated non-expiration in the explanation.

For "within N days of receipt", run:

```bash
scripts/apps.sh actions deadline --received-at <verified-ISO> --days N --wording '<original wording>' --kind requested
```

Receipt day is day zero. October 29, 2026 at 04:23:42Z plus five calendar days is November 3. Explicit hours/business days require their stated units/timezone; never pass those as calendar days. Ambiguous wording stays in review. An intentionally early reminder is not the sender's deadline.

## Recover without losing user edits

Use the fileHash from the snapshot used for reconciliation. Conflict means re-read and reconsider findings; do not blindly retry with a fresh hash. Partial runs persist verified upserts with no retirements and preserve checkpoints. Retirement retries against existing tombstones are idempotent. A failed atomic batch persists none of its task mutations; Tracker cleanup happens after durable task persistence and may separately warn.

Re-read after writes. Report pendingNextClear/syncWarning and retry cleanup through an empty sync with the current hash before successful finalization. Confirmed completion is durable even if cleanup fails; cleanup clears only the still-matching original Tracker Next, never newer text or status.

Finalization precedes successful handoff acknowledgment. Follow SKILL.md for run identity, activity publication and checkpoint ordering. Keep failed discoveries pending. If a command loses its response, inspect durable state before retrying; do not assume either success or failure. Dry runs invoke no mutation commands. Delete temporary JSON files.
