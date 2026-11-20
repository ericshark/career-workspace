import { expect, test } from "@playwright/test";

test("finds and removes a saved fallback from Tracker and Job Details", async ({
  page,
  request,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const added = await request.post("/api/quick", {
    data: {
      jobs: [
        {
          description:
            "Link Lookup Co — Software Engineer\nBuild backend services with Python and PostgreSQL.",
        },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tracker");
    const find = page
      .getByRole("button", { name: "Find link", exact: true })
      .filter({ visible: true })
      .first();
    await expect(find).toBeVisible();
    await expect(find).toHaveText("Find link");
    if (width >= 768) {
      const headers = await page
        .getByRole("row")
        .first()
        .locator(":scope > *")
        .allTextContents();
      expect(headers.indexOf("Source")).toBeLessThan(headers.indexOf("Review"));
      expect(headers).toContain("Timeline");
    }
    // Searching is always manual, started from the chip's menu.
    await find.click();
    await page.getByRole("menuitem", { name: "Search automatically" }).click();
    const chip = page
      .getByRole("link", { name: /^Careers page/ })
      .filter({ visible: true })
      .first();
    await expect(chip).toBeVisible();
    await page.getByText("Link Lookup Co", { exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("link", { name: /^Careers page/ }),
    ).toHaveAttribute("href", "https://example.com/careers");
    await dialog.getByRole("link", { name: /^Careers page/ }).hover();
    await page.getByRole("button", { name: "Remove link" }).click();
    await expect(
      dialog.getByRole("button", { name: "Find link" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Find link" }).click();
    await page.getByRole("menuitem", { name: "Search automatically" }).click();
    await expect(
      dialog.getByRole("link", { name: /^Careers page/ }),
    ).toBeVisible();
    await dialog.getByRole("link", { name: /^Careers page/ }).hover();
    await page.getByRole("button", { name: "Remove link" }).click();
    await expect(
      dialog.getByRole("button", { name: "Find link" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
  expect(browserErrors).toEqual([]);
});
