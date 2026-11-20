# Recruiting evidence and where it appears

Inbox Check applies Gmail labels and stars, records tracker changes and hands off
verified evidence. Actions Check owns request reconciliation and publication of
recruiting updates. Career Check owns the run and report. Inbox may publish a
verified rejection before its guarded tracker write to preserve closure evidence.
Gmail's Action Needed label can include a confirmation that requires no task.

| Evidence                                                                                                                     | Action                                                                                                                                                | Recruiting update                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Invitation to book, assessment, reply request, verified application prerequisite                                             | Create one task per distinct ask                                                                                                                      | The task is the activity                            |
| Reminder repeating an ask, receipt, generic account setup                                                                    | Preserve any existing task                                                                                                                            | None                                                |
| Material deadline or request change                                                                                          | Update the same open task using a new activity identity                                                                                               | Publish through task activity                       |
| Confirmed booking, new time, explicit cancellation                                                                           | Link the appointment to the existing task when verified. Suggest completion if booking is still open. Retire a withdrawn open ask only with evidence. | One update for the changed appointment              |
| the workspace owner's Sent reply proposes or accepts a specific interview time for a verified scheduling task, no employer confirmation yet | Preserve the task; suggest completion if it is still open                                                                                             | Record a proposed appointment (no Update)           |
| Confirmation with a separate concrete ask                                                                                    | Create one task for the separate ask                                                                                                                  | Record the appointment independently                |
| Substantive employer reply without an ask                                                                                    | No task                                                                                                                                               | One meaningful update                               |
| Verified rejection                                                                                                           | Close obsolete work                                                                                                                                   | Record closure, preserving any prior completed work |
| Unclear identity, conflicting logistics or missing evidence                                                                  | Hold the evidence for review                                                                                                                          | Publish verified facts only                         |

## Calendar evidence

Inspect calendar MIME parts and supported `.ics` attachments on booking-related
messages, even when the body repeats an invitation. Read the actual VEVENT
DTSTART, TZID or UTC offset, UID, SEQUENCE and cancellation method/status.
Distinguish email receipt time from the appointment start. An attached confirmed
appointment can establish the booking when the templated body still says to book.
A genuine conflict between specific times or an unreadable attachment needed to
verify a time goes to review with its evidence. Do not open personalized links.
An unsuccessful required read remains partial.

Match across threads using the verified application, stage, participants and
appointment evidence. Read completed request identities too. Sync any new tasks
first, then publish a recruiting `interview` event with `appointment:
{id, actionId?, sequence?, cancelled?}`. For a new appointment, use the calendar
UID as id, or a stable appointment identity grounded in the booking evidence when
UID is absent. Reuse the saved appointment id for corrections, reschedules,
cancellations and for a confirmation that answers a saved proposal, even when the
invite carries a UID. Rebooking after a cancellation uses a new id. If a
verified newer change comes by plain email, carry forward the saved sequence
when the email supplies none. Use
actionId only for a verified scheduling task for that appointment. Use a distinct
id for a different interview. Supply scheduledAt for a verified booking and omit
it for cancellation. Record a new message using its own event ID and receipt
instant. To correct extraction from the same message, reuse its event ID,
source URL, and receipt instant. Repeated delivery of the same schedule does
not warrant another notification.

Booking evidence for an open task can attach a completion suggestion. Keep the
request activity identity in that case so the confirmation is counted once.
For a completed task, publish the linked appointment and preserve the task's
completion and original email. The timeline groups request and completion into
one task entry and renders the appointment separately. Ordinary task receipts
attach to their task; the appointment has its own confirmation email.
Use a confirmation title such as “Recruiter screen confirmed” for the update.

