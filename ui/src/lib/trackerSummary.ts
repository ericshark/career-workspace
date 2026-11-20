import { localDate } from "./config";
import { addDays } from "./progress";
import { statusColumn } from "./status";
import { weekStart } from "./trackerView";
import { applicationFor, type RecruitingWorkflow } from "./recruitingTypes";
import type { ApplicationRow, Status } from "./types";

export const SUMMARY_STATUSES = [
  "applied",
  "in progress",
  "rejected",
  "no response",
  "unsuccessful",
] as const satisfies readonly Status[];
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/** Unfiltered totals plus unique applications entering each status in seven local calendar days. */
export function trackerSummary(
  rows: ApplicationRow[],
  workflows: RecruitingWorkflow[] | undefined,
  today: string,
) {
  const totals: Record<SummaryStatus, number> = {
    applied: 0,
    "in progress": 0,
    rejected: 0,
    "no response": 0,
    unsuccessful: 0,
  };
  const changed = Object.fromEntries(
    SUMMARY_STATUSES.map((status) => [status, new Set<ApplicationRow>()]),
  ) as Record<SummaryStatus, Set<ApplicationRow>>;
  const submitted = rows.filter(
    (row) =>
      statusColumn(row.status).column !== "to apply" && row.date <= today,
  );
  const since = addDays(today, -6);
  let week = 0;
  let daily = 0;
  let submissions = 0;
  const monday = weekStart(today);
  for (const row of submitted) {
    totals[statusColumn(row.status).column as SummaryStatus]++;
    if (row.date >= monday) week++;
    if (row.date === today) daily++;
    // Submission activity survives every later status change.
    if (row.date >= since) submissions++;
  }
  const eligible = new Set(submitted);
  for (const workflow of workflows ?? []) {
    const row = applicationFor(workflow, rows);
    if (!row || !eligible.has(row)) continue;
    const history = [...(workflow.statusHistory ?? [])];
    // Old workflows retain their latest real transition. Equal timestamps indicate
    // a baseline snapshot, not evidence the application entered that status then.
    if (workflow.statusAt !== workflow.observedAt) {
      history.push({ status: workflow.status, at: workflow.statusAt });
    }
    for (const transition of history) {
      if (!Number.isFinite(Date.parse(transition.at))) continue;
      const day = localDate(new Date(transition.at));
      if (day < since || day > today) continue;
      const status = statusColumn(transition.status).column;
      if (status !== "to apply" && status !== "applied")
        changed[status].add(row);
    }
  }
  return {
    allTime: submitted.length,
    week,
    today: daily,
    totals,
    recent: {
      applied: submissions,
      "in progress": changed["in progress"].size,
      rejected: changed.rejected.size,
      "no response": changed["no response"].size,
      unsuccessful: changed.unsuccessful.size,
    },
  };
}
