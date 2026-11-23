import { describe, expect, it } from "vitest";
import {
  computeAverages,
  computeProgress,
  mondayToSunday,
} from "@/lib/progress";
import type { ApplicationRow } from "@/lib/types";

let counter = 0;
function row(date: string, over: Partial<ApplicationRow> = {}): ApplicationRow {
  counter++;
  return {
    date,
    company: `Co${counter}`,
    role: "SWE",
    lane: "tech",
    resume: "tech",
    fit: "",
    match: "",
    source: "",
    status: "applied",
    next: "",
    link: "",
    key: `k${counter}`,
    lineIndex: counter,
    ...over,
  };
}
/** n tech rows on one date. */
const many = (date: string, n: number, over: Partial<ApplicationRow> = {}) =>
  Array.from({ length: n }, () => row(date, over));

// 2026-10-06 is a Tuesday; a plain Mon–Sun week keeps the arithmetic obvious.
const WEEK = { from: "2026-10-05", to: "2026-10-11" };

describe("mondayToSunday", () => {
  it("returns the Mon–Sun week containing the date", () => {
    expect(mondayToSunday("2026-10-06")).toEqual(WEEK);
    expect(mondayToSunday("2026-10-05")).toEqual(WEEK);
    expect(mondayToSunday("2026-10-11")).toEqual(WEEK); // Sunday belongs to the prior Monday
    expect(mondayToSunday("2026-10-12").from).toBe("2026-10-12");
  });
});

describe("computeProgress counts", () => {
  it("excludes `to apply` and counts any later status", () => {
    const rows = [
      row("2026-10-06", { status: "to apply" }),
      row("2026-10-06", { status: "applied" }),
      row("2026-10-06", { status: "in progress" }),
      row("2026-10-06", { status: "rejected" }),
    ];
    const p = computeProgress(rows, "2026-10-06", WEEK);
    expect(p.today.tech).toBe(3);
    expect(p.week.tech).toBe(3);
    expect(p.queued).toBe(1);
    expect([p.rejected, p.allTime]).toEqual([1, 3]);
  });

  it("splits tech and bridge, today vs week", () => {
    const rows = [
      row("2026-10-06"),
      row("2026-10-06", { lane: "bridge" }),
      row("2026-10-05"),
      row("2026-10-05", { lane: "bridge" }),
      row("2026-10-05", { lane: "bridge" }),
      row("2026-09-30"), // before the week
    ];
    const p = computeProgress(rows, "2026-10-06", WEEK);
    expect(p.today).toEqual({
      date: "2026-10-06",
      tech: 1,
      bridge: 1,
      target: 25,
    });
    expect(p.week.tech).toBe(2);
    expect(p.week.bridge).toBe(3);
    expect(p.week.target).toBe(125);
  });

  it("uses a Now-box week that starts mid-week", () => {
    const week = { from: "2026-10-07", to: "2026-10-13" };
    const rows = [row("2026-10-06"), row("2026-10-07"), row("2026-10-13")];
    expect(computeProgress(rows, "2026-10-07", week).week.tech).toBe(2);
  });

  it("injects today even with no rows", () => {
    const p = computeProgress([], "2026-10-06", WEEK);
    expect(p.today.date).toBe("2026-10-06");
    expect(p.today.tech).toBe(0);
    expect(p.streak).toEqual({
      days: 0,
      best: 0,
      appliedToday: false,
      activeDaysThisWeek: 0,
    });
    expect(p.byDay).toEqual({});
    expect(p.last5).toEqual([]);
  });

  it("counts all-time submissions (any lane, any date) and passes the plan through", () => {
    const rows = [
      row("2025-12-01"),
      row("2026-10-06", { lane: "bridge" }),
      row("2026-10-06", { status: "rejected" }),
      row("2026-10-06", { status: "to apply" }),
    ];
    const p = computeProgress(rows, "2026-10-06", WEEK);
    expect(p.allTime).toBe(3);
    expect(p.plan).toBeNull();
  });

  it("counts active weekdays (any lane) and ignores weekend rows", () => {
    const rows = [
      row("2026-10-05"),
      row("2026-10-05"),
      row("2026-10-06", { lane: "bridge" }),
      row("2026-10-10"), // Saturday
    ];
    expect(
      computeProgress(rows, "2026-10-10", WEEK).streak.activeDaysThisWeek,
    ).toBe(2);
  });

  it("returns the 5 newest rows, newest first (prepended rows win ties)", () => {
    const rows = [
      row("2026-10-06", { company: "A", lineIndex: 0 }),
      row("2026-10-06", { company: "B", lineIndex: 1 }),
      row("2026-10-05", { company: "C", lineIndex: 2 }),
      row("2026-10-03", { company: "D", lineIndex: 3 }),
      row("2026-10-04", { company: "E", lineIndex: 4 }),
      row("2026-10-01", { company: "F", lineIndex: 5 }),
    ];
    const last5 = computeProgress(rows, "2026-10-06", WEEK).last5;
    expect(last5.map((r) => r.company)).toEqual(["A", "B", "C", "E", "D"]);
  });
});

