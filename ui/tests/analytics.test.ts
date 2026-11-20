import { describe, expect, it } from "vitest";
import { activityDays, computeAnalytics } from "@/lib/analytics";
import { applicationDate } from "@/lib/config";
import type { ApplicationRow } from "@/lib/types";

const row = (
  status: string,
  source = "LinkedIn",
  date = "2026-10-29",
): ApplicationRow => ({
  date,
  company: "Acme",
  role: "Engineer",
  lane: "tech",
  resume: "tech",
  fit: "",
  match: "",
  source,
  status,
  next: "",
  link: "",
  key: `${status}-${source}-${date}`,
  lineIndex: 0,
});
describe("analytics", () => {
  it("combines rejected, no response and unsuccessful without counting open, queued or future rows", () => {
    const rows = [
      row("rejected"),
      row("no response"),
      row("unsuccessful"),
      row("ghosted"),
      row("applied"),
      row("in progress"),
      row("to apply"),
      row("custom status"),
      row("rejected", "Other", "2026-10-30"),
    ];
    expect(computeAnalytics(rows, "2026-10-29").totalRejected).toBe(4);
    expect(computeAnalytics([], "2026-10-29").totalRejected).toBe(0);
  });
  it("reconciles every submitted status and excludes the to-apply queue", () => {
    const data = computeAnalytics(
      [
        row("applied"),
        row("in progress"),
        row("no response"),
        row("rejected"),
        row("to apply"),
      ],
      "2026-10-29",
    );
    expect(data.total).toBe(4);
    expect(data.counts).toEqual({
      applied: 1,
      "in progress": 1,
      "no response": 1,
      rejected: 1,
      unsuccessful: 0,
      other: 0,
    });
    expect(data.sources[0].progressRate).toBe(0.25);
  });
  it("normalizes known legacy statuses and discloses unknown ones", () => {
    const data = computeAnalytics(
      [row("interview"), row("offer"), row("ghosted"), row("custom status")],
      "2026-10-29",
    );
    expect(data.counts["in progress"]).toBe(2);
    expect(data.counts["no response"]).toBe(1);
    expect(data.counts.other).toBe(1);
    expect(Object.values(data.counts).reduce((a, b) => a + b, 0)).toBe(
      data.total,
    );
  });
  it("uses inclusive submission cohorts while retaining independent activity history", () => {
    const rows = [
      row("applied", "LinkedIn", "2026-09-29"),
      row("rejected", "LinkedIn", "2026-09-30"),
      row("in progress"),
      row("applied", "Other", "2026-10-30"),
    ];
    const data = computeAnalytics(rows, "2026-10-29", "30");
    expect(data.total).toBe(2);
    expect(data.byDay["2026-09-29"]).toBe(1);
    expect(data.byDay["2026-10-30"]).toBeUndefined();
    expect(computeAnalytics(rows, "2026-10-29", "90").total).toBe(3);
  });
  it("groups recorded source names without attributing ATS hosts", () => {
    const data = computeAnalytics(
      [
        row("applied", " linkedin "),
        row("in progress", "LinkedIn"),
        row("applied", ""),
        row("applied", "Personal referral"),
      ],
      "2026-10-29",
    );
    expect(data.sources.find((s) => s.source === "LinkedIn")).toMatchObject({
      total: 2,
      progressRate: 0.5,
    });
    expect(data.sources.map((s) => s.source)).toEqual([
      "LinkedIn",
      "Other",
      "Personal referral",
    ]);
  });
  it("calculates the rolling four-week rate across New York application-day boundaries", () => {
    expect(applicationDate(new Date("2026-10-30T06:59:59Z"))).toBe(
      "2026-10-29",
    );
    expect(applicationDate(new Date("2026-10-30T07:00:00Z"))).toBe(
      "2026-10-30",
    );
    const data = computeAnalytics(
      [
        row("applied", "Other", "2026-10-02"),
        row("rejected", "Other", "2026-10-01"),
        row("in progress"),
      ],
      "2026-10-29",
    );
    expect(data.weeklyAverage).toBe(0.5);
  });
  it("defaults activity to seven inclusive days across leap months and year boundaries", () => {
    const days = activityDays({ "2024-02-29": 3 }, "2024-03-01");
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe("2024-02-24");
    expect(days[5]).toEqual({ date: "2024-02-29", count: 3 });
    expect(days[6]).toEqual({ date: "2024-03-01", count: 0 });
    expect(days[0].count).toBe(0);
    expect(activityDays({}, "2026-01-01")[0].date).toBe("2025-12-26");
  });
  it("shows every day from the first submission through today for all activity", () => {
    const days = activityDays(
      { "2026-08-01": 0, "2026-09-01": 2, "2026-11-03": 5 },
      "2026-11-02",
      "all",
    );
    expect(days).toHaveLength(63);
    expect(days[0]).toEqual({ date: "2026-09-01", count: 2 });
    expect(days.at(-1)).toEqual({ date: "2026-11-02", count: 0 });
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(2);
  });
  it("handles an empty tracker or future-only activity without invalid ranges", () => {
    expect(activityDays({}, "2026-10-29", "all")).toEqual([
      { date: "2026-10-29", count: 0 },
    ]);
    expect(activityDays({ "2026-10-30": 1 }, "2026-10-29", "all")).toEqual([
      { date: "2026-10-29", count: 0 },
    ]);
    expect(computeAnalytics([], "2026-10-29")).toMatchObject({
      total: 0,
      sources: [],
      weeklyAverage: 0,
    });
  });
});