When the workspace owner's own Sent reply proposes or accepts a specific time and the employer
has not confirmed it, publish an `interview` event for that Sent message with
`appointment:{id, actionId?, proposed:true}` and `scheduledAt` read from the
Sent text (date-only stays date-only; never invent a time zone or duration).
The service stores it without an Update and shows it as Proposed on the card,
Timeline and Upcoming. When the employer confirms (reply or calendar invite),
publish the confirmation with the same appointment id and no `proposed`; it
replaces the proposed time and produces the one confirmation Update. If a
confirmation is sent under another id anyway, the service replaces the proposal
when it shares the scheduling task (`actionId`) or is the application's only open
proposal; with several open proposals it keeps them and notes the conflict on the
confirmation for review. A proposal never replaces an already confirmed or
cancelled appointment. A proposal whose time passes without confirmation shows as
Not confirmed: it leaves Upcoming and does not start the waiting clock.

## Grouped lifecycle contract

For new recruiting evidence, follow `ui/docs/recruiting-lifecycle-spec.md` and
its approved implementation decisions. Supply `requestKind` on task sync (mapping
in Actions Check → Reconcile and persist) and set `responseExpected` explicitly
when the evidence establishes or rules out an expected reply. Ordinary receipts and actual sent replies attach to their exact
task through recruiting events with `taskId` and `evidenceRole:"receipt"|"sent"`.
They never become tasks or Updates. The Timeline shows each as its own line
(“You replied” / “Confirmation received”, naming the task) so the story reads in
order, while the task itself stays one entry that flips from open to completed.

Specific evidence that completed work is missing uses `taskId` plus
`evidenceRole:"contradiction"`. Keep the task completed for user review; do not
silently reopen it. Generic reminders do not establish a contradiction.

Appointments remain separate from scheduling tasks. Include verified
`scheduledEndAt` when available and preserve the calendar identity across changes.
Cancellation and rescheduling update one visible appointment with the original
and revised date explained. Time passage marks appointments Completed locally;
it is not attendance evidence. Do not write UI-owned appointment dismissal or
completion-review dismissal fields from a check.

## Waiting and closure

Local refresh evaluates saved state without Gmail. A waiting episode needs an
actual expected employer response: completed `screening`/`submission` work, an
explicit `responseExpected:true`, or a past confirmed interview. Open work, a
future interview (confirmed or proposed) and a future promised response date
hold the clock.

- Day 10: “Consider following up” chip beside the company heading.
- Day 18: “Follow up now” chip. Dismissing the day-10 chip still allows it;
  dismissing the day-18 chip ends reminders for that episode.
- Day 21: the application closes as No response with one closure Update.

Reminder chips are never Updates. Silence is No response, never Rejected.
Manual task completion stays user-owned.

## Routine account mail

Routine candidate-account or email verification, account activation, password
resets, sign-in codes, profile-completion nudges and generic portal setup never
create tasks, actionable handoffs, review items or clarification items on their
own. Read enough to classify them. A separate substantive ask in the same
conversation follows the normal rules. Do not delete or auto-complete existing
cards because of this rule.

Verification is actionable only when the message or verified conversation ties
it to a specific application and makes it necessary to submit or advance that
application (for example, “verify within 24 hours to submit your application for
X”). Preserve any stated deadline and use the normal matching safeguards. If a
prerequisite is plausible but unclear, keep it for review. The request alone is
not evidence of submission or completion.

## Suggested application matches

Capture concrete recruiting asks even when the message omits the exact role or
posting ID. Rank candidates across tracker statuses using the verified sender
organization, known name variants, recent correspondence and saved posting
details. A unique, strongly supported match follows the normal linked workflow.

When one application is clearly the best candidate but evidence is incomplete,
persist the full request in recruiting pending through `recruiting sync` with
`suggestedApplication: {rowKey, recordId?}` and a short reason. Keep the action
payload unlinked until confirmation and preserve its stable request identity.
Decisions shows the suggestion preselected. With no clear front-runner, or
conflicting evidence, omit the suggestion. Whenever an item is held, set
`matchIssue` to `not-in-tracker`, `several-candidates`, `role-differs` or
`no-role`. A suggestion is never confirmation for tracker status, closures or
completion evidence.