describe("expectedByToday", () => {
  it("is weekday index × 25, capped at 125", () => {
    const e = (d: string) =>
      computeProgress([], d, mondayToSunday(d)).week.expectedByToday;
    expect(e("2026-10-05")).toBe(25); // Mon
    expect(e("2026-10-06")).toBe(50); // Tue
    expect(e("2026-10-08")).toBe(100); // Thu
    expect(e("2026-10-09")).toBe(125); // Fri
    expect(e("2026-10-10")).toBe(125); // Sat: all five weekdays done
    expect(e("2026-10-11")).toBe(125); // Sun
  });

  it("counts from a mid-week start", () => {
    const week = { from: "2026-10-07", to: "2026-10-13" };
    expect(computeProgress([], "2026-10-07", week).week.expectedByToday).toBe(
      25,
    );
    expect(computeProgress([], "2026-10-13", week).week.expectedByToday).toBe(
      125,
    );
  });
});

describe("streak", () => {
  // Calendar for reference: 2026-10-02 Fri, 10-03 Sat, 10-04 Sun, 10-05 Mon, 10-06 Tue.
  const streak = (rows: ApplicationRow[], today: string) =>
    computeProgress(rows, today, WEEK).streak;

  it("back-to-back days count, one application is enough", () => {
    const rows = [row("2026-10-05"), row("2026-10-06")];
    expect(streak(rows, "2026-10-06")).toMatchObject({
      days: 2,
      appliedToday: true,
    });
  });

  it("Fri + Mon = 2: an empty weekend doesn't reset it", () => {
    const rows = [row("2026-10-02"), row("2026-10-05")];
    expect(streak(rows, "2026-10-05").days).toBe(2);
    // Viewed on the Sunday in between, Friday's streak is still alive.
    expect(streak(rows.slice(0, 1), "2026-10-04").days).toBe(1);
  });

  it("a weekend application adds to the streak", () => {
    const rows = [row("2026-10-02"), row("2026-10-03"), row("2026-10-05")];
    expect(streak(rows, "2026-10-05").days).toBe(3);
  });

  it("an empty weekday breaks it", () => {
    const rows = [row("2026-10-01"), row("2026-10-05")]; // Fri 10-02 missed
    expect(streak(rows, "2026-10-05").days).toBe(1);
  });

  it("today without an application keeps yesterday's streak", () => {
    const rows = [row("2026-10-02"), row("2026-10-05")];
    expect(streak(rows, "2026-10-06")).toMatchObject({
      days: 2,
      appliedToday: false,
    });
    // Two empty weekdays in a row: it's over.
    expect(streak(rows, "2026-10-07").days).toBe(0);
  });

  it("bridge rows count; `to apply` rows don't", () => {
    expect(
      streak([row("2026-10-06", { lane: "bridge" })], "2026-10-06").days,
    ).toBe(1);
    expect(
      streak([row("2026-10-06", { status: "to apply" })], "2026-10-06").days,
    ).toBe(0);
  });

  it("tracks the best streak ever", () => {
    const rows = [
      row("2026-09-24"), // Thu
      row("2026-09-25"), // Fri
      row("2026-09-28"), // Mon (weekend skipped) → run of 3
      // Tue 09-29 missed
      row("2026-10-06"),
    ];
    expect(streak(rows, "2026-10-06")).toMatchObject({ days: 1, best: 3 });
  });

  it("builds per-day counts for the calendar", () => {
    const rows = [
      ...many("2026-10-05", 2),
      row("2026-10-05", { lane: "bridge" }),
      row("2026-10-06", { status: "to apply" }),
    ];
    expect(computeProgress(rows, "2026-10-06", WEEK).byDay).toEqual({
      "2026-10-05": 3,
    });
  });
});

describe("computeAverages", () => {
  // Fri 2026-10-02 .. Mon 2026-10-05 completed; today is Tue 2026-10-06.
  const byDay = { "2026-10-02": 10, "2026-10-03": 4, "2026-10-05": 6 };

  it("averages completed days only, from the first application through yesterday", () => {
    const a = computeAverages(byDay, "2026-10-06");
    // 20 applications; 4 calendar days; 2 weekdays (Fri, Mon); 3 active days.
    expect(a.perCalendarDay).toBe(5);
    expect(a.elapsedDays).toBe(4);
    expect(a.perWeekday).toBe(10);
    expect(a.perActiveDay).toBeCloseTo(20 / 3);
  });

  it("ignores today until the day is over, then rolls it in", () => {
    const withToday = { ...byDay, "2026-10-06": 40 };
    expect(computeAverages(withToday, "2026-10-06")).toEqual(
      computeAverages(byDay, "2026-10-06"),
    );
    expect(computeAverages(withToday, "2026-10-07").perCalendarDay).toBe(12);
  });

  it("is null before any day has completed", () => {
    expect(computeAverages({}, "2026-10-06").perWeekday).toBeNull();
    expect(computeAverages({ "2026-10-06": 3 }, "2026-10-06")).toEqual({
      perWeekday: null,
      perActiveDay: null,
      perCalendarDay: null,
      elapsedDays: null,
    });
  });
});
