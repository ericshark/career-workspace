import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { localDate } from "../../src/lib/config";
test("activity expansion, scheduled timeline navigation and visible matching picker", async ({
  page,
  request,
}, info) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows[0];
  await request.patch("/api/applications", {
    data: { fileHash: apps.fileHash, key: row.key, status: "applied" },
  });
  const now = new Date().toISOString();
  // Tomorrow, so the server's real clock and the page's fake clock both see it as ahead.
  const scheduledAt = `${localDate(new Date(), 1)}T17:00:00.000Z`;
  const beforeInterview = new Date(Date.parse(scheduledAt) - 60_000);
  await page.clock.install({
    time: new Date(beforeInterview.getTime() - 60_000),
  });
  const dateAfter = (days: number) => {
    const day = new Date(`${localDate()}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
  };
  const id = "22222222-2222-4222-8222-222222222222";
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        ...[3, 2].map((days) => ({
          id:
            days === 2
              ? "33333333-3333-4333-8333-333333333333"
              : "44444444-4444-4444-8444-444444444444",
          externalKeys: [`gmail:deadline:${days}`],
          revision: 1,
          text: days === 2 ? "Send documents" : "Finish assessment",
          company: row.company,
          role: row.role,
          application: { rowKey: row.key },
          state: "open",
          deadline: { date: dateAfter(days), wording: "Requested deadline" },
          createdAt: now,
          updatedAt: now,
        })),
        {
          id,
          externalKeys: ["gmail:schedule:book"],
          revision: 1,
          text: "Book interview",
          company: row.company,
          role: row.role,
          application: { rowKey: row.key },
          state: "completed",
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(root, "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now,
      workflows: [],
      events: [
        {
          id: "interview-confirmed",
          kind: "interview",
          applicationKey: row.key,
          at: now,
          title: "Interview scheduled",
          description: "Confirmed interview",
          notify: true,
          seen: false,
          scheduledAt,
          scheduledEndAt: new Date(
            Date.parse(scheduledAt) + 60 * 60_000,
          ).toISOString(),
          responseExpected: false,
        },
        {
          id: "ordinary-rejection",
          kind: "rejected",
          applicationKey: "unmatched",
          at: now,
          title: "Routine rejection",
          description: "No recruiting progress",
          notify: true,
          seen: false,
        },
      ],
      pending: [
        {
          id: "gmail:pending:match",
          summary: "Match this recruiting request",
          company: "New company",
          reason: "Select the application",
          email: "https://mail.google.com/mail/u/0/#all/pending",
          receivedAt: now,
        },
      ],
    }),
  );
  for (const width of [1440, 390]) {
    await page.clock.setSystemTime(
      new Date(beforeInterview.getTime() - 10_000),
    );
    await page.clock.pauseAt(beforeInterview);
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/");
    await expect(
      page.getByText("Routine rejection", { exact: true }),
    ).toHaveCount(0);
    const calendar = page.getByRole("region", { name: "Deadline calendar" });
    // Stacked: no List/Calendar toggle; list rows are numbered like the days.
    await expect(
      calendar.getByRole("button", { name: "List", exact: true }),
    ).toHaveCount(0);
    const deadlineList = calendar.getByRole("list", {
      name: "Upcoming deadline list",
    });
    await expect(deadlineList.getByRole("link")).toHaveCount(3);
    await expect(deadlineList.getByLabel("Item 3")).toBeVisible();
    await expect(deadlineList.getByRole("link").nth(0)).toContainText(
      "Interview scheduled",
    );
    await expect(deadlineList.getByRole("link").nth(1)).toContainText(
      "Send documents",
    );
    await expect(deadlineList.getByRole("link").nth(2)).toContainText(
      "Finish assessment",
    );
    await expect(
      deadlineList
        .getByRole("link", { name: /Send documents/ })
        .locator("time"),
    ).toHaveAttribute("datetime", dateAfter(2));
    await page.screenshot({
      path: info.outputPath(`deadline-list-${width}.png`),
      fullPage: true,
    });
    await page.clock.fastForward(60 * 60_000);
    await expect(
      deadlineList.getByRole("link", { name: /Interview scheduled/ }),
    ).toBeVisible();
    await page.clock.fastForward(60_000);
    await expect(
      deadlineList.getByRole("link", { name: /Interview scheduled/ }),
    ).toHaveCount(0);
    await page.clock.resume();
    await page
      .getByRole("region", { name: "Deadline calendar" })
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(/actions.*view=activity/);
    await expect(
      page.getByRole("dialog").getByRole("list", { name: "Activity timeline" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByLabel("Action filters")
      .getByRole("button", { name: /^Decisions/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Match this recruiting request" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Choose matching application" })
      .click();
    const search = page.getByRole("combobox", { name: "Search applications" });
    await expect(search).toBeFocused();
    await expect(
      page.getByRole("option").filter({ hasText: row.role }).first(),
    ).toBeVisible();
    await search.fill("no such company");
    await expect(page.getByText("No matching applications.")).toBeVisible();
    await search.fill(row.company);
    await expect(
      page.getByRole("option").filter({ hasText: row.role }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`matching-dropdown-${width}.png`),
      fullPage: true,
    });
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(
      page.getByRole("button", { name: "Choose matching application" }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Confirm application" }),
    ).toBeEnabled();
    await page.screenshot({
      path: info.outputPath(`matching-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Dismiss request" }).click();
  await expect(
    page.getByRole("heading", { name: "Match this recruiting request" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Match this recruiting request" }),
  ).toHaveCount(0);
});

test("opens interview history without a task and keeps in-progress rejections dismissible", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows[0];
  const now = new Date().toISOString();
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const saveEvents = (events: object[]) =>
    fs.writeFileSync(
      path.join(root, "records/recruiting.json"),
      JSON.stringify({
        version: 1,
        startedAt: now,
        workflows: [],
        events,
        pending: [],
      }),
    );
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({ version: 1, importedNext: true, actions: [] }),
  );
  const base = {
    applicationKey: row.key,
    at: now,
    notify: true,
    seen: false,
    description: "",
  };
  saveEvents([
    {
      ...base,
      id: "ordinary-rejection",
      kind: "rejected",
      title: "Ordinary rejection",
      wasInProgress: false,
    },
    {
      ...base,
      id: "progress-rejection",
      kind: "rejected",
      title: "Rejection after progress",
      wasInProgress: true,
    },
  ]);
  await page.goto("/");
  const updates = page.getByRole("region", { name: "Recruiting updates" });
  await expect(updates.getByTitle("Unsuccessful")).toBeVisible();
  await expect(
    updates.getByRole("button", { name: "Dismiss Ordinary rejection" }),
  ).toHaveCount(0);
  await updates
    .getByRole("button", { name: "Dismiss Rejection after progress" })
    .click();
  await expect(updates.getByTitle("Unsuccessful")).toHaveCount(0);
  await page.reload();
  await expect(updates.getByText("No new recruiting updates.")).toBeVisible();

  saveEvents([
    {
      ...base,
      id: "interview-only",
      kind: "interview",
      title: "Recruiter interview",
      scheduledAt,
    },
  ]);
  await page.reload();
  const calendar = page.getByRole("region", { name: "Deadline calendar" });
  if (localDate(new Date(scheduledAt)).slice(0, 7) !== localDate().slice(0, 7))
    await calendar.getByRole("button", { name: "Next month" }).click();
  await calendar.getByRole("button", { name: /1 items/ }).click();
  const scheduled = calendar.getByRole("link", { name: /Recruiter interview/ });
  await expect(scheduled.locator("time").first()).toHaveAttribute(
    "datetime",
    scheduledAt,
  );
  await scheduled.click();
  await expect(page).toHaveURL(/actions\?application=.*view=activity/);
  await expect(
    page.getByRole("dialog").getByLabel("Activity timeline"),
  ).toContainText("Recruiter interview");
});
