import { describe, it, expect } from "vitest";
import type { RecruitingView } from "../src/lib/recruitingTypes";
import {
  actionJobLink,
  deadlineItems,
  upcomingDeadlineItems,
  rankedPreview,
  completedNewest,
  decisionItems,
  openViewTotal,
} from "../src/lib/recruitingPresentation";
import { monthGrid, addMonths } from "../src/lib/calendar";
import type { ActionsPayload, InboxAction } from "../src/lib/actionTypes";
const task = (id: string, extra: Partial<InboxAction> = {}): InboxAction => ({
  id,
  text: id,
  state: "open",
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-10-01T12:00:00Z",
  revision: 1,
  externalKeys: [],
  ...extra,
});
const payload = (actions: InboxAction[]): ActionsPayload => ({
  version: 1,
  importedNext: false,
  fileHash: "test",
  actions,
});
describe("recruiting presentation", () => {
  it("keeps date-only deadlines stable and buckets instants by New York date across DST", () => {
    const items = deadlineItems(
      payload([
        task("date", { deadline: { date: "2026-11-03", wording: "Tuesday" } }),
        task("instant", {
          deadline: {
            date: "2026-11-04",
            at: "2026-11-04T02:00:00Z",
            wording: "evening",
          },
        }),
        task("dst", {
          deadline: {
            date: "2026-03-08",
            at: "2026-03-08T06:30:00Z",
            wording: "explicit",
          },
        }),
        task("done", {
          state: "completed",
          deadline: { date: "2026-11-03", wording: "Tuesday" },
        }),
      ]),
      null,
      new Date("2026-11-04T03:00:00Z"),
    );
    expect(items.filter((i) => i.date === "2026-11-03")).toHaveLength(2);
    expect(items.find((i) => i.id === "date")?.overdue).toBe(false);
    expect(items.find((i) => i.id === "instant")?.overdue).toBe(true);
    expect(items.find((i) => i.id === "dst")?.date).toBe("2026-03-08");
    expect(items.some((i) => i.id === "done")).toBe(false);
    const nextDay = new Date("2026-11-04T05:00:00Z");
    const open = [
      task("date", { deadline: { date: "2026-11-03", wording: "Tuesday" } }),
      task("timed", {
        deadline: {
          date: "2026-11-03",
          at: "2026-11-04T02:00:00Z",
          wording: "evening",
        },
      }),
    ];
    const list = (actions: InboxAction[]) =>
      upcomingDeadlineItems(
        deadlineItems(payload(actions), null, nextDay),
        nextDay,
      );
    expect(list(open).map(({ id, overdue }) => [id, overdue])).toEqual([
      ["date", true],
      ["timed", true],
    ]);
    expect(
      list(open.map((action) => ({ ...action, state: "completed" }))),
    ).toEqual([]);
  });
  it("ranks overdue work before upcoming, then newest received, and limits previews (no priority)", () => {
    const tasks = [
      task("older", { priority: "high", createdAt: "2026-10-01T12:00:00Z" }),
      task("newer", { priority: "low", createdAt: "2026-10-20T12:00:00Z" }),
      task("soon", { deadline: { date: "2026-11-05", wording: "soon" } }),
      task("late", { deadline: { date: "2026-11-01", wording: "late" } }),
    ];
    expect(
      rankedPreview(
        tasks,
        payload(tasks),
        new Date("2026-11-03T18:00:00Z"),
      ).map((i) => i.id),
    ).toEqual(["late", "soon", "newer"]);
  });
  it("sorts completions with stable identity ties without mutating input", () => {
    const tasks = [
      task("b", { completedAt: "2026-11-03T12:00:00Z" }),
      task("a", { completedAt: "2026-11-03T12:00:00Z" }),
      task("old", { completedAt: "2026-11-01T12:00:00Z" }),
    ];
    expect([...tasks].sort(completedNewest).map((i) => i.id)).toEqual([
      "a",
      "b",
      "old",
    ]);
    expect(tasks[0].id).toBe("b");
  });
  it("handles leap years and month/year rollover", () => {
    expect(monthGrid("2028-02").filter(Boolean)).toHaveLength(29);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
  });
  it("uses only current schedules, deduplicates event mirrors, and excludes closed deadlines", () => {
    const scheduledAt = "2026-11-05T04:30:00Z";
    const view = {
      rows: [
        { key: "active", company: "Acme", role: "Engineer" },
        { key: "closed", company: "Closed Co", role: "Engineer" },
      ],
      actions: [],
      workflows: [
        { applicationKey: "active", scheduledAt },
        {
          applicationKey: "closed",
          closure: "rejected",
          scheduledAt,
        },
      ],
      events: [
        {
          id: "old",
          applicationKey: "active",
          scheduledAt: "2026-11-04T15:00:00Z",
          at: "2026-11-01T12:00:00Z",
          title: "Old interview",
        },
        {
          id: "current",
          applicationKey: "active",
          scheduledAt,
          at: "2026-11-02T12:00:00Z",
          title: "Confirmed interview",
        },
        {
          id: "mirror",
          applicationKey: "active",
          scheduledAt,
          at: "2026-11-02T12:00:00Z",
          title: "Confirmed interview",
        },
      ],
    } as unknown as RecruitingView;
    const items = deadlineItems(
      payload([
        task("closed-deadline", {
          application: { rowKey: "closed" },
          deadline: { date: "2026-11-05", wording: "explicit" },
        }),
      ]),
      view,
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Confirmed interview");
    expect(items[0].date).toBe("2026-11-04");
    expect(
      upcomingDeadlineItems(items, new Date("2026-11-05T04:29:59Z")),
    ).toEqual(items);
    expect(
      upcomingDeadlineItems(items, new Date("2026-11-05T04:59:59Z")),
    ).toEqual(items);
    expect(
      upcomingDeadlineItems(items, new Date("2026-11-05T05:00:00Z")),
    ).toEqual([]);
  });
});

it("orders deadlines by actual instant through the repeated New York hour", () => {
  const date = "2026-11-01";
  const items = deadlineItems(
    payload([
      task("est", {
        deadline: { date, at: "2026-11-01T01:00:00-05:00", wording: "EST" },
      }),
      task("edt", {
        deadline: { date, at: "2026-11-01T01:30:00-04:00", wording: "EDT" },
      }),
    ]),
    null,
  );
  expect(items.map((item) => item.id)).toEqual(["edt", "est"]);
});

it("prefers the tracker posting, then an action URL, and ignores unsafe URLs", () => {
  const action = task("link", {
    publicLink: { url: "https://acme.test/careers", kind: "careers" },
  });
  const row = {
    link: "https://acme.test/jobs/1",
  } as import("../src/lib/types").ApplicationRow;
  expect(actionJobLink(action, row)).toBe(row.link);
  expect(actionJobLink(action, { ...row, link: "javascript:alert(1)" })).toBe(
    action.publicLink?.url,
  );
  expect(actionJobLink(task("missing"))).toBeUndefined();
});

describe("numberedUpcoming", () => {
  const item = (
    id: string,
    date: string,
    extra: Partial<
      import("../src/lib/recruitingPresentation").CalendarItem
    > = {},
  ) => ({
    id,
    date,
    company: "Acme",
    role: "Engineer",
    title: id,
    href: "/actions",
    overdue: false,
    ...extra,
  });
  it("numbers active items in list order and drops past appointments", async () => {
    const { numberedUpcoming } =
      await import("../src/lib/recruitingPresentation");
    const now = new Date("2026-11-12T17:00:00Z");
    const result = numberedUpcoming(
      [
        // A finished interview: more than an hour after its start time.
        item("past-interview", "2026-11-04", {
          at: "2026-11-04T15:00:00Z",
          upcomingUntil: Date.parse("2026-11-04T16:00:00Z"),
        }),
        item("overdue-task", "2026-11-10", { overdue: true }),
        item("screen", "2026-11-17", {
          at: "2026-11-17T15:40:00Z",
          upcomingUntil: Date.parse("2026-11-17T16:40:00Z"),
        }),
        item("deadline", "2026-11-20"),
      ],
      now,
    );
    expect(result.map((r) => [r.id, r.number])).toEqual([
      ["overdue-task", 1],
      ["screen", 2],
      ["deadline", 3],
    ]);
    expect(result[0].overdue).toBe(true);
  });

  describe("decisions", () => {
    const row = {
      key: "row-1",
      company: "Acme",
      role: "Engineer",
      status: "applied",
    };
    const pending = (id: string, extra: object = {}) => ({
      id,
      summary: id,
      reason: "why",
      email: `https://mail.google.com/mail/u/0/#all/${id}`,
      receivedAt: "2026-11-10T12:00:00Z",
      ...extra,
    });
    const recruiting = (items: object[]) =>
      ({
        rows: [row],
        workflows: [],
        events: [],
        pending: items,
      }) as unknown as RecruitingView;
    const rejected = { kind: "rejected", at: "2026-11-10T12:00:00Z" };

    it("labels held rejections as routine and held requests as important", () => {
      const items = decisionItems(
        null,
        recruiting([
          pending("decline", { event: rejected, matchIssue: "no-role" }),
          pending("assessment", { action: { text: "Take the assessment" } }),
        ]),
        [],
      );
      expect(items.map((i) => [i.kind, i.important])).toEqual([
        ["rejection", false],
        ["request", true],
      ]);
      expect(items[0]).toMatchObject({ issue: "no-role" });
    });

    it("marks an unresolved suggestion and ignores processed items", () => {
      const items = decisionItems(
        null,
        recruiting([
          pending("sure", {
            event: rejected,
            suggestedApplication: { rowKey: "row-1" },
          }),
          pending("gone", { event: rejected, processed: true }),
        ]),
        [],
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ kind: "rejection", issue: "suggested" });
    });

    it("includes unlinked tasks and mail reviews as important, and keeps them out of Open", () => {
      const actions = payload([
        task("linked", { application: { rowKey: "row-1" } }),
        task("orphan"),
      ]);
      const view = recruiting([]);
      const items = decisionItems(actions, view, [
        { messageId: "m", summary: "Unclear", url: "u", reviewReason: "?" },
      ]);
      expect(items.map((i) => [i.kind, i.important])).toEqual([
        ["unlinked-task", true],
        ["email-review", true],
      ]);
      expect(openViewTotal(actions, view)).toBe(1);
    });
  });
});
