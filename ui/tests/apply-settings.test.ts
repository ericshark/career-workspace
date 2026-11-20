import { expect, it } from "vitest";
import { salaryLabel } from "@/lib/jobMetadata";
import { conciseLocation } from "@/lib/location";
import { filterHistory } from "@/lib/reviewPresentation";
import { MIN_QUICK, hasContent } from "@/components/apply/useQuickDrafts";
import type { HistoryItem } from "@/lib/types";
it("keeps only numeric compensation and explicit units", () => {
  expect(salaryLabel("Salary: $100,000–$120,000 per year plus insurance")).toBe(
    "$100,000–$120,000/year",
  );
  expect(salaryLabel("$25 - $35 per hour plus benefits")).toBe(
    "$25 - $35/hour",
  );
  expect(salaryLabel("Flexible based on experience")).toBe("");
});
it("prefers boroughs and NJ cities while respecting explicit work arrangements", () => {
  expect(conciseLocation("New York, Brooklyn; Minnesota; Hybrid")).toBe(
    "Brooklyn · Hybrid",
  );
  expect(conciseLocation("Edison, NJ; Boston, MA")).toContain("Edison");
  expect(conciseLocation("Flexible", "flexible")).toBe("Flexible");
  expect(conciseLocation("Flexible work arrangement")).toBe("Flexible");
  expect(conciseLocation("New York; not remote")).not.toContain("Remote");
  expect(conciseLocation("Flexible pay based on experience")).not.toContain(
    "· Flexible",
  );
});
it("uses a 25 character threshold and distinguishes empty and URL-only cards", () => {
  expect(MIN_QUICK).toBe(25);
  expect(hasContent({ id: "1", url: " ", description: "\n " })).toBe(false);
  expect(
    hasContent({ id: "2", url: "https://example.com", description: "" }),
  ).toBe(true);
});
it("deduplicates linked summaries and keeps individual applied reviews", () => {
  const base = {
    id: "job",
    kind: "quick",
    status: "applied",
    savedAt: "2026-11-03T10:00:00Z",
  } as HistoryItem;
  const review = {
    ...base,
    id: "review",
    kind: "review",
    sourceRecordId: "job",
    savedAt: "2026-11-03T11:00:00Z",
  } as HistoryItem;
  const pending = {
    ...review,
    id: "pending",
    sourceRecordId: undefined,
    status: "not decided",
    decision: "undecided",
  } as HistoryItem;
  expect(
    filterHistory([base, review, pending], "summaries").map((i) => i.id),
  ).toEqual(["review"]);
  expect(
    filterHistory([base, review, pending], "reviews").map((i) => i.id),
  ).toEqual(["review"]);
  expect(
    filterHistory([base, review, pending], "to-apply").map((i) => i.id),
  ).toEqual(["pending"]);
});
