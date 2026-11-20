import { describe, expect, it } from "vitest";
import { savedHistoryFilter } from "@/lib/reviewPresentation";

describe("saved history filter", () => {
  it("defaults to summaries when no valid preference is saved", () => {
    for (const value of [null, undefined, "undecided", "all", {}, 1]) {
      expect(savedHistoryFilter(value)).toBe("summaries");
    }
  });

  it.each(["summaries", "reviews", "to-apply", "in-progress"])(
    "restores the selected %s filter",
    (value) => expect(savedHistoryFilter(value)).toBe(value),
  );
});
