import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { fixtureScore } from "../../src/lib/claude/fixtures";

for (const width of [1440, 390])
  test(`notifications, status editing, fixed columns and review controls at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem(
        "career-ui.tracker",
        JSON.stringify({ columns: ["company", "status", "resume"] }),
      ),
    );
    const runId = crypto.randomUUID();
    const company = `Notifications ${runId.slice(0, 8)}`;
    const { result, analysis } = fixtureScore(
      "2026-11-02",
      `https://jobs.example.test/${runId}`,
      undefined,
      runId,
    );
    result.company = company;
    const dir = path.join(
      process.env.PLAYWRIGHT_CAREER_ROOT!,
      "records/reviews",
    );
    fs.mkdirSync(dir, { recursive: true });
    const record = {
      version: 2,
      result,
      analysis,
      savedAt: new Date().toISOString(),
      decision: "undecided",
      viewedAt: null,
      request: {
        resume: "tech",
        jobPost: "Build Python backend APIs and PostgreSQL applications.",
      },
    };
    fs.writeFileSync(path.join(dir, runId + ".json"), JSON.stringify(record));
    const legacyId = crypto.randomUUID();
    fs.writeFileSync(
      path.join(dir, legacyId + ".json"),
      JSON.stringify({
        ...record,
        viewedAt: undefined,
        result: { ...result, runId: legacyId, company: `Legacy ${runId}` },
      }),
    );
    const unread = (
      await (await request.get("/api/reviews")).json()
    ).items.filter(
      (item: { kind: string; viewedAt?: string | null }) =>
        item.kind === "review" && item.viewedAt === null,
    ).length;
    const initialApplications = await (
      await request.get("/api/applications")
    ).json();
    if (initialApplications.rows[0]) {
      const row = initialApplications.rows[0];
      const noted = await request.patch("/api/applications", {
        data: {
          fileHash: initialApplications.fileHash,
          key: row.key,
          lineIndex: row.lineIndex,
          next: "Check the saved application details",
        },
      });
      expect(noted.ok()).toBe(true);
    }
    await page.goto("/tracker");
    await expect(
      page.getByRole("button", { name: "Columns", exact: true }),
    ).toHaveCount(0);
    if (width === 1440)
      await expect(
        page.getByRole("row").first().locator(":scope > *"),
      ).toHaveText([
        "Company",
        "Role",
        "Status",
        "Date",
        "Source",
        "Review",
        "Timeline",
        "View link",
      ]);
    await expect(
      page
        .getByRole("link", { name: /^Job posting/ })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    const savedTracker = await (await request.get("/api/applications")).json();
    expect(savedTracker.rows[0].next).toBe(
      "Check the saved application details",
    );
    const bell = page.locator('button[aria-label^="Review notifications,"]');
    await expect(bell).toHaveAttribute(
      "aria-label",
      `Review notifications, ${unread} unviewed`,
    );
    await bell.click();
    await expect(
      page.getByLabel("Review notifications", { exact: true }),
    ).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: info.outputPath(`notifications-${width}.png`),
      fullPage: true,
    });
    await expect(
      page.getByRole("button", { name: new RegExp(`Legacy ${runId}`) }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(company) }).click();
    await expect(bell).toHaveAttribute(
      "aria-label",
      `Review notifications, ${unread - 1} unviewed`,
    );
    const modal = page.getByRole("dialog");
    const review = page.getByLabel("Completed review", { exact: true });
    await expect(
      review.getByRole("heading", { name: new RegExp(company) }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/runs/${runId}`)).json()).viewedAt,
      )
      .toBeTruthy();
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const name of ["Ask about this review", "Questions & cover letter"]) {
      await modal.getByRole("button", { name, exact: true }).click();
      await expect(
        modal.getByRole("heading", { name, exact: true }),
      ).toBeInViewport();
      await modal.getByRole("button", { name, exact: true }).click();
    }
    const applications = await (await request.get("/api/applications")).json();
    const saved = await request.post("/api/applications", {
      data: {
        fileHash: applications.fileHash,
        runId,
        decision: "later",
        row: {
          company,
          role: result.role,
          lane: "tech",
          resume: "tech",
          fit: result.fit.total,
          match: result.match.total,
          source: "LinkedIn",
          link: result.link,
        },
      },
    });
    expect(saved.ok()).toBe(true);
    await expect(
      review.getByRole("button", {
        name: "Status: To apply. Change status",
        exact: true,
      }),
    ).toBeVisible({ timeout: 10000 });
    await review
      .getByRole("button", {
        name: "Status: To apply. Change status",
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Applied", exact: true })
      .click();
    await expect(
      review.getByRole("button", {
        name: "Status: Applied. Change status",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      review.getByRole("button", { name: "Mark applied", exact: true }),
    ).toHaveCount(0);
    const rows = (
      await (await request.get("/api/applications")).json()
    ).rows.filter((row: { company: string }) => row.company === company);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("applied");
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await expect(bell).toHaveAttribute(
      "aria-label",
      `Review notifications, ${unread - 1} unviewed`,
    );
    await bell.click();
    await expect(
      page.getByRole("button", { name: new RegExp(company) }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/apply");
    if (width === 390)
      await page.getByRole("button", { name: "History", exact: true }).click();
    const filters = page.getByRole("group", { name: "History filter" });
    if (width === 1440)
      expect(
        await filters.evaluate((el) => {
          const group = el.getBoundingClientRect();
          const aside = el.closest("aside")!.getBoundingClientRect();
          return (
            group.right <= aside.right &&
            [...el.querySelectorAll("button")].every((button) => {
              const rect = button.getBoundingClientRect();
              return rect.left >= group.left && rect.right <= group.right;
            })
          );
        }),
      ).toBe(true);
    await filters.getByRole("button", { name: /^Reviews/ }).click();
    await page.getByRole("button", { name: new RegExp(company) }).click();
    const controls = review.getByLabel("Review controls");
    await expect(
      controls.getByRole("button", { name: "View Summary", exact: true }),
    ).toBeVisible();
    await expect(
      controls.getByRole("button", {
        name: "Status: Applied. Change status",
        exact: true,
      }),
    ).toBeVisible();
    await expect(review.getByText("Verdict", { exact: true })).toBeVisible();
    const followup = review.getByRole("button", {
      name: "Ask about this review",
      exact: true,
    });
    expect((await followup.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    await review.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`review-controls-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

test("a failed notification open restores the unread item for retry", async ({
  page,
  request,
}) => {
  const runId = crypto.randomUUID();
  const { result, analysis } = fixtureScore(
    "2026-11-02",
    `https://jobs.example.test/${runId}`,
    undefined,
    runId,
  );
  result.company = `Retry notification ${runId.slice(0, 8)}`;
  const dir = path.join(process.env.PLAYWRIGHT_CAREER_ROOT!, "records/reviews");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, runId + ".json"),
    JSON.stringify({
      version: 2,
      result,
      analysis,
      viewedAt: null,
      decision: "undecided",
      savedAt: new Date().toISOString(),
      request: { resume: "tech", jobPost: "Backend engineering work." },
    }),
  );
  const unread = (
    await (await request.get("/api/reviews")).json()
  ).items.filter(
    (item: { kind: string; viewedAt?: string | null }) =>
      item.kind === "review" && item.viewedAt === null,
  ).length;
  await page.route(`**/api/runs/${runId}`, (route) =>
    route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } }),
  );
  await page.goto("/tracker");
  const bell = page.locator('button[aria-label^="Review notifications,"]');
  await expect(bell).toHaveAttribute(
    "aria-label",
    `Review notifications, ${unread} unviewed`,
  );
  await bell.click();
  const item = page.getByRole("button", { name: new RegExp(result.company) });
  await item.click();
  await expect(
    page.getByLabel("Review notifications", { exact: true }).getByRole("alert"),
  ).toContainText("Could not open review; try again");
  await expect(bell).toHaveAttribute(
    "aria-label",
    `Review notifications, ${unread} unviewed`,
  );
  await expect(item).toBeEnabled();
  await page.unroute(`**/api/runs/${runId}`);
  await item.click();
  await expect(
    page.getByLabel("Completed review", { exact: true }),
  ).toBeVisible();
  await expect(bell).toHaveAttribute(
    "aria-label",
    `Review notifications, ${unread - 1} unviewed`,
  );
});
