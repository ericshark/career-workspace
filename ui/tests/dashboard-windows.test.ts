import { describe, expect, it } from "vitest";
import {
  activityWindow,
  barColor,
  earliestActivityDate,
  maxWindowOffset,
} from "../src/lib/analytics";
import {
  ARCHIVE_AFTER_DAYS,
  closedTimes,
  isArchivedClosure,
} from "../src/lib/recruitingPresentation";
import type { InboxAction } from "../src/lib/actionTypes";

describe("30-day activity windows", () => {
  const byDay = { "2026-10-07": 4, "2026-11-18": 2 };
  it("ends today at offset 0 and steps back 30 days at a time", () => {
    const now = activityWindow(byDay, "2026-11-18");
    expect(now).toHaveLength(30);
    expect(now[0].date).toBe("2026-10-20");
    expect(now[29]).toEqual({ date: "2026-11-18", count: 2 });
    const prev = activityWindow(byDay, "2026-11-18", 1);
    expect(prev[29].date).toBe("2026-10-19");
    expect(prev[0].date).toBe("2026-09-20");
    expect(prev.find((d) => d.date === "2026-10-07")?.count).toBe(4);
  });
  it("stops at the window holding the earliest activity", () => {
    expect(earliestActivityDate(byDay, "2026-11-18")).toBe("2026-10-07");
    expect(maxWindowOffset(byDay, "2026-11-18")).toBe(1);
    expect(maxWindowOffset({}, "2026-11-18")).toBe(0);
  });
});

describe("barColor", () => {
  it("steps by five through red, switches to green at 25, and caps at 100", () => {
    expect(barColor(0)).toBe(barColor(4));
    expect(barColor(4)).not.toBe(barColor(5));
    expect(barColor(24)).toMatch(/^hsl\(28 /);
    expect(barColor(25)).toMatch(/^hsl\(142 /);
    expect(barColor(25)).toBe(barColor(29));
    expect(barColor(30)).not.toBe(barColor(29));
    expect(barColor(100)).toBe(barColor(500));
    expect(barColor(99)).not.toBe(barColor(100));
  });
});

describe("archiving closed history", () => {
  const task = (id: string, manuallyClosedAt?: string) =>
    ({ id, manuallyClosedAt }) as InboxAction;
  const now = new Date("2026-11-18T12:00:00Z");
  it("is ready to delete at exactly 14 days, not 13", () => {
    const old = closedTimes([task("a", "2026-11-04T12:00:00Z")], [], []);
    const recent = closedTimes([task("b", "2026-11-05T12:00:00Z")], [], []);
    expect(ARCHIVE_AFTER_DAYS).toBe(14);
    expect(isArchivedClosure(old.get("a"), now)).toBe(true);
    expect(isArchivedClosure(recent.get("b"), now)).toBe(false);
  });
  it("keeps jobs with an unknown close time in Closed", () => {
    const times = closedTimes([task("c")], [], []);
    expect(isArchivedClosure(times.get("c"), now)).toBe(false);
  });
});

describe("category chips", () => {
  it("labels updates by event kind, colors them by meaning, and gives requests no chip", async () => {
    const { updateChip, ACTION_CATEGORIES, ACTION_CATEGORY_STYLE } =
      await import("../src/lib/actionTypes");
    expect(updateChip({ kind: "rejected" })?.label).toBe("Rejected");
    expect(updateChip({ kind: "rejected", wasInProgress: true })?.label).toBe(
      "Unsuccessful",
    );
    expect(updateChip({ kind: "interview" })?.label).toBe(
      "Scheduled interview",
    );
    expect(updateChip({ kind: "requested" })).toBeNull();
    const color = (kind: string) => updateChip({ kind })?.color;
    for (const k of ["rejected", "no-response"])
      expect(color(k)).toContain("red");
    for (const k of ["interview", "response", "stage", "completed"])
      expect(color(k)).toContain("emerald");
    for (const k of ["followup", "other"]) expect(color(k)).toContain("amber");
    for (const c of [
      "assessment",
      "screening",
      "schedule",
      "reply",
      "application",
    ] as const)
      expect(ACTION_CATEGORY_STYLE[c].color).toContain("blue");
    for (const c of ["verify", "sign", "other"] as const)
      expect(ACTION_CATEGORY_STYLE[c].color).toContain("amber");
    expect(ACTION_CATEGORY_STYLE.reply.label).toBe("Reply requested");
    for (const c of ACTION_CATEGORIES)
      expect(ACTION_CATEGORY_STYLE[c].label).toBeTruthy();
  });
});
