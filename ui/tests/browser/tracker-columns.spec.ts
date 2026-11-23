import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import type { ApplicationsPayload } from "../../src/lib/types";

test("tracker review, action and posting controls fit their columns", async ({
  page,
  request,
}, info) => {
  const { rows }: ApplicationsPayload = await (
    await request.get("/api/applications")
  ).json();
  const row = rows.find((r) => r.link === "https://acme.test/jobs/1")!;
  expect(row).toBeDefined();
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(process.env.PLAYWRIGHT_CAREER_ROOT!, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          externalKeys: ["gmail:columns:task"],
          revision: 1,
          text: "Column fixture task",
          company: row.company,
          role: row.role,
          application: { rowKey: row.key },
          state: "completed",
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
      ],
    }),
  );
  await page.route("**/api/reviews", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: row.recordId || "column-review",
            kind: "review",
            company: row.company,
            role: row.role,
            link: row.link,
            savedAt: now,
          },
        ],
      },
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/tracker");
    const action =
      width >= 768
        ? page
            .getByRole("row")
            .filter({ hasText: row.company })
            .filter({ hasText: row.role })
            .getByRole("button", { name: "View action timeline" })
            .first()
        : page
            .locator("div.cursor-pointer")
            .filter({ hasText: row.company })
            .filter({ hasText: row.role })
            .getByRole("button", { name: "View action timeline" })
            .filter({ visible: true })
            .first();
    const rowControls = action.locator("..");
    const review = rowControls.getByRole("button", {
      name: "View review",
      exact: true,
    });
    const link = rowControls.getByRole("link", { name: /^Job posting/ });
    await expect(review).toHaveText("View Review");
    await expect(action).toBeVisible();
    await expect(link).toBeVisible();
    if (width >= 768) {
      const a = (await action.boundingBox())!;
      const l = (await link.boundingBox())!;
      expect(a.x + a.width).toBeLessThan(l.x);
      const centered = await action.evaluate((el) => {
        const cell = el.parentElement!;
        const columns = getComputedStyle(cell)
          .gridTemplateColumns.split(" ")
          .map(Number.parseFloat);
        const gap = Number.parseFloat(getComputedStyle(cell).columnGap);
        const left =
          cell.getBoundingClientRect().left +
          Number.parseFloat(getComputedStyle(cell).paddingLeft) +
          columns.slice(0, 6).reduce((sum, n) => sum + n, 0) +
          gap * 6;
        const box = el.getBoundingClientRect();
        return Math.abs(box.left + box.width / 2 - (left + columns[6] / 2));
      });
      expect(centered).toBeLessThan(2);
    }
    for (const control of [review, link])
      expect(
        await control.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`tracker-columns-${width}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
