import { test, expect } from "@playwright/test";
for (const width of [1440, 390])
  test(`compact Tracker sorting and status filters at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      if (!localStorage.getItem("filter-test-seeded")) {
        localStorage.setItem(
          "career-ui.tracker",
          JSON.stringify({ sortKey: "fit", sortDir: "desc" }),
        );
        localStorage.setItem("filter-test-seeded", "yes");
      }
    });
    await page.goto("/tracker");
    const tabs = page.getByRole("radiogroup", { name: "Show", exact: true });
    await expect(tabs.getByRole("radio")).toHaveText([
      /^All \d+$/,
      /^Applied \d+$/,
      /^In progress \d+$/,
    ]);
    await page.getByRole("button", { name: "Sort", exact: true }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio")).toHaveText([
      "Date",
      "Company",
      "Ascending",
      "Descending",
    ]);
    await expect(
      menu.getByRole("menuitemradio", { name: "Date", exact: true }),
    ).toBeChecked();
    await menu
      .getByRole("menuitemradio", { name: "Company", exact: true })
      .click();
    for (const name of ["To apply", "No response", "Rejected"]) {
      await page
        .getByRole("button", { name: "More statuses", exact: true })
        .click();
      await page
        .getByRole("menuitemradio", { name: new RegExp(`^${name} `) })
        .click();
      await expect(
        page.getByRole("button", { name: "More statuses", exact: true }),
      ).toContainText(name);
    }
    await page.reload();
    await expect(
      page.getByRole("button", { name: "More statuses", exact: true }),
    ).toContainText("Rejected");
    await tabs.getByRole("radio", { name: /^All / }).click();
    await expect(
      page.getByRole("button", { name: "More statuses", exact: true }),
    ).toHaveText("More");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`tracker-filters-${width}.png`),
      fullPage: true,
    });
  });
