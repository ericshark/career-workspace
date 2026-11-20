import { describe, expect, it } from "vitest";
import { sourceColor, SOURCE_COLOR } from "@/lib/sources";
import {
  NO_FILTERS,
  activeFilterCount,
  filterRows,
  isStale,
  nextDueDate,
  sortRows,
  viewCounts,
  weekStart,
} from "@/lib/trackerView";
import type { ApplicationRow } from "@/lib/types";

let n = 0;
function row(over: Partial<ApplicationRow> = {}): ApplicationRow {
  n++;
  return {
    date: "2026-10-06",
    company: `Co${n}`,
    role: "SWE",
    lane: "tech",
    resume: "tech",
    fit: "60",
    match: "",
    source: "LinkedIn",
    status: "applied",
    next: "",
    link: "",
    key: `k${n}`,
    lineIndex: n,
    ...over,
  };
}
const names = (rs: ApplicationRow[]) => rs.map((r) => r.company);
const TODAY = "2026-10-07";

describe("sortRows", () => {
  const rows = [
    row({ company: "beta", date: "2026-10-01", fit: "70" }),
    row({ company: "Alpha", date: "2026-10-05", fit: "" }),
    row({
      company: "gamma",
      date: "2026-10-03",
      fit: "55",
      status: "to apply",
    }),
  ];
  it("sorts by date newest first", () => {
    expect(names(sortRows(rows, "date", "desc"))).toEqual([
      "Alpha",
      "gamma",
      "beta",
    ]);
  });
  it("sorts by company case-insensitively", () => {
    expect(names(sortRows(rows, "company", "asc"))).toEqual([
      "Alpha",
      "beta",
      "gamma",
    ]);
  });
  it("puts unscored rows last in both directions", () => {
    expect(names(sortRows(rows, "fit", "desc"))).toEqual([
      "beta",
      "gamma",
      "Alpha",
    ]);
    expect(names(sortRows(rows, "fit", "asc"))).toEqual([
      "gamma",
      "beta",
      "Alpha",
    ]);
  });
});

describe("filterRows", () => {
  const rows = [
    row({ company: "Ramsey Labs", source: "Indeed" }),
    row({ company: "Figma", status: "screen" }), // legacy → in progress
    row({ company: "Old", date: "2026-09-01" }), // stale
    row({ company: "Done", status: "rejected", date: "2026-09-01" }),
    row({ company: "Mon", date: "2026-10-05" }), // Monday of TODAY's week
    row({ company: "Sun", date: "2026-10-04" }), // the Sunday before
  ];
  it("filters by search, view tab (legacy-aware), source and date range", () => {
    expect(names(filterRows(rows, { ...NO_FILTERS, q: "ram" }, TODAY))).toEqual(
      ["Ramsey Labs"],
    );
    expect(
      names(filterRows(rows, { ...NO_FILTERS, view: "in progress" }, TODAY)),
    ).toEqual(["Figma"]);
    expect(
      names(filterRows(rows, { ...NO_FILTERS, sources: ["indeed"] }, TODAY)),
    ).toEqual(["Ramsey Labs"]);
    expect(
      names(filterRows(rows, { ...NO_FILTERS, since: "week" }, TODAY)),
    ).toEqual(["Ramsey Labs", "Figma", "Mon"]);
    expect(
      names(filterRows(rows, { ...NO_FILTERS, since: "30d" }, TODAY)),
    ).toEqual(["Ramsey Labs", "Figma", "Mon", "Sun"]);
  });
  it("counts tabs under the same search/source/date filters", () => {
    const c = viewCounts(rows, NO_FILTERS, TODAY);
    expect([c.all, c.applied, c["in progress"], c.rejected]).toEqual([
      6, 4, 1, 1,
    ]);
    expect(viewCounts(rows, { ...NO_FILTERS, q: "old" }, TODAY).all).toBe(1);
  });
  it("counts only Filter-menu filters", () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        ...NO_FILTERS,
        q: "x",
        view: "applied",
        sources: ["a", "b"],
        since: "week",
      }),
    ).toBe(3);
  });
});

describe("nextDueDate", () => {
  it("reads the first ISO date from Next", () => {
    expect(nextDueDate(row({ next: "Interview by 2026-10-25" }))).toBe(
      "2026-10-25",
    );
    expect(nextDueDate(row({ next: "" }))).toBeNull();
  });
});

describe("weekStart", () => {
  it("is the Monday of the Mon→Sun week", () => {
    expect(weekStart("2026-10-07")).toBe("2026-10-05"); // Wednesday
    expect(weekStart("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday
  });
});

describe("No response", () => {
  it("has its own tab and count without being stale again", () => {
    const r = row({ status: "no response", date: "2026-09-01" });
    expect(
      filterRows([r], { ...NO_FILTERS, view: "no response" }, TODAY),
    ).toEqual([r]);
    expect(viewCounts([r], NO_FILTERS, TODAY)["no response"]).toBe(1);
    expect(viewCounts([r], NO_FILTERS, TODAY).rejected).toBe(0);
    expect(isStale(r, TODAY)).toBe(false);
  });
});

describe("isStale", () => {
  it("is applied rows 21+ days old only", () => {
    expect(isStale(row({ date: "2026-09-16" }), TODAY)).toBe(true); // 21 days
    expect(isStale(row({ date: "2026-09-17" }), TODAY)).toBe(false);
    expect(
      isStale(row({ date: "2026-09-01", status: "in progress" }), TODAY),
    ).toBe(false);
  });
});

describe("sourceColor", () => {
  it("uses fixed colors for known sources and a stable fallback otherwise", () => {
    expect(sourceColor("linkedin")).toBe(SOURCE_COLOR.LinkedIn);
    expect(sourceColor("Some Board")).toBe(sourceColor("Some Board"));
  });
});
