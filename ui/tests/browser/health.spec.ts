import { test, expect } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`health describes local credentials honestly on ${viewport.name}`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const health = await (await request.get("/api/health")).json();
    expect(health.connected).toBe(false);
    await page.goto("/apply");
    const status = page.locator('span[title*="Local configuration only"]');
    await expect(status).toHaveAttribute("title", /Manage AI connections/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`health-${viewport.name}.png`),
      fullPage: true,
    });
  });
}
