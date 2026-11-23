# Shared recruiting run journal

Use this contract for every real Daily, Quick, Inbox, or Actions Check, including
a standalone check. Dry Run only reads saved state and previews. It never begins,
renews, publishes, finishes, or fails a journal attempt.

1. Before accessing Gmail, call `scripts/apps.sh mail begin --input FILE` with
   `{"mode":"daily"}`, `quick`, `inbox`, or `actions`. Use the returned
   `leaseId`, `runId`, and `startedAt` for the entire attempt. Combined stages
   reuse Daily's lease. If another check holds the lease, report that check is
   running and stop. Never borrow another attempt's lease from the journal.
2. Follow the returned `step`. `inbox`, `actions`, and `quick` start or resume
   that stage. A resumed Daily at `actions` skips Inbox and reads all durable
   pending discoveries received by the original `startedAt`. Reconcile any
   unfinished Actions work against fresh snapshots. Defer new mail evidence
   beyond the saved boundary. `finish` means Actions is
   already published or only No Response maintenance remains. Call
   `mail finish --input FILE` with `{leaseId}` without rescanning Gmail or
   republishing Actions. Report when the resumed boundary predates this attempt,
   so the workspace owner knows later mail will be covered by the next fresh Daily.
3. The lease expires 15 minutes after the last renewal. Call
   `mail heartbeat --input FILE` with `{leaseId}` at least every five minutes
   during long discovery. Local guarded CLI writes renew the lease too. If renewal fails,
   stop writes and report the interruption. There is no background heartbeat.
4. Include `leaseId` on all Inbox `mail sync` batches. Supply
   `--lease LEASE_ID` to check-owned `status`, `actions sync`,
   `actions import-next`, and `recruiting sync|refresh` commands.
   Inbox's successful batch atomically records its checkpoint and hands Daily
   to Actions, or completes a standalone Inbox attempt.
5. After all required Actions work succeeds, call
   `mail publish --input FILE` with `{leaseId,fileHash,changes,acknowledge}`.
   `acknowledge` lists discovery `messageId`s, not activity IDs, and must cover
   every successfully processed pending discovery through `startedAt`, including
   those durably held for review. `changes` uses task ids and activity IDs (see
   Actions Check → Publish). Quick omits `acknowledge`; publication scope is
   derived from the lease. Omit `changes` only when there are no explicit changes
   to report. This command refreshes recruiting state, saves the acknowledgment
   plan, finalizes Actions, and completes the handoff. For Daily it also runs the
   local No Response maintenance pass and recounts the saved summary so its
   closures are included. Do not call low-level
   `actions finalize` or Actions `mail sync` during a journaled check.
6. If publication fails after Actions was saved, retry via `mail finish` using
   the same lease and saved plan. If the command returned an uncertain response,
   read `mail list --json` and `actions list --json` first. A failed Inbox or
   unfinished Actions scan retains its last successful checkpoint. Call
   `mail fail --input FILE` with `{leaseId,failure}` on any incomplete attempt
   still owned by this invocation. Use `mail-access`, `inbox-processing`,
   `actions-processing`, `persistence`, or `interrupted` as appropriate.
   `mail publish|finish` records a maintenance failure itself. Report the
   attempt as Partial with mail checkpoints already committed, and let the next
   Daily retry maintenance. Never include message contents or errors in the
   journal. Clean up temporary input files.
