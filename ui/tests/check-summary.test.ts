import { it, expect } from "vitest";
import { compactAge, summarizeCheck } from "../src/lib/checkSummary";
import type { RecruitingEvent } from "../src/lib/recruitingTypes";
it("counts newly captured events rather than historical email dates, excluding duplicates and routine receipts", () => {
  const make = (
    id: string,
    kind: RecruitingEvent["kind"],
    discoveredAt?: string,
  ): RecruitingEvent => ({
    id,
    applicationKey: "a",
    kind,
    at: "2025-01-01",
    title: id,
    description: "",
    notify: true,
    seen: false,
    discoveredAt,
  });
  const start = "2026-11-03T12:00:00Z",
    end = "2026-11-03T13:00:00Z";
  const response = make("response", "response", start);
  expect(
    summarizeCheck(
      [
        response,
        response,
        make("reject", "rejected", end),
        make("reject-again", "rejected", end),
        make("waiting:a:episode", "response", end),
        make("receipt", "submitted", start),
        make("task", "requested", start),
        make("legacy", "response"),
        make("old", "response", "2026-11-02T12:00:00Z"),
      ],
      start,
      end,
      4,
    ),
  ).toEqual({ newActions: 4, newUpdates: 2, newRejections: 1 });
});
it("counts a rejection once per application unless the application was reopened", () => {
  const start = "2026-11-03T12:00:00Z",
    end = "2026-11-03T13:00:00Z";
  const rejection = (
    id: string,
    at: string,
    discoveredAt: string,
    applicationKey = "a",
  ): RecruitingEvent => ({
    id,
    applicationKey,
    kind: "rejected",
    at,
    title: id,
    description: "",
    notify: true,
    seen: false,
    discoveredAt,
  });
  const known = rejection(
    "old",
    "2026-10-01T12:00:00Z",
    "2026-10-01T12:00:00Z",
  );
  const again = rejection("again", "2026-11-03T11:00:00Z", start);
  const other = rejection("other", "2026-11-03T11:00:00Z", start, "b");
  // A second rejection email for an application already closed is not new.
  expect(
    summarizeCheck([known, again, other], start, end, 0).newRejections,
  ).toBe(1);
  // Unsuccessful or unfollowed applications still count (no notificationEligible filter).
  expect(
    summarizeCheck([{ ...other, notificationEligible: false }], start, end, 0)
      .newRejections,
  ).toBe(1);
  // After a reopen, the earlier closure no longer makes the new one stale.
  expect(
    summarizeCheck([known, again, other], start, end, 0, [
      { applicationKey: "a", reopenedAt: "2026-10-15T12:00:00Z" },
    ]).newRejections,
  ).toBe(2);
});
it("uses compact elapsed time and New York calendar dates", () => {
  expect(
    compactAge("2026-11-04T02:00:00Z", new Date("2026-11-04T02:32:00Z")),
  ).toBe("32 min ago · Nov 3");
  expect(
    compactAge("2026-11-03T12:00:00Z", new Date("2026-11-03T14:00:00Z")),
  ).toBe("2 hr ago · Nov 3");
  expect(
    compactAge("2026-11-01T12:00:00Z", new Date("2026-11-03T14:00:00Z")),
  ).toBe("2 d ago · Nov 1");
});

it("counts a mirrored invitation only as a new action", () => {
  const at = "2026-11-10T20:19:14Z";
  const request: RecruitingEvent = {
    id: "request:gmail:thread:screen",
    applicationKey: "crosscountry",
    kind: "requested",
    at,
    discoveredAt: at,
    title: "Schedule the screen",
    description: "",
    email: "https://mail.google.com/mail/u/0/#all/thread",
    notify: true,
    seen: false,
  };
  const invitation: RecruitingEvent = {
    ...request,
    kind: "interview",
    id: "gmail:thread:interview",
    title: "Recruiter screen invitation",
  };
  const confirmation: RecruitingEvent = {
    ...invitation,
    id: "gmail:confirmation:interview",
    scheduledAt: "2026-11-17T15:40:00Z",
  };
  expect(summarizeCheck([request, invitation], at, at, 1).newUpdates).toBe(0);
  expect(
    summarizeCheck([request, invitation, confirmation], at, at, 1).newUpdates,
  ).toBe(1);
});
it("lists only undismissed, notifying updates once each", async () => {
  const { activeRecruitingUpdates } = await import("../src/lib/checkSummary");
  const make = (
    id: string,
    extra: Partial<RecruitingEvent> = {},
  ): RecruitingEvent => ({
    id,
    applicationKey: "a",
    kind: "response",
    at: "2026-01-01",
    title: id,
    description: "",
    notify: true,
    seen: false,
    ...extra,
  });
  const events = [
    make("a"),
    make("a"),
    make("seen", { seen: true }),
    make("quiet", { notify: false }),
    make("rej", { kind: "rejected" }),
    make("rej2", { kind: "rejected", wasInProgress: true }),
  ];
  expect(
    activeRecruitingUpdates(events)
      .map((e) => e.id)
      .sort(),
  ).toEqual(["a", "rej2"]);
});

it("leaves task activity to the action card but keeps other news on the Dashboard", async () => {
  const { activeRecruitingUpdates } = await import("../src/lib/checkSummary");
  const make = (
    id: string,
    kind: RecruitingEvent["kind"],
  ): RecruitingEvent => ({
    id,
    applicationKey: "a",
    kind,
    at: "2026-01-01",
    title: id,
    description: "",
    notify: true,
    seen: false,
  });
  const events = [
    make("action:task-1:activity:m1", "requested"),
    make("action:gone:activity:m2", "requested"),
    make("interview", "interview"),
  ];
  const ids = (taskIds?: Set<string>) =>
    activeRecruitingUpdates(events, taskIds)
      .map((e) => e.id)
      .sort();
  // Without task ids both activity events count; with them, only unknown-task activity and real news remain.
  expect(ids()).toEqual([
    "action:gone:activity:m2",
    "action:task-1:activity:m1",
    "interview",
  ]);
  expect(ids(new Set(["task-1"]))).toEqual([
    "action:gone:activity:m2",
    "interview",
  ]);
});
