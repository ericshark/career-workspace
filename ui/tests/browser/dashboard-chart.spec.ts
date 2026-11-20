import { expect, test } from "@playwright/test";
import { addDays } from "../../src/lib/progress";
import { applicationDate } from "../../src/lib/config";

/** Vertical offset between a chip's center and the center of the title text it follows. */
async function chipOffset(page: import("@playwright/test").Page, text: string) {
  return page.evaluate((needle) => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.includes(needle)) continue;
      const chip = n.parentElement?.querySelector("[data-category-chip]");
      if (!chip) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      return c.top + c.height / 2 - (t.top + t.height / 2);
    }
    return Number.NaN;
  }, text);
}

async function expectAligned(
  page: import("@playwright/test").Page,
  text: string,
) {
  const offset = await chipOffset(page, text);
  console.log("OFFSET", offset);
  expect(Math.abs(offset)).toBeLessThanOrEqual(1.5);
}

test("30-day chart pages back to the first application, with totals and graded colors", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/progress")).json();
  const today = applicationDate();
  // 40 days of history: 100+ today, 30 on day -1, a single application on day -35.
  const byDay = {
    [today]: 120,
    [addDays(today, -1)]: 30,
    [addDays(today, -35)]: 2,
  };
  await page.route("**/api/progress", (route) =>
    route.fulfill({ json: { ...original, byDay, allTime: 152 } }),
  );
  await page.goto("/");
  await page.getByText("Last 30 days", { exact: true }).click();
  const bars = page.getByRole("group", {
    name: "Daily application counts, 30-day window",
  });
  await expect(bars.getByRole("button")).toHaveCount(30);
  await expect(page.getByText("total applied")).toContainText("150");
  // No goal line or caption any more.
  await expect(page.getByText(/goal \d+\/day/)).toHaveCount(0);
  const next = page.getByRole("button", { name: "Next 30 days" });
  const previous = page.getByRole("button", { name: "Previous 30 days" });
  await expect(next).toBeDisabled();
  const colors = await bars
    .getByRole("button")
    .evaluateAll((b) =>
      b.map((el) => getComputedStyle(el.firstElementChild!).backgroundColor),
    );
  // Today (120) is the darkest green; zero days are red; day -1 (30) is a lighter green.
  expect(new Set(colors).size).toBeGreaterThanOrEqual(3);
  await previous.click();
  await expect(next).toBeEnabled();
  await expect(page.getByText("total applied")).toContainText("2");
  // The earliest application is in this window, so there is nowhere further back.
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(next).toBeDisabled();
});

test("Total rejected shows its share of all-time applications", async ({
  page,
}) => {
  await page.goto("/");
  const card = page.getByRole("group", { name: "Total rejected" });
  await expect(card).toContainText(/\d+% of all time/);
});

test("open actions show a category chip on the Dashboard and Actions page", async ({
  page,
  request,
}, info) => {
  // Linked to a real application so the Actions page lists them under Open, not Decisions.
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows[0];
  await request.patch("/api/applications", {
    data: { fileHash: apps.fileHash, key: row.key, status: "applied" },
  });
  const now = new Date().toISOString();
  const base = {
    externalKeys: ["gmail:t:ask"],
    revision: 1,
    company: row.company,
    role: row.role,
    application: { rowKey: row.key },
    state: "open",
    createdAt: now,
    updatedAt: now,
    email: {
      threadId: "t",
      messageId: "m",
      receivedAt: now,
      url: "https://mail.google.com/mail/u/0/#all/t",
    },
  };
  const actions = [
    ["Complete the CCAT", "assessment"],
    ["Book a 30-minute intro call", "schedule"],
    ["Reply with salary expectations", "reply"],
    ["Verify your candidate account", "verify"],
  ].map(([text, category], i) => ({
    ...base,
    id: `${i + 1}`.repeat(8) + "-1111-4111-8111-111111111111",
    externalKeys: [`gmail:t:ask${i}`],
    text,
    category,
  }));
  await page.route("**/api/actions", (route) =>
    route.fulfill({
      json: {
        version: 1,
        importedNext: true,
        fileHash: "fixture",
        actions,
      },
    }),
  );
  await page.goto("/");
  const overview = page.getByRole("region", { name: "Actions overview" });
  await expect(overview.locator("[data-category-chip]")).toHaveText([
    "Assessment",
    "Schedule interview",
    "Reply requested",
    "Verify account",
  ]);
  await expectAligned(page, "Complete the CCAT");
  await page.screenshot({ path: info.outputPath("chips-dashboard.png") });
  await page.goto("/actions?filter=open");
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Complete the CCAT" })
      .locator("[data-category-chip]"),
  ).toHaveText("Assessment");
  await expectAligned(page, "Complete the CCAT");
  await page.screenshot({
    path: info.outputPath("chips-actions.png"),
    clip: { x: 252, y: 240, width: 700, height: 140 },
  });
});
