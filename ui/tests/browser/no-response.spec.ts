import { test, expect } from "@playwright/test";
for (const width of [1280, 390]) {
  test(`Tracker displays backend No Response without manual aging at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tracker");
    await expect(
      page.getByRole("button", { name: "Mark all no response…", exact: true }),
    ).toHaveCount(0);
    await page.goto("/tracker?status=no%20response");
    await expect(
      page.getByRole("heading", { name: "Tracker", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
