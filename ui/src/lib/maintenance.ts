import { ageUnansweredApplications } from "./applications";
import { readMailSync } from "./mailSync";
import { localDate } from "./config";
const state = globalThis as typeof globalThis & {
  careerMaintenanceWarning?: string;
  /** Local date (YYYY-MM-DD) of the last aging pass, so a long-lived server runs one per day. */
  careerMaintenanceDay?: string;
};
export function maintenanceWarning() {
  return state.careerMaintenanceWarning;
}
export function awaitingResponse(
  date: string,
  interaction: string | undefined,
  today: string,
) {
  const since = interaction
    ? [date, localDate(new Date(interaction))].sort().at(-1)!
    : date;
  return (
    Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`) >=
    21 * 86400000
  );
}
/**
 * The server can stay up for days, and the 21-day No Response rule depends on the date, so aging
 * must not wait for the next restart. Runs the first time it is called on each local day (startup
 * counts as that day's pass). Cheap to call on every poll.
 */
export async function ageApplicationsOncePerDay(now = new Date()) {
  if (state.careerMaintenanceDay === localDate(now)) return;
  await ageApplications(now);
}
export async function ageApplications(now = new Date()) {
  // Claimed up front so overlapping polls do not start the same pass twice; a failure is retried tomorrow
  // (or on restart) and stays visible through maintenanceWarning.
  state.careerMaintenanceDay = localDate(now);
  try {
    let interactions:
      ReturnType<typeof readMailSync>["interactions"] | undefined;
    const today = localDate(now);
    const { reconcileRecruiting, waitingEligible } =
      await import("./recruiting");
    const recruiting = await reconcileRecruiting(now);
    const { applicationFor } = await import("./recruitingTypes");
    await ageUnansweredApplications((row) => {
      // Read once under the application lock, after any queued writer finishes.
      interactions ??= readMailSync().interactions;
      // Attaching a saved record ID does not invalidate earlier row-key evidence.
      const activity = [interactions[row.key], interactions[row.recordId ?? ""]]
        .filter((at): at is string => !!at)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
      const w = recruiting.workflows.find(
        (w) => applicationFor(w, recruiting.rows)?.key === row.key,
      );
      const open = recruiting.actions.filter(
        (a) =>
          a.state === "open" &&
          a.application &&
          applicationFor(a.application, recruiting.rows)?.key === row.key,
      ).length;
      const reviewPending = recruiting.events.some(
        (e) =>
          e.evidenceRole === "contradiction" &&
          recruiting.actions.some(
            (a) =>
              a.id === e.taskId &&
              a.state === "completed" &&
              !a.dismissedSuggestions?.includes(e.id),
          ),
      );
      if (
        reviewPending ||
        open ||
        (w?.scheduledAt &&
          Date.parse(w.scheduledUntil ?? w.scheduledAt) > now.getTime()) ||
        (w?.responseDue && Date.parse(w.responseDue) > now.getTime())
      )
        return false;
      if (row.status === "in progress") {
        if (!w || !waitingEligible(w, open, now)) return false;
        const since = [w.waitingSince]
          .filter((v): v is string => !!v)
          .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
        return awaitingResponse(localDate(new Date(since)), undefined, today);
      }
      const meaningful = recruiting.events
        .filter(
          (e) =>
            !e.id.startsWith("waiting:") &&
            applicationFor(e, recruiting.rows)?.key === row.key &&
            ["response", "stage", "interview", "followup"].includes(e.kind),
        )
        .map((e) => e.at);
      const latest = [activity, w?.waitingSince, ...meaningful]
        .filter((v): v is string => !!v)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
      return awaitingResponse(row.date, latest, today);
    });
    await reconcileRecruiting(now);
    state.careerMaintenanceWarning = undefined;
  } catch (e) {
    state.careerMaintenanceWarning = `No Response maintenance failed: ${e instanceof Error ? e.message : String(e)}`;
    console.error(state.careerMaintenanceWarning);
  }
}
