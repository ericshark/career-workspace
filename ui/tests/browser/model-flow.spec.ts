import { submitAndOpenReview } from "./reviewHelpers";
import { test, expect } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`tailoring start failure is visible and retryable on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/apply");
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    await page
      .getByLabel("Job post", { exact: true })
      .fill(
        `Audit ${viewport.name} — Backend engineer. Python, FastAPI, PostgreSQL and automated testing. `.repeat(
          4,
        ),
      );
    await submitAndOpenReview(page);
    await expect(
      page.getByRole("heading", { name: /^Fixture Co/ }),
    ).toBeVisible();
    let starts = 0;
    await page.route("**/api/tailor", async (route) => {
      starts++;
      await route.abort("failed");
    });
    await page
      .getByRole("button", { name: "Tailor", exact: true })
      .first()
      .click();
    const panel = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "Tailor", exact: true }),
    });
    await expect(
      panel.getByText(/Failed to fetch|Load failed|NetworkError/),
    ).toBeVisible();
    const retry = panel.getByRole("button", {
      name: "Start tailoring",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect.poll(() => starts).toBe(2);
    await expect(retry).toBeEnabled();
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({
      path: testInfo.outputPath(`tailor-error-${viewport.name}.png`),
    });
  });
}
