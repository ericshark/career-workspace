import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("the invitation and completion keep their dates when the interview is confirmed", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const added = await request.post("/api/quick", {
    data: {
      source: "LinkedIn",
      jobs: [
        {
          description:
            "CrossCountry fixture\nCompany information for a recruiter screening.",
          link: "https://example.test/appointment-role",
        },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  const recordId = (await added.json()).added[0].quickId;
  const { rows } = await (await request.get("/api/applications")).json();
  const row = rows.find(
    (candidate: { recordId: string }) => candidate.recordId === recordId,
  );
  const id = "11111111-1111-4111-8111-111111111119";
  const at = new Date(Date.now() - 86400000).toISOString();
  const scheduledAt = new Date(Date.now() + 86400000).toISOString();
  const email = "https://mail.google.com/mail/u/0/#all/original";
  const original = {
    id: "request:gmail:original:screen",
    kind: "requested",
    at,
    title: "Schedule recruiter screen",
    description: "Choose a time",
    email,
  };
  const completed = {
    ...original,
    at: new Date(Date.parse(at) + 3600000).toISOString(),
    id: `action:${id}:completed:1`,
    kind: "completed",
    title: "Schedule recruiter screen — Completed",
  };
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        {
          id,
          externalKeys: ["gmail:original:screen"],
          revision: 2,
          text: original.title,
          state: "completed",
          createdAt: at,
          updatedAt: at,
          completedAt: completed.at,
          application: { rowKey: row.key, recordId: row.recordId || undefined },
          recruitingEvents: [original, completed],
        },
      ],
    }),
  );
  const event = {
    applicationKey: row.key,
    recordId: row.recordId || undefined,
    at,
    notify: true,
    seen: false,
    description: "",
  };
  const title = "Recruiter screen scheduled";
  fs.writeFileSync(
    path.join(root, "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: at,
      pending: [],
      workflows: [],
      events: [
        {
          ...event,
          id: "gmail:original:interview",
          kind: "interview",
          title: "Recruiter screen invitation",
          email,
        },
        {
          ...event,
          id: "gmail:confirmation:interview",
          at: new Date(Date.parse(completed.at) + 3600000).toISOString(),
          kind: "interview",
          title,
          scheduledAt,
          email: "https://mail.google.com/mail/u/0/#all/confirmation",
          appointment: { id: "fixture-calendar", actionId: id },
        },
      ],
    }),
  );
  for (const route of ["/api/actions", "/api/recruiting"]) {
    const result = await request.get(route);
    expect(result.ok(), await result.text()).toBe(true);
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page
        .getByRole("list", { name: "Upcoming deadline list" })
        .getByText(title),
    ).toHaveCount(1);
    await expect(
      page.getByText("Recruiter screen invitation", { exact: false }),
    ).toHaveCount(0);
    await page
      .getByRole("list", { name: "Upcoming deadline list" })
      .getByRole("link", { name: new RegExp(title) })
      .click();
    const dialog = page.getByRole("dialog");
    const timeline = dialog.getByRole("list", { name: "Activity timeline" });
    // The task is one entry: the request, now marked completed.
    await expect(
      timeline.getByText(original.title, { exact: false }),
    ).toHaveCount(1);
    await expect(timeline.getByText(/^Marked completed /)).toHaveCount(1);
    await expect(
      timeline.getByText("Recruiter screen invitation", { exact: true }),
    ).toHaveCount(0);
    await expect(
      timeline.locator('a[href$="confirmation"]').getByText("View email"),
    ).toHaveCount(1);
    await expect(timeline.locator('a[href$="original"]')).toHaveCount(1);
    await expect(timeline.getByText("Applied", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `.cache/playwright/recruiting-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("a proposed interview time shows as Proposed, and replies and receipts are their own Timeline lines", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const added = await request.post("/api/quick", {
    data: {
      source: "LinkedIn",
      jobs: [
        {
          description:
            "ProposedCo fixture\nCompany information for a recruiter screening.",
          link: "https://example.test/proposed-role",
        },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  const recordId = (await added.json()).added[0].quickId;
  const { rows } = await (await request.get("/api/applications")).json();
  const row = rows.find(
    (candidate: { recordId: string }) => candidate.recordId === recordId,
  );
  const id = "11111111-1111-4111-8111-111111111120";
  const at = new Date(Date.now() - 2 * 86400000).toISOString();
  const later = (hours: number) =>
    new Date(Date.parse(at) + hours * 3600000).toISOString();
  const scheduledAt = new Date(Date.now() + 2 * 86400000).toISOString();
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        {
          id,
          externalKeys: ["gmail:proposed:screen"],
          revision: 2,
          text: "Reply with times for the recruiter screen",
          requestKind: "scheduling",
          state: "completed",
          createdAt: at,
          updatedAt: later(2),
          completedAt: later(2),
          application: { rowKey: row.key, recordId: row.recordId || undefined },
          email: {
            threadId: "proposed",
            messageId: "request",
            url: "https://mail.google.com/mail/u/0/#all/request",
            receivedAt: at,
          },
        },
      ],
    }),
  );
  const base = {
    applicationKey: row.key,
    recordId: row.recordId || undefined,
    seen: false,
    description: "",
  };
  fs.writeFileSync(
    path.join(root, "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: at,
      pending: [],
      workflows: [],
      events: [
        {
          ...base,
          id: "gmail:sent:reply",
          at: later(1),
          kind: "response",
          title: "Sent your available times",
          taskId: id,
          evidenceRole: "sent",
          notify: false,
          email: "https://mail.google.com/mail/u/0/#all/sent",
        },
        {
          ...base,
          id: "gmail:receipt:reply",
          at: later(3),
          kind: "response",
          title: "Recruiter thanked you for the times",
          taskId: id,
          evidenceRole: "receipt",
          notify: false,
          email: "https://mail.google.com/mail/u/0/#all/receipt",
        },
        {
          ...base,
          id: "gmail:sent:proposal",
          at: later(1),
          kind: "interview",
          title: "Recruiter screen",
          scheduledAt,
          notify: false,
          email: "https://mail.google.com/mail/u/0/#all/sent",
          appointment: { id: "screen", actionId: id, proposed: true },
        },
      ],
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const upcoming = page.getByRole("list", { name: "Upcoming deadline list" });
    await expect(upcoming.getByText("Recruiter screen")).toBeVisible();
    await expect(
      upcoming.getByText(/Proposed, awaiting confirmation/),
    ).toBeVisible();
    // Your own proposal and routine receipts are not Updates.
    await expect(
      page
        .getByRole("region", { name: "Recruiting updates" })
        .getByText("No new recruiting updates."),
    ).toBeVisible();

    await page.goto("/actions?filter=completed");
    const card = page.locator("section").filter({ hasText: "ProposedCo" });
    await expect(
      card.getByRole("listitem", { name: "Proposed interview" }),
    ).toContainText("Proposed by you · awaiting confirmation");
    // A proposal replaces the "details after the next check" placeholder.
    await expect(card.getByText("Scheduled interview")).toHaveCount(0);

    await card.getByRole("button", { name: "Timeline", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const timeline = dialog.getByRole("list", { name: "Activity timeline" });
    await expect(
      dialog.getByText("Interview proposed · awaiting confirmation", {
        exact: true,
      }),
    ).toBeVisible();
    const replied = timeline
      .getByRole("listitem")
      .filter({ hasText: "Sent your available times" });
    await expect(replied.getByLabel("You replied")).toBeVisible();
    await expect(replied).toContainText(
      "For: Reply with times for the recruiter screen",
    );
    const receipt = timeline
      .getByRole("listitem")
      .filter({ hasText: "Recruiter thanked you for the times" });
    await expect(receipt.getByLabel("Confirmation received")).toBeVisible();
    const task = timeline
      .getByRole("listitem")
      .filter({ hasText: "Reply with times for the recruiter screen" })
      .filter({ hasText: "Marked completed" });
    await expect(task).toHaveCount(1);
    await expect(task.getByLabel("Task completed")).toBeVisible();
    await expect(
      task.getByRole("link", { name: "Request email" }),
    ).toHaveAttribute("href", "https://mail.google.com/mail/u/0/#all/request");
    await expect(
      timeline
        .getByRole("listitem")
        .filter({ hasText: "Proposed by you · awaiting confirmation" })
        .getByLabel("Proposed interview"),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "What the timeline icons mean" })
      .click();
    await expect(
      page.getByText("Timeline icons", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `.cache/playwright/proposed-timeline-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
