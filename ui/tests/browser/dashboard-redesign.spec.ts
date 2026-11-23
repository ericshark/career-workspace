import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { applicationDate } from "../../src/lib/config";
import { addDays } from "../../src/lib/progress";

test("dashboard summarizes five open actions and application progress", async ({
  page,
}, info) => {
  await page.route("**/api/recruiting", (route) =>
    route.fulfill({
      json: {
        version: 1,
        startedAt: new Date().toISOString(),
        fileHash: "fixture",
        events: [],
        workflows: [],
        pending: [],
        rows: [],
        actions: [],
      },
    }),
  );
  const now = new Date().toISOString();
  const titles = [
    "Complete the 15-minute assessment",
    "Reply with work authorization and salary expectations",
    "Complete the AI voice screening",
    "Verify the candidate account",
    "Choose an interview time",
  ];
  await page.route("**/api/actions", (route) =>
    route.fulfill({
      json: {
        version: 1,
        importedNext: true,
        fileHash: "fixture",
        actions: titles.map((text, i) => ({
          id: crypto.randomUUID(),
          revision: 1,
          externalKeys: [`gmail:compact:task-${i}`],
          text,
          company: [
            "Acme Robotics",
            "Synthwave Systems",
            "Northbeam Talent",
            "Lumen Mobile",
            "Harbor Staffing",
          ][i],
          role: "Software Development Engineer",
          state: "open",
          createdAt: now,
          updatedAt: now,
          email: {
            threadId: "compact",
            messageId: `message-${i}`,
            receivedAt: "2026-10-29T12:04:24Z",
            url: "https://mail.google.com/mail/u/0/#all/compact",
          },
          ...(i === 0
            ? { deadline: { date: applicationDate(), wording: "by today" } }
            : {}),
        })),
      },
    }),
  );
  // the workspace owner's monitor: the dashboard is designed to fit one 2560×1440 screen.
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto("/");
  await expect(page.getByText("5 open actions", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs your attention" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Recruiting updates" }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: /Apply to a job/i }),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  expect(
    await page
      .getByRole("heading", { level: 1 })
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toMatch(/Geist ?Mono/);
  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", {
      name: `Switch to ${theme}`,
      exact: true,
    });
    if (await toggle.isVisible()) await toggle.click();
    await page.screenshot({
      animations: "disabled",
      path: info.outputPath(`compact-dashboard-${theme}.png`),
      fullPage: true,
    });
  }
});

test("Quick Add shows two lines without truncating the saved draft", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apply");
  const description = page.getByRole("textbox", {
    name: "Job 1 description",
    exact: true,
  });
  const post =
    "A backend engineering role building Python APIs and PostgreSQL services. ".repeat(
      10,
    );
  await description.fill(post);
  const dimensions = await description.evaluate((el) => ({
    height: el.clientHeight,
    line: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(dimensions.height).toBeLessThanOrEqual(dimensions.line * 2);
  await expect(description).toHaveValue(post);
  await page
    .getByRole("button", { name: "Expand Job 1 description", exact: true })
    .click();
  expect((await description.boundingBox())!.height).toBeGreaterThan(
    dimensions.height,
  );
  await page
    .getByRole("button", { name: "Collapse Job 1 description", exact: true })
    .click();
  await expect(description).toHaveValue(post);
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("compact-quick-add.png"),
    fullPage: true,
  });
});

