# Gmail scan and recovery

The workflow uses discovered Gmail search and read tools; the local CLI stores evidence and checkpoints. Inspect current tool schemas before calls. Never call a tool that changes the mailbox, and use reads that preserve read state.

## Complete bounded discovery

- Parse `inboxAt` as an instant. Missing state uses run start minus two days; preserve this existing first-run policy and report the limited initial coverage. Invalid state is a failure, not permission to reset the window.
- Lower bound = checkpoint minus one hour (first run: run start minus two days). Use `after:floor(lowerBoundMilliseconds/1000)` and `before:ceil(startedAtMilliseconds/1000)`. Numeric epochs avoid Gmail calendar-date timezone interpretation. Filter verified receipt instants to the actual window; defer messages at/after run start to the next run. Read later messages returned as context without applying their developments prematurely.
- Use one broad query: `in:anywhere -in:trash -in:drafts after:LOWER before:UPPER`. No sender, keyword, unread, category or label gate. Follow `next_page_token` until exhausted; an estimate/count or a full page is not proof of completion. Detect repeated tokens. Save every returned message ID, deduplicate IDs, then group by thread. Empty results count as complete only after a successful exhaustive search.
- A newly arrived message in an old conversation must trigger a conversation read. Cache full reads within this run, not permanently by thread ID. Classify the latest meaningful incoming development at the run boundary, retaining earlier substantive asks when later mail is only administrative. Distinct applications/requests in one conversation require separate evidence; ambiguous mixed conversations get review, not blanket tracker changes.

For verification and portal emails, apply the [routine account mail rule](../../actions-check/references/recruiting-evidence.md#routine-account-mail) using the full message and verified conversation context.

## Full context with connector limits

- Current thread reads default to the most recent 20 messages, ordered oldest to newest within that returned subset. Batch reads accept at most 100 input IDs; later IDs are silently ignored. Chunk explicitly to at most 100, and check that every requested ID was returned. Reduce batches on response-size errors.
- Request a sufficient thread limit and inspect truncation/count metadata when supplied. All discovered message IDs must be represented in full reads. A capped response (including exactly the requested limit with no completeness proof) requires recovery: enumerate older candidates by subject/participants without the scan date cutoff, paginate, verify each candidate's thread ID, and individually read omitted IDs. Do not assume a Gmail `thread:<id>` query operator exists. If full context cannot be established, mark the run incomplete.
- Read MIME text bodies, not snippets alone, when they determine status, application identity, requested work, or authenticity. Use verified `internal_date` milliseconds/connector receipt time, never the sender Date header or import time as a substitute. Outgoing and drafts are context only.

## Local writes, retries and evidence

- Persist verified discoveries/interactions first with `complete:false`, then apply status changes. On retry inspect tracker status again; earlier persistence does not mean tracker synchronization finished. Preserve pending handoffs even if the next broad search is empty. A complete scan of the overlap repairs work interrupted before the checkpoint.
- For rate limits/timeouts use bounded retries (honor Retry-After when exposed); verify ambiguous local write responses by reading current state. Exhausted retries, missing search pages/messages, tracker write failures, and persistence failures keep `inboxAt` unchanged. Save verified partial findings when possible and report the incomplete run. A matching uncertainty is a review outcome, not a tool failure; save its provenance without changing the tracker.
- Only after all required work succeeds, submit `complete:true` using the original run start. Partial/explicit ranges that leave a gap use `complete:false`. No local service can prove external Gmail reads succeeded; setting complete is the executing agent's responsibility. Re-read the resulting store before claiming success. An empty successful run still advances its checkpoint.
