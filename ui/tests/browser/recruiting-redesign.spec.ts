import { localDate } from "../../src/lib/config";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
test("redesigned recruiting views preserve interactions across viewports", async ({
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
  const make = (n: number, state = "open") => ({
    id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
    externalKeys: [`gmail:design:${n}`],
    revision: 1,
    text: n === 1 ? "Complete technical assessment" : `Recruiter screen ${n}`,
    company: row.company,
    role: row.role,
    application: { rowKey: row.key },
    state,
    createdAt: now,
    updatedAt: now,
    ...(state === "completed" ? { completedAt: now } : {}),
    priority: "high",
    explanation: "A short recruiting task description.",
    email: {
      messageId: `design-${n}`,
      threadId: "design",
      receivedAt: now,
      url: "https://mail.google.com/mail/u/0/#all/design",
    },
    ...(n === 1
      ? {
          deadline: {
            date: localDate(new Date(now)),
            at: now,
            wording: "explicit deadline",
          },
        }
      : {}),
  });
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      lastCheck: {
        runId: "design-fixture",
        startedAt: now,
        completedAt: now,
        changes: [{ id: make(1).id, activityId: "design-1", kind: "new" }],
      },
      actions: [make(1), make(2, "completed"), make(3, "completed"), make(4)],
    }),
  );
  fs.writeFileSync(
    path.join(root, "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now,
      events: [
        {
          id: "confirmed-design",
          applicationKey: row.key,
          kind: "response",
          at: now,
          title: "Assessment received",
          description: "The employer confirmed receipt.",
          email: "https://mail.google.com/mail/u/0/#all/design",
          notify: true,
          seen: false,
        },
      ],
      workflows: [],
      pending: [],
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Open cards are job cards; a task row lives inside its job's card.
  const cardOf = (id: string) =>
    page.locator("section").filter({ has: page.locator(`#action-${id}`) });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Deadline calendar" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What to do next" }),
    ).toHaveCount(0);
    const preview = page.getByRole("region", { name: "Actions overview" });
    await expect(
      preview.getByRole("link", { name: "View Email" }).first(),
    ).toHaveAttribute("href", "https://mail.google.com/mail/u/0/#all/design");
    await expect(
      preview.getByRole("button", { name: "Job Summary" }).first(),
    ).toBeEnabled();
    // Priority was removed from Actions and the Dashboard preview.
    await expect(preview.getByText(/^(High|Medium|Low)$/)).toHaveCount(0);
    // Stacked calendar: month navigation only, no List/Calendar toggle.
    await page.getByRole("button", { name: "Next month" }).click();
    await page.getByRole("button", { name: "Previous month" }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(`dashboard-${width}.png`),
      fullPage: true,
    });
    await page.goto("/actions?filter=all");
    await expect(
      page.getByRole("heading", {
        name: "Complete technical assessment",
        exact: true,
      }),
    ).toBeVisible();
    // The Dashboard visit above already saved the New markers as seen.
    await expect(page.getByText("New", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`open-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Timeline", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("list", { name: "Activity timeline" }),
    ).toBeVisible();
    const status = dialog.getByText("Action needed · 1 tasks", { exact: true });
    await expect(status.locator("svg")).toHaveClass(/text-warning/);
    const timeline = dialog.getByRole("list", { name: "Activity timeline" });
    const applied = timeline.getByRole("listitem").last();
    await expect(applied.getByRole("heading")).toHaveText("Applied");
    await expect(applied.locator("time")).toHaveCount(1);
    await expect(
      applied.getByText(`Via ${row.source}`, { exact: true }),
    ).toBeVisible();
    const requested = timeline
      .getByRole("listitem")
      .filter({ hasText: "Complete technical assessment" });
    await expect(requested.locator("svg.lucide-list-todo")).toBeVisible();
    await dialog.getByRole("button", { name: "Job Info", exact: true }).click();
    await dialog.getByRole("button", { name: "Timeline", exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`timeline-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Completed/ }).click();
    await expect(
      page.getByText("Recruiter screen 2", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`completed-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByLabel("Action filters")
    .getByRole("button", { name: /^Open/ })
    .click();
  const edited = cardOf(make(1).id);
  if (row.link)
    await expect(edited.locator(`a[href="${row.link}"]`).first()).toBeVisible();
  await edited
    .getByRole("button", {
      name: "Edit linked application: Complete technical assessment",
    })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit linked application" });
  await editor.getByLabel("Action title override").fill("Corrected role");
  await editor.getByRole("button", { name: "Confirm application" }).click();
  await expect(editor).toHaveCount(0);
  await expect(edited.getByText("Corrected role")).toBeVisible();
  await page
    .getByLabel("Action filters")
    .getByRole("button", { name: /^Completed/ })
    .click();
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await page.locator("summary").filter({ hasText: "View hidden" }).click();
  await expect(
    page
      .getByLabel("Hidden action history")
      .getByRole("button", { name: "Unhide", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Unhide", exact: true }).click();
  await page
    .getByLabel("Action filters")
    .getByRole("button", { name: /^Open/ })
    .click();
  await page.getByLabel("Search actions").fill("no matching recruiting task");
  await expect(
    page.getByText("No actions match your search.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search actions").fill("");
  await expect(page.getByRole("button", { name: /^Priority:/ })).toHaveCount(0);
  await cardOf(make(1).id)
    .getByRole("button", { name: "Job Summary", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Job Info", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page
    .locator(`#action-${make(1).id}`)
    .getByRole("button", { name: "Mark Completed", exact: true })
    .click();
  await page.getByRole("button", { name: /Confirm completion:/ }).click();
  await expect(page.locator(`#action-${make(1).id}`)).toHaveCount(0);
  await page.goto("/actions?filter=all");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByRole("button", { name: /Confirm dismissal:/ }).click();
  await expect(
    page.getByText("Recruiter screen 4", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/");
  const updates = page.getByRole("region", { name: "Recruiting updates" });
  // The dashboard already showed this update on earlier visits, so its dot is gone.
  await expect(updates.getByLabel("Read update")).toBeAttached();
  await page
    .context()
    .route("https://mail.google.com/**", (route) =>
      route.fulfill({ body: "Test mail", contentType: "text/plain" }),
    );
  const popupPromise = page.waitForEvent("popup");
  await updates.getByRole("link", { name: "View Email", exact: true }).click();
  const popup = await popupPromise;
  await popup.close();
  await expect(updates.getByLabel("Read update")).toBeAttached();
  await updates
    .getByRole("button", { name: "Job Summary", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/");
  await expect(
    page
      .getByRole("region", { name: "Recruiting updates" })
      .getByLabel("Read update"),
  ).toBeAttached();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Recruiting updates" })
      .getByRole("heading", { name: "Updates" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Dismiss Assessment received", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Dismiss Assessment received",
      exact: true,
    }),
  ).toHaveCount(0);
  const current = await (await request.get("/api/applications")).json();
  await request.patch("/api/applications", {
    data: { fileHash: current.fileHash, key: row.key, status: "rejected" },
  });
  await page.goto("/actions");
  await page.getByRole("button", { name: /^Closed/ }).click();
  await expect(page.getByText(/Recorded closed/)).toBeVisible();
  await expect(
    page.getByText("Recruiter screen 2", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("closed-390.png"),
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await page.screenshot({
    path: info.outputPath("closed-dark.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("dashboard separates actions and rejection totals from a single chronological updates feed", async ({
  page,
}, info) => {
  const now = new Date().toISOString();
  const older = new Date(Date.now() - 2 * 86400000).toISOString();
  const middle = new Date(Date.now() - 86400000).toISOString();
  const update = (
    id: string,
    kind: string,
    at: string,
    wasInProgress?: boolean,
  ) => ({
    id,
    applicationKey: id,
    kind,
    at,
    discoveredAt: now,
    title: id,
    description: id === "active" ? "Rejection after an interview" : "",
    notify: true,
    seen: false,
    wasInProgress,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const actions = Array.from({ length: 6 }, (_, i) => ({
    id: `new-${i}`,
    text: `New task ${i}`,
    state: "open",
    revision: 1,
    externalKeys: [],
    createdAt: now,
    updatedAt: now,
    activity: { id: `activity-${i}`, at: now },
    company: "Acme",
    role: "Engineer",
  }));
  await page.route("**/api/actions", (route) =>
    route.fulfill({
      json: {
        version: 1,
        fileHash: "fixture",
        importedNext: true,
        actions,
        lastCheck: {
          runId: "full",
          startedAt: now,
          completedAt: now,
          changes: actions.map((a) => ({
            id: a.id,
            activityId: a.activity.id,
            kind: "new",
          })),
        },
      },
    }),
  );
  let summary = { newActions: 6, newUpdates: 2, newRejections: 3 };
  await page.route("**/api/mail", (route) =>
    route.fulfill({
      json: {
        lastCareerCheck: {
          runId: "full",
          startedAt: now,
          completedAt: now,
          summary,
        },
      },
    }),
  );
  await page.route("**/api/recruiting", (route) =>
    route.fulfill({
      json: {
        version: 1,
        fileHash: "fixture",
        startedAt: now,
        rows: [
          { key: "active", company: "Active Co", status: "rejected" },
          { key: "routine", company: "Routine Co", status: "rejected" },
          { key: "legacy", company: "Legacy Co", status: "rejected" },
        ],
        actions,
        events: [
          update("Employer reply", "response", older),
          update("routine", "rejected", now, false),
          update("legacy", "rejected", now),
          update("Interview scheduled", "interview", now),
          update("active", "rejected", middle, true),
          update("Application receipt", "submitted", now),
          update("Recruiter task", "requested", now),
          update("Completed task", "completed", now),
          update("No Response closure", "no-response", now),
        ],
        pending: [],
        workflows: [],
      },
    }),
  );
  await page.goto("/");
  const overview = page.getByRole("region", { name: "Actions overview" });
  await expect(overview.getByLabel("New action", { exact: true })).toHaveCount(
    6,
  );
  for (let i = 0; i < 6; i++)
    await expect(
      overview.getByText(`New task ${i}`, { exact: true }),
    ).toBeVisible();
  // New items are pills beside the Actions and Updates headings, for this visit only.
  const newActions = page.getByLabel("New actions");
  const newUpdates = page.getByLabel("New updates");
  await expect(newActions).toHaveText("6 new");
  await expect(newUpdates).toHaveText(/\d+ new/);
  const feed = page.getByRole("region", { name: "Recruiting updates" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(feed.getByRole("list")).toHaveCount(1);
    await expect(feed.locator("details")).toHaveCount(0);
    await expect(feed.getByRole("listitem")).toHaveText([
      /Interview scheduled/,
      /No Response closure/,
      /Unsuccessful/,
      /Employer reply/,
    ]);
    await expect(feed.locator("time").last()).toHaveAttribute(
      "datetime",
      older,
    );
    await expect(feed.getByText("Rejection after an interview")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await feed.screenshot({ path: info.outputPath(`updates-${width}.png`) });
  }
  // The mocked feed does not persist seen state, so only the list itself is checked after a reload.
  summary = { newActions: 0, newUpdates: 0, newRejections: 0 };
  await page.reload();
  await expect(feed.getByRole("listitem")).toHaveCount(4);
  expect(errors).toEqual([]);
});
