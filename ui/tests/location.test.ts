import { expect, it } from "vitest";
import { compareReceivedNewest, type InboxAction } from "@/lib/actionTypes";
import { conciseLocation } from "@/lib/location";
it.each([
  ["Boston, MA; Manhattan, NY; Hybrid", "", "Manhattan · Hybrid"],
  ["Remote · United States", "", "Remote · United States"],
  ["Boston, MA", "onsite", "Boston, MA · In person"],
  ["regional and office expectations may vary", "", "Unknown"],
  ["Brooklyn, NY", "", "Brooklyn"],
])("formats explicit location %s", (text, mode, expected) => {
  expect(conciseLocation(text, mode)).toBe(expected);
});

it("sorts completion history by receipt rather than completion, with creation fallback and stable ties", () => {
  const actions = [
    {
      id: "b",
      createdAt: "2026-01-01",
      completedAt: "2026-12-01",
      email: { receivedAt: "2026-01-02T10:00:00Z" },
    },
    { id: "a", createdAt: "2026-01-03T10:00:00Z", completedAt: "2026-01-04" },
    {
      id: "c",
      createdAt: "2026-01-01",
      email: { receivedAt: "2026-01-02T10:00:00Z" },
    },
  ] as InboxAction[];
  expect(actions.sort(compareReceivedNewest).map((a) => a.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
});