test("dashboard overview, flow site filter, bar tooltips and no Working on card", async ({
  page,
  request,
}) => {
  await page.route("**/api/workshop", (route) =>
    route.fulfill({
      json: {
        hash: "fixture",
        snapshot: {
          version: 4,
          categories: [{ id: "design", name: "Design" }],
          items: [
            {
              id: "site",
              kind: "project",
              title: "Personal Site",
              categoryId: "design",
              status: "Active",
              deployed: true,
              checklist: [
                {
                  id: "t1",
                  title: "Pick projects",
                  done: true,
                  numbered: true,
                },
                {
                  id: "t2",
                  title: "Collect screenshots",
                  done: false,
                  numbered: true,
                },
                {
                  id: "t3",
                  title: "Write captions",
                  done: false,
                  numbered: true,
                },
              ],
            },
          ],
          orders: { idea: [], project: ["site"], current: ["site"], next: [] },
        },
      },
    }),
  );
  const original = await (await request.get("/api/applications")).json();
  const today = applicationDate();
  const rows = Array.from({ length: 80 }, (_, i) => ({
    ...original.rows[0],
    key: `sample-${i}`,
    lineIndex: i,
    company: `Sample employer ${i}`,
    source: ["Simplify", "LinkedIn", "Jobright"][i % 3],
    date: addDays(today, -(i % 28)),
    status:
      i < 50
        ? "applied"
        : i < 58
          ? "in progress"
          : i < 64
            ? "no response"
            : i < 72
              ? "rejected"
              : "unsuccessful",
  }));
  await page.route("**/api/applications", (route) =>
    route.fulfill({ json: { ...original, rows } }),
  );
  await page.setViewportSize({ width: 2560, height: 1440 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const flow = page.getByRole("img", {
    name: "Current status flow for 80 submitted applications",
    exact: true,
  });
  await expect(flow).toBeVisible();
  await expect(flow.locator("path")).toHaveCount(5);
  // Analytics was merged into the dashboard: no sidebar link, old URL redirects.
  await expect(
    page.getByRole("link", { name: "Analytics", exact: true }),
  ).toHaveCount(0);
  await page.goto("/analytics");
  await expect(page).toHaveURL(/\/$/);
  // The dashboard fits one 2560×1440-class screen without scrolling.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await expect(page.getByRole("region", { name: "Daily routine" })).toHaveCount(
    0,
  );
  // Working on lives in Workshop only; the Dashboard no longer shows it.
  await expect(page.getByRole("region", { name: "Working on" })).toHaveCount(0);
  const site = page.getByLabel("Filter application flow by site");
  await page.getByText("Last 30 days", { exact: true }).click();
  const bars = page.getByRole("group", {
    name: "Daily application counts, 30-day window",
  });
  await expect(bars.getByRole("button")).toHaveCount(30);
  // Hovering a bar shows that day's count.
  const todayBar = bars.getByRole("button").last();
  await todayBar.hover();
  await expect(todayBar.getByRole("tooltip")).toHaveText(/· \d+ applied$/);
  const barLabels = await bars
    .getByRole("button")
    .evaluateAll((b) => b.map((el) => el.getAttribute("aria-label")));
  await site.selectOption("Simplify");
  await expect(
    page.getByRole("img", {
      name: "Current status flow for 27 submitted applications",
      exact: true,
    }),
  ).toBeVisible();
  // The site filter applies to the flow only; the bars keep every site.
  expect(
    await bars
      .getByRole("button")
      .evaluateAll((b) => b.map((el) => el.getAttribute("aria-label"))),
  ).toEqual(barLabels);
  await expect(page.getByText(/NaN|Infinity/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const width of [1440, 1024, 768, 390]) {
  test(`redesigned pages and themes fit at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const route of ["/", "/apply", "/tracker", "/guide"]) {
      await page.goto(route);
      if (route === "/apply") {
        await expect(
          page.getByRole("textbox", { name: "Job 1 description", exact: true }),
        ).toBeVisible();
        const history = page.getByRole("complementary").filter({
          has: page.getByRole("heading", { name: "History", exact: true }),
        });
        if (width >= 1024) {
          await expect(history).toBeVisible();
          const bounds = await history.boundingBox();
          const composer = await page
            .getByRole("textbox", { name: "Job 1 description", exact: true })
            .boundingBox();
          expect(bounds!.x).toBeGreaterThan(composer!.x + composer!.width);
          await page
            .getByRole("button", { name: "Hide history", exact: true })
            .click();
          await expect(history).toHaveCount(0);
          await page.reload();
          await expect(history).toBeVisible();
        } else {
          await expect(
            page.getByRole("dialog", { name: "History", exact: true }),
          ).toHaveCount(0);
          await page
            .getByRole("button", { name: "History", exact: true })
            .click();
          await expect(
            page.getByRole("dialog", { name: "History", exact: true }),
          ).toBeVisible();
          await page.keyboard.press("Escape");
        }
      }
      for (const theme of ["dark", "light"]) {
        const toggle = page.getByRole("button", {
          name: `Switch to ${theme}`,
          exact: true,
        });
        if (await toggle.isVisible()) await toggle.click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          animations: "disabled",
          path: info.outputPath(
            `${route.replaceAll("/", "") || "dashboard"}-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
      }
    }
    if (width < 1024) {
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Navigation", exact: true })
        .getByRole("link", { name: "Tracker", exact: true })
        .click();
      await expect(page).toHaveURL(/\/tracker$/);
      await expect(
        page.getByRole("dialog", { name: "Navigation", exact: true }),
      ).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
