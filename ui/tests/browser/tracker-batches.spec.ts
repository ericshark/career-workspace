import { expect, test } from "@playwright/test";
import { STATUSES, type ApplicationsPayload } from "../../src/lib/types";

for (const width of [1440, 390]) {
  test(`Tracker renders more rows on scroll and searches the full list at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/applications", async (route) => {
      const response = await route.fetch();
      const payload: ApplicationsPayload = await response.json();
      const rows = STATUSES.flatMap((status, group) =>
        Array.from({ length: 105 }, (_, index) => {
          const number = group * 105 + index;
          return {
            ...payload.rows[0],
            date: "2026-11-01",
            company: `Batch company ${number}`,
            status,
            key: String(number),
            lineIndex: number,
          };
        }),
      );
      await route.fulfill({ json: { ...payload, rows } });
    });
    const rows = page.getByText(/^Batch company \d+$/);
    const more = page.getByRole("button", { name: "Show more applications" });
    const search = page.getByRole("textbox", { name: "Search applications" });
    for (const [group, status] of STATUSES.entries()) {
      await page.goto(`/tracker?status=${encodeURIComponent(status)}`);
      await expect(
        page.getByText(`105 of ${STATUSES.length * 105} applications`),
      ).toBeVisible();
      await expect(rows).toHaveCount(50);
      const company = await rows.last().textContent();
      await more.scrollIntoViewIfNeeded();
      await expect(rows).toHaveCount(100);
      await expect(rows.nth(49)).toHaveText(company!);

      await page.evaluate(() => window.scrollTo(0, 0));
      const lastCompany = `Batch company ${group * 105 + 104}`;
      await expect(page.getByText(lastCompany, { exact: true })).toHaveCount(0);
      await search.fill(lastCompany);
      await expect(rows).toHaveText([lastCompany]);
      await expect(more).toHaveCount(0);
      await search.clear();
      await expect(rows).toHaveCount(50);
    }

    await page.goto("/tracker");
    await expect(
      page.getByText(`${STATUSES.length * 105} applications`),
    ).toBeVisible();
    await expect(rows).toHaveCount(50);
    await more.scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(100);
  });
}
