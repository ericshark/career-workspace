---
name: career-check
description: Run combined recruiting Inbox and Actions checks. Use for career check, career check quick, or career check dry run.
---

# Career Check

Use Career Check or Career Check Quick for routine manual runs. Daily includes
Inbox and Actions, and Quick handles recent recruiting activity without Gmail
label or tracker writes. Standalone Inbox and Actions are targeted maintenance
commands. The dashboard Last check uses the latest successful Daily or Quick
completion.

Read and reuse ../inbox-check/SKILL.md and ../actions-check/SKILL.md and their required references. No subagents or Opportunity Check. Run recruiting checks sequentially; do not overlap Daily/Quick with each other or with standalone Inbox/Actions processing. Execute sequentially with a shared verified run boundary and cached complete mail reads. Underlying safeguards and standalone defaults remain authoritative. Suppress their individual reports and collect verified results for one report below.

Follow the [shared run journal](references/run-journal.md) for every Daily or Quick invocation. The journal owns the lease, scan boundary, saved acknowledgment, and recovery step. Read the prior success timestamps before beginning.

## Daily — career check

For a fresh Daily, run Inbox with its incremental checkpoint, then Actions including all pending discoveries inside the run boundary and open-task reconciliation. Pass the same lease and startedAt to both stages. If Inbox is incomplete, retain verified partial progress, record failure, and stop before Actions. For a resumed run, follow the journal's step and original boundary. Successful publication commits Actions acknowledgment and the Daily mail success together, then runs No Response maintenance using the fresh evidence. A maintenance failure leaves the mail success intact and is retried by the next Daily.

## Dry Run — career check dry run

Simulate the entire Daily workflow using identical discovery windows. No Gmail writes, status writes, imports, sync, finalization, acknowledgments or checkpoint changes. Keep Inbox discoveries and proposed label/status changes in memory; merge discoveries by message ID with persisted pending discoveries, replacing corrected classifications without changing immutable provenance. Feed this simulated handoff into Actions reconciliation, including standalone discovery and existing open tasks. Use `scripts/apps.sh actions preview --input FILE` with the normal sync schema to project action merges without persistence or Tracker cleanup. For later batches, include snapshot:<entire previous preview result> alongside fileHash:<original persisted hash> in the preview input. The shared merge uses that projected snapshot and rejects a changed persisted base. Never use the projected snapshot for a real sync. This carries proposed identities, retirements and terminal state across batches without saving them. Do not claim simulated status/label changes are saved. Delete temporary input files. Report proposed changes and “No changes saved.” Missing evidence still makes the preview Partial.

## Quick — career check quick

Use the journal's startedAt and call `scripts/apps.sh mail quick-window --input FILE` with {startedAt:ISO}. Use its query and [lowerBound,upperBound) receipt window: latest successful combined Daily or Quick scan START minus one hour through this run start. Completion timestamps are display-only. If neither exists, use the existing Inbox first-run policy of two days and briefly disclose the limited initial coverage. Failed or standalone checks are not successful combined Daily boundaries. Invalid/future state is a blocker, never a reason to silently reset the window. Search all mail, including Spam and archived mail, excluding Trash/Drafts, without keyword or label gates. Exhaust pagination and recover truncated context as usual.

Use Inbox classification read-only. Do not save discoveries, interactions, labels, statuses or mail checkpoints. Read all action identities for deduplication, including terminal tasks/tombstones, but reconcile only requests discovered within that window and tasks directly affected by those messages. Read older context only as necessary for identity/evidence. Skip historical backfill, unrelated pending discoveries and unrelated task reconciliation. Apply Actions Check's application matching and public-link lookup only to new or directly affected cards; do not research unrelated tasks.

Persist verified affected actions through normal action sync with `scope:"quick"` and `--lease LEASE_ID`; this skips unrelated Tracker cleanup. Partial batches cannot retire tasks. Explicit retirement requires complete affected evidence and complete:true, never inferred completion. Run `recruiting refresh --json --lease LEASE_ID`, then publish with `mail publish` using `{leaseId, fileHash, changes}` from a fresh `actions list` (see Actions Check → Publish). Quick never sends `acknowledge`. Quick indicators accumulate alongside Daily indicators and preserve Daily pending state. On failure retain verified task progress. The service recovers pendingQuickKind activity even outside the next overlap. Publish empty successful scans too. Report the actual scan window in New York time, including when it extends into an earlier day.

