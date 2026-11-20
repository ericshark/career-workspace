import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { fixtureScore } from "../../src/lib/claude/fixtures";

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  for (const theme of ["light", "dark"]) {
    test(`shared compact review, status actions and summary contrast: ${viewport.name} ${theme}`, async ({
      page,
      request,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() =>
        localStorage.setItem("career-ui.hideQuestions", "false"),
      );
      await page.addInitScript(
        (theme) => localStorage.setItem("career-ui.theme", theme),
        theme,
      );
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const runId = crypto.randomUUID();
      const { result, analysis } = fixtureScore(
        "2026-11-02",
        `https://jobs.example.test/${runId}`,
        undefined,
        runId,
      );
      result.company = `Compact ${runId.slice(0, 8)}`;
      const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
      const dir = path.join(root, "records/reviews");
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
          request: {
            resume: "tech",
            source: "LinkedIn",
            link: result.link,
            jobPost: "Build backend APIs with Python and PostgreSQL.",
            jobBrief: {
              overview:
                "Build tested backend APIs and data services for customer applications.",
              experience: "Early career",
              qualifications: ["Python", "PostgreSQL"],
              responsibilities: ["Build APIs"],
              location: "New York · Hybrid",
              compensation: "$100,000–$120,000",
            },
          },
        }),
      );
      await page.goto("/apply");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      if (viewport.name === "mobile")
        await page
          .getByRole("button", { name: "History", exact: true })
          .click();
      await page
        .getByRole("button", { name: new RegExp(result.company) })
        .click();
      const review = page.getByLabel("Completed review", { exact: true });
      await expect(
        review.getByRole("heading", { name: "Role overview", exact: true }),
      ).toHaveCount(0);
      const viewSummary = review.getByRole("button", {
        name: "View Summary",
        exact: true,
      });
      await viewSummary.click();
      const applySummary = page.getByRole("dialog");
      await expect(
        applySummary.getByRole("heading", {
          name: "Role overview",
          exact: true,
        }),
      ).toBeVisible();
      for (const name of [
        "Experience",
        "Key requirements",
        "Responsibilities and details",
      ])
        await expect(
          applySummary.getByRole("heading", { name, exact: true }),
        ).toBeVisible();
      await expect(applySummary.getByText(/Review ·.*· [\d.]+s/)).toHaveCount(
        0,
      );
      await applySummary
        .getByRole("button", { name: "View Review", exact: true })
        .click();
      await expect(applySummary).toHaveCount(0);
      await expect(viewSummary).toBeFocused();
      await expect(review.getByText(/Review ·.*· [\d.]+s/)).toBeVisible();
      await expect(review.getByLabel("Review reasoning")).toBeVisible();
      await expect(
        review.getByRole("heading", {
          name: "On your resume · 3",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        review.getByRole("heading", {
          name: "Missing from your resume · 2",
          exact: true,
        }),
      ).toBeVisible();
      await expect(review.getByText("OAuth2", { exact: true })).toBeVisible();
      await expect(
        review.getByText("Reasoning and recommended changes", { exact: true }),
      ).toHaveCount(0);
      await expect(
        review.getByRole("button", { name: "To apply", exact: true }),
      ).toBeVisible();
      await review
        .getByRole("button", { name: "Ask about this review", exact: true })
        .click();
      await expect(page.getByLabel("Follow-up question")).toBeVisible();
      await page
        .getByLabel("Follow-up question")
        .fill("Keep this draft while checking the summary");
      await viewSummary.click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "View Review", exact: true })
        .click();
      await expect(page.getByLabel("Follow-up question")).toHaveValue(
        "Keep this draft while checking the summary",
      );
      await review
        .getByRole("button", { name: "Questions & cover letter", exact: true })
        .click();
      await expect(
        page.getByText("Questions & cover letter", { exact: true }).last(),
      ).toBeVisible();
      await expect(review).toHaveCSS("opacity", "1");
      await page.screenshot({
        path: info.outputPath(`apply-${viewport.name}-${theme}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await review
        .getByRole("button", { name: "To apply", exact: true })
        .click();
      await expect(review).toHaveCount(0);
      await page.goto("/tracker");
      // Status tabs use radios in the Tracker; selecting All also makes the saved row visible.
      const pendingTab = page.getByRole("radio", { name: /To apply/ });
      if (await pendingTab.count()) await pendingTab.click();
      await page
        .getByText(result.company, { exact: true })
        .filter({ visible: true })
        .first()
        .click();
      const modal = page.getByRole("dialog");
      const section = modal.getByRole("region", {
        name: "Job summary",
        exact: true,
      });
      expect(
        await section.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).not.toBe("rgba(0, 0, 0, 0)");
      await page.screenshot({
        path: info.outputPath(`summary-${viewport.name}-${theme}.png`),
        fullPage: true,
      });
      await modal
        .getByRole("button", { name: "View review", exact: true })
        .click();
      await expect(review.getByTestId("verdict")).toContainText("Strong fit");
      await review
        .getByRole("button", { name: "View Summary", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      const trackerSummary = modal.getByRole("region", { name: "Job summary" });
      await expect(
        trackerSummary.getByRole("heading", {
          name: "Role overview",
          exact: true,
        }),
      ).toBeInViewport();
      await expect
        .poll(() =>
          trackerSummary.evaluate(
            (el) => el.parentElement?.parentElement?.scrollTop,
          ),
        )
        .toBe(0);
      await modal
        .getByRole("button", { name: "View review", exact: true })
        .click();
      await expect(
        review.getByRole("heading", { name: new RegExp(result.company) }),
      ).toBeInViewport();
      await expect(
        review.getByRole("button", { name: "To apply", exact: true }),
      ).toHaveCount(0);
      await expect(
        review.getByRole("button", { name: "Skip", exact: true }),
      ).toBeVisible();
      await expect(
        review.getByRole("button", { name: "Mark applied", exact: true }),
      ).toBeVisible();
      await expect(review).toHaveCSS("opacity", "1");
      await page.screenshot({
        path: info.outputPath(`tracker-review-${viewport.name}-${theme}.png`),
        fullPage: true,
      });
      if (theme === "light") {
        await review
          .getByRole("button", { name: "Mark applied", exact: true })
          .click();
        await expect(modal).toHaveCount(0);
        const payload = await (await request.get("/api/applications")).json();
        const rows = payload.rows.filter(
          (r: { company: string }) => r.company === result.company,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("applied");
        const appliedTab = page.getByRole("radio", { name: /^Applied/ });
        if (await appliedTab.count()) await appliedTab.click();
        // Reload on All to observe current status and verify decision actions disappear.
        await page.goto("/tracker");
        await page
          .getByText(result.company, { exact: true })
          .filter({ visible: true })
          .first()
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "View review", exact: true })
          .click();
        for (const name of ["Skip", "To apply", "Mark applied"])
          await expect(
            review.getByRole("button", { name, exact: true }),
          ).toHaveCount(0);
      } else {
        await review.getByRole("button", { name: "Skip", exact: true }).click();
        await expect(modal).toHaveCount(0);
        expect((await request.get(`/api/runs/${runId}`)).status()).toBe(404);
        const payload = await (await request.get("/api/applications")).json();
        expect(
          payload.rows.filter(
            (r: { company: string }) => r.company === result.company,
          ),
        ).toHaveLength(0);
      }
      expect(errors).toEqual([]);
    });
  }
}

test("leaving a review invalidates a delayed Skip response", async ({
  page,
}) => {
  const dir = path.join(process.env.PLAYWRIGHT_CAREER_ROOT!, "records/reviews");
  fs.mkdirSync(dir, { recursive: true });
  const companies = ["Delayed skip", "Newly opened review"].map(
    (label) => `${label} ${crypto.randomUUID().slice(0, 8)}`,
  );
  const ids = companies.map((company) => {
    const id = crypto.randomUUID();
    const { result, analysis } = fixtureScore(
      "2026-11-02",
      `https://jobs.example.test/${id}`,
      undefined,
      id,
    );
    result.company = company;
    fs.writeFileSync(
      path.join(dir, id + ".json"),
      JSON.stringify({
        version: 2,
        result,
        analysis,
        decision: "undecided",
        savedAt: new Date().toISOString(),
        request: { resume: "tech", jobPost: "Backend APIs and databases." },
      }),
    );
    return id;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/reviews/${ids[0]}`, async (route) => {
    await gate;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/apply");
  await page.getByRole("button", { name: new RegExp(companies[0]) }).click();
  const review = page.getByLabel("Completed review", { exact: true });
  await review.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(companies[1]) }).click();
  await expect(
    review.getByRole("heading", { name: new RegExp(companies[1]) }),
  ).toBeVisible();
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/reviews/${ids[0]}`) &&
      response.request().method() === "DELETE",
  );
  release();
  await (await completed).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    review.getByRole("heading", { name: new RegExp(companies[1]) }),
  ).toBeVisible();
});
