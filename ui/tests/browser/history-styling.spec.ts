import { test, expect } from "@playwright/test";
test("Apply history keeps compact company/status/date rows and working filters", async ({
  page,
}, info) => {
  const now = new Date().toISOString();
  const make = (id: string, company: string, kind: string, status: string) => ({
    id,
    company,
    kind,
    status,
    role: "Role should stay out of sidebar",
    fit: 88,
    match: 79,
    reviewedAt: now.slice(0, 10),
    savedAt: now,
    decision: "submitted",
    viewedAt: now,
  });
  await page.route("**/api/reviews", (route) =>
    route.fulfill({
      json: {
        items: [
          make("quick-1", "Acme", "quick", "applied"),
          make("review-1", "Beta", "review", "applied"),
          make("review-2", "Gamma", "review", "to apply"),
          make("review-3", "Delta", "review", "in progress"),
        ],
      },
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/apply");
    if (width < 1024)
      await page.getByRole("button", { name: "History", exact: true }).click();
    const history =
      width < 1024
        ? page.getByRole("dialog")
        : page.locator("aside").filter({
            has: page.getByRole("heading", { name: "History", exact: true }),
          });
    const filters = history.getByRole("group", { name: "History filter" });
    await filters.getByRole("button", { name: /^Summaries/ }).click();
    await expect(history.getByText("Acme", { exact: true })).toBeVisible();
    await expect(history.getByText(/Role should/)).toHaveCount(0);
    await expect(history.getByText(/Fit 88|Quick/)).toHaveCount(0);
    await filters.getByRole("button", { name: /^Reviews/ }).click();
    await expect(history.getByText("Beta", { exact: true })).toBeVisible();
    await expect(history.getByText("Acme", { exact: true })).toHaveCount(0);
    await filters.getByRole("button", { name: /^To apply/ }).click();
    await expect(history.getByText("Gamma", { exact: true })).toBeVisible();
    await filters.getByRole("button", { name: /^In progress/ }).click();
    await expect(history.getByText("Delta", { exact: true })).toBeVisible();
    await filters.getByRole("button", { name: /^Summaries/ }).click();
    await page.screenshot({
      path: info.outputPath(`history-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