Routine account mail follows the [routine account mail rule](../actions-check/references/recruiting-evidence.md#routine-account-mail) in every mode; it is never a clarification item.

## Unified report

Use this compact format in every mode:

```text
Career Check — Daily / Quick / Dry Run

Last Daily check: <elapsed> ago — <Month day, time ET>
Last Quick check: <elapsed> ago — <Month day, time ET>

Emails checked: N
Changes: N label corrections · N application status updates
New actions: N
New updates: N
New rejections: N

Needs clarification:
- Company — Specific uncertainty and the question the workspace owner needs to answer
```

Daily and Dry Run show emails checked, label and status changes, and new rejections. All modes always show separate New actions and New updates counts, including zero. New actions counts tasks first created in this run; Daily does not count again a task a Quick check already reported. New updates counts meaningful recruiting changes, including appointment confirmations, material task changes and No response closures; a time the workspace owner proposed, his sent replies and employer receipts are never updates. For successful Daily and Quick, use the persisted summary from mail.lastCareerCheck or actions.lastQuickCheck. For Dry Run, use the `summary` returned by the final recruiting preview. Quick omits the label/status changes and rejection lines and does not perform rejection counting/matching solely for its report. Still process a closure when needed to reconcile a directly affected action. For Daily and Dry Run, collapse an all-zero label/status changes line to “Changes: None”; otherwise omit zero-valued categories from that line. Do not add a combined total across categories: one message can cause several different changes. Do not list routine changes, new/updated action details, rejection companies, completion suggestions or next-action advice. Those details belong on Actions and Tracker. Include Needs clarification only for unresolved matters requiring the workspace owner's input; omit it when empty. Routine administrative mail is not a clarification item.

Emails checked counts unique incoming messages reviewed inside discovery windows, excluding repeated/context-only reads. Count distinct changed messages for label corrections (including Spam rescues and stars), applications for status updates, and distinct new tasks and verified activity for the recruiting counts. A request alone counts once as a new action. Changes counts reflect real saved field changes; generic reminders and metadata edits still do not create New/Updated activity indicators.

New rejections counts distinct applications (Rejected or Unsuccessful) with newly established rejection/closure evidence, not rejection messages or label corrections. Deduplicate reminders and overlap against prior discoveries and recorded application status; do not count an already-known rejection again. Dry Run uses the same comparison against existing state. If an application identity or whether the rejection is new cannot be established, exclude it from the confirmed count and ask for clarification only when the workspace owner's input is needed. Never invent precision when failed reads prevent a reliable count; label that count incomplete or unavailable.

Daily/Quick report verified persisted changes. Dry Run uses “Proposed changes”, “Proposed new actions”, “Proposed updates”, and “New rejections found” and adds “No changes saved.” Do not print a routine Complete status line. Always append “Status: Partial” or “Status: Failed” and a short blocker when required processing did not succeed, even when no user clarification can resolve it. Complete means all required work for the selected mode succeeded; uncertainties are valid review outcomes, whereas failed reads/writes are incomplete. Mention checkpoints only when needed to explain a failure or coverage limit.

## Previous check times

Before starting any work, capture both `scripts/apps.sh actions list --json` and `scripts/apps.sh mail list --json`. Every report, including Dry Run and failed attempts, shows both previous successful check times from that pre-run snapshot: mail.lastCareerCheck.completedAt for the combined Daily check and actions.lastQuickCheck.completedAt for Quick. Standalone Actions finalization, an Inbox-only success, or an acknowledgment failure must not appear as a successful Daily check. Do not backfill this timestamp from legacy independent checkpoints. These are successful completions, not failed attempts or the current run. Never derive check time from task updates, file modification time or scan bounds. If absent, say “Not recorded yet”; older Quick checks cannot be reconstructed. Preserve lastQuickCheck when Daily clears Quick indicators.

Compute elapsed time against this run's captured start, and render both absolute times in America/New_York with the applicable EST/EDT suffix. Use brief natural wording: “12 hours ago — October 21, 3 p.m. EDT” or “1½ days ago — October 21, 3 p.m. EDT”; under a minute is “just now”. Invalid/future saved times are unavailable, never negative elapsed times. Dry Run never records a timestamp; incomplete Quick does not replace its previous success. Re-read saved state before claiming the current check was successfully recorded.

## Recruiting lifecycle integration

Reuse the connected lifecycle contracts in Inbox Check and Actions Check. New checks capture prospective events only; no historical timeline/email backfill. Use requireMatch:true for new request sync/preview batches. Uncertain application identity becomes durable Needs matching work, valid as a review outcome, rather than an unlinked actionable card. Research remains on demand in the desktop agent; Career Check never runs Opportunity Check.

Daily refreshes recruiting state with the active lease after verified changes and before publication. Quick may record meaningful information and task history for directly affected messages, including confirmed workflow closure, but must not change tracker status or Gmail. Store explicit rejection events for affected applications; Daily later reconciles formal tracker status. Quick retains its existing discovery/checkpoint limits. Dry Run uses `recruiting preview --input FILE` with the current recruiting `fileHash` (from `recruiting list --json`) and projected actions only; never refresh/sync/resolve recruiting or change stored state. Pass the final chained Actions preview result as `actionSnapshot`. The preview projects new or changed activity and follow-up updates without writing files and returns the report `summary`. Include pending matches from both previews, retaining ordinary classification and incomplete-read safeguards. The compact combined report format stays unchanged; details belong in the UI.

Waiting reminders, No response closure and appointment completion follow [Waiting and closure](../actions-check/references/recruiting-evidence.md#waiting-and-closure).
