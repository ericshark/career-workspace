import { describe, expect, it } from "vitest";
import {
  addMonths,
  heatLevel,
  monthGrid,
  monthLabel,
  relativeDay,
} from "@/lib/calendar";

describe("monthGrid", () => {
  it("October 2026 starts on a Thursday and fills whole weeks", () => {
    const g = monthGrid("2026-10");
    expect(g.slice(0, 4)).toEqual([null, null, null, null]);
    expect(g[4]).toEqual({ date: "2026-10-01", day: 1, weekend: false });
    expect(g.length % 7).toBe(0);
    expect(g.filter(Boolean)).toHaveLength(31);
    expect(g.find((c) => c?.date === "2026-10-03")?.weekend).toBe(true);
  });
  it("handles February in a leap year", () => {
    expect(monthGrid("2028-02").filter(Boolean)).toHaveLength(29);
  });
});

describe("month helpers", () => {
  it("shifts across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("labels a month", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
  it("buckets counts", () => {
    expect([0, 1, 2, 4, 5, 9].map(heatLevel)).toEqual([0, 1, 2, 2, 3, 3]);
  });
  it("formats relative days", () => {
    expect(relativeDay("2026-10-06", "2026-10-06")).toBe("today");
    expect(relativeDay("2026-10-05", "2026-10-06")).toBe("yesterday");
    expect(relativeDay("2026-10-01", "2026-10-06")).toBe("5d ago");
    expect(relativeDay("2026-09-20", "2026-10-06")).toBe("2w ago");
    expect(relativeDay("2026-06-01", "2026-10-06")).toBe("Jun 1");
  });
});
