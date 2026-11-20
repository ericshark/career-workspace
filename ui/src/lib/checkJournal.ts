import { z } from "zod";

const instant = z.iso.datetime({ offset: true });
export const checkMode = z.enum(["daily", "quick", "inbox", "actions"]);
export const checkFailure = z.enum([
  "mail-access",
  "inbox-processing",
  "actions-processing",
  "persistence",
  "maintenance",
  "interrupted",
]);
export const checkAttempt = z
  .object({
    runId: z.uuid(),
    leaseId: z.uuid(),
    mode: checkMode,
    startedAt: instant,
    attemptedAt: instant,
    expiresAt: instant,
    stage: z.enum(["inbox", "actions", "quick", "maintenance"]),
    status: z.enum(["running", "failed", "succeeded"]),
    endedAt: instant.optional(),
    failure: checkFailure.optional(),
    inboxCompletedAt: instant.optional(),
    // Persist the complete acknowledgment intent before publishing Actions.
    acknowledge: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CheckAttempt = z.infer<typeof checkAttempt>;
export type CheckAttemptView = Omit<CheckAttempt, "leaseId" | "acknowledge">;

export function attemptView({
  leaseId: _leaseId,
  acknowledge: _acknowledge,
  ...attempt
}: CheckAttempt): CheckAttemptView {
  return attempt;
}

export const LEASE_MS = 15 * 60_000;
export const CHECK_HISTORY_LIMIT = 30;
