import { expect, it } from "vitest";
import { relativeActionDeadline } from "@/lib/actions";

it("counts receipt as day zero and preserves a requested window rather than inventing an expiry", () => {
  expect(
    relativeActionDeadline(
      "2026-10-29T04:23:42Z",
      5,
      "within 5 days of receipt; link does not expire",
    ),
  ).toEqual({
    date: "2026-11-03",
    kind: "requested",
    wording: "within 5 days of receipt; link does not expire",
  });
});
it("uses the New York receipt date across midnight and DST changes", () => {
  expect(
    relativeActionDeadline("2026-10-29T02:00:00Z", 5, "within 5 days").date,
  ).toBe("2026-11-02");
  expect(
    relativeActionDeadline(
      "2026-03-07T18:00:00-05:00",
      2,
      "expires within 2 days",
      "expires",
    ),
  ).toMatchObject({ date: "2026-03-09", kind: "expires" });
});
it("rejects an unverified receipt timestamp or invalid duration", () => {
  expect(() =>
    relativeActionDeadline("2026-10-29", 5, "within 5 days"),
  ).toThrow();
  expect(() =>
    relativeActionDeadline("2026-10-29T04:23:42Z", -1, "within 5 days"),
  ).toThrow();
});
