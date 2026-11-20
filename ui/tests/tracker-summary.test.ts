import { expect, it } from "vitest";
import { trackerSummary } from "@/lib/trackerSummary";
import type { ApplicationRow, Status } from "@/lib/types";
import type { RecruitingWorkflow } from "@/lib/recruitingTypes";

function row(
  key: string,
  status: Status = "applied",
  date = "2026-11-16",
): ApplicationRow {
  return {
    key,
    date,
    status,
    company: key,
    role: "Engineer",
    lane: "tech",
    resume: "tech",
    fit: "",
    match: "",
    source: "LinkedIn",
    next: "",
    link: "",
    lineIndex: 0,
  };
}
function workflow(
  r: ApplicationRow,
  extra: Partial<RecruitingWorkflow> = {},
): RecruitingWorkflow {
  return {
    applicationKey: r.key,
    status: r.status,
    observedAt: "2026-11-01T12:00:00Z",
    statusAt: "2026-11-01T12:00:00Z",
    ...extra,
  };
}
const today = "2026-11-16";

it("separates calendar week, today and trailing seven-day submissions across every current status", () => {
  const rows = [
    row("new"),
    row("closed", "rejected", "2026-11-10"),
    row("old", "unsuccessful", "2026-11-09"),
    row("saved", "to apply"),
    row("future", "applied", "2026-11-17"),
  ];
  const result = trackerSummary(rows, [], today);
  expect(result.allTime).toBe(3);
  expect(result.week).toBe(1);
  expect(result.today).toBe(1);
  expect(result.recent.applied).toBe(2);
  expect(result.totals.applied).toBe(1);
});

it("keeps submission and progress activity after rejection, deduplicating repeated entries and polls", () => {
  const r = row("closed", "unsuccessful", "2026-11-10");
  const w = workflow(r, {
    statusAt: "2026-11-16T14:00:00Z",
    statusHistory: [
      { status: "in progress", at: "2026-11-11T15:00:00Z" },
      { status: "in progress", at: "2026-11-12T15:00:00Z" },
      { status: "unsuccessful", at: "2026-11-16T14:00:00Z" },
    ],
  });
  const result = trackerSummary([r], [w], today);
  expect(result.totals["in progress"]).toBe(0);
  expect(result.recent).toEqual({
    applied: 1,
    "in progress": 1,
    rejected: 0,
    "no response": 0,
    unsuccessful: 1,
  });
  expect(trackerSummary([r], [w, w], today).recent).toEqual(result.recent);
});

it("uses New York dates at window boundaries and ignores initial observations, future history and deleted rows", () => {
  const r = row("old", "no response", "2026-10-01");
  const baseline = row("baseline", "rejected", "2026-10-01");
  const result = trackerSummary(
    [r, baseline],
    [
      workflow(baseline, {
        statusAt: "2026-11-16T12:00:00Z",
        observedAt: "2026-11-16T12:00:00Z",
      }),
      workflow(row("deleted"), { statusAt: "2026-11-16T12:00:00Z" }),
      workflow(r, {
        statusHistory: [
          { status: "in progress", at: "2026-11-10T04:59:59Z" },
          { status: "no response", at: "2026-11-10T05:00:00Z" },
          { status: "rejected", at: "2026-11-17T05:00:00Z" },
        ],
      }),
    ],
    today,
  );
  expect(result.recent["in progress"]).toBe(0);
  expect(result.recent["no response"]).toBe(1);
  expect(result.recent.rejected).toBe(0);
});

it("recovers known legacy transitions by stable ID without inferring baseline activity", () => {
  const r = {
    ...row("edited", "in progress", "2026-10-01"),
    recordId: "stable",
  };
  const w = workflow(r, {
    applicationKey: "old-key",
    recordId: "stable",
    statusAt: "2026-11-15T12:00:00Z",
  });
  expect(trackerSummary([r], [w], today).recent["in progress"]).toBe(1);
  expect(trackerSummary([r], undefined, today).totals["in progress"]).toBe(1);
});
