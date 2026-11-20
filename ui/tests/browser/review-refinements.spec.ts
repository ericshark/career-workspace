import { test, expect } from "@playwright/test";
import { submitAndOpenReview } from "./reviewHelpers";
for (const width of [1440, 390]) {
  test(`viewed queue, expanded panels and compact dashboard at ${width}`, async ({
    page,
    request,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/apply");
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    await page
      .getByLabel("Job post", { exact: true })
      .fill(
        `Unique ${crypto.randomUUID()} Build Python and PostgreSQL services. `.repeat(
          6,
        ),
      );
    const runId = await submitAndOpenReview(page);
    await expect
      .poll(async () =>
        (await (await request.get("/api/score/status")).json()).jobs.some(
          (j: { runId: string }) => j.runId === runId,
        ),
      )
      .toBe(false);
    for (const name of ["Ask about this review", "Questions & cover letter"]) {
      await page.getByRole("button", { name, exact: true }).click();
      const heading = page.getByRole("heading", { name, exact: true });
      await expect(heading).toBeInViewport();
      expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    }
    await page.screenshot({
      path: info.outputPath(`panels-${width}.png`),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.locator(
        `[data-testid="review-progress-row"][data-run-id="${runId}"]`,
      ),
    ).toHaveCount(0);
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Applications overview", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/active weekday/)).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`dashboard-${width}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
