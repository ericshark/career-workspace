import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { fixtureScore } from "../../src/lib/claude/fixtures";

for (const width of [1440, 390]) {
  test(`matching postings log normally and warnings open the earlier posting at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const description = `Warning ${width} — QA Engineer. Test Python services and write clear bug reports. https://example.test/jobs/warning-${width}`;
    const first = await request.post("/api/quick", {
      data: { jobs: [{ description }] },
    });
    expect(first.ok()).toBe(true);
    const id = (await first.json()).added[0].quickId;
    await page.goto("/apply");
    await page
      .getByLabel("Job 1 description", { exact: true })
      .fill(description);
    await page
      .getByRole("button", { name: /Quick add/i })
      .last()
      .click();
    await expect(
      page.getByRole("heading", { name: "Added 1 job", exact: true }),
    ).toBeVisible();
    await page
      .getByText("Possible duplicate — compare postings", { exact: true })
      .click();
    const link = page
      .getByRole("link", { name: /View posting/ })
      .and(page.locator(`a[href="/tracker?application=${id}"]`))
      .first();
    await expect(link).toHaveAttribute("href", `/tracker?application=${id}`);
    const opened = page.waitForEvent("popup");
    await link.click();
    const other = await opened;
    await expect(other.getByRole("dialog")).toBeVisible();
    await expect(
      other.getByRole("heading", {
        name: `Warning ${width} QA Engineer`,
        exact: true,
      }),
    ).toBeVisible();
    await other.close();
    const rows = (await (await request.get("/api/applications")).json()).rows;
    expect(
      rows.filter((r: { company: string }) => r.company === `Warning ${width}`),
    ).toHaveLength(2);
    await page.screenshot({
      path: info.outputPath(`duplicate-warning-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Reviewing an exact existing posting also proceeds without a duplicate gate.
    const review = await request.post("/api/score", {
      data: {
        jobPost: description.repeat(4),
        link: `https://example.test/jobs/warning-${width}`,
        resume: "tech",
      },
    });
    expect(review.status()).toBe(202);
    const reviewed = await review.json();
    expect(reviewed.duplicate).toBeUndefined();
    await expect
      .poll(async () => {
        const state = await (await request.get("/api/score/status")).json();
        return state.jobs.find(
          (job: { runId: string }) => job.runId === reviewed.runId,
        )?.status;
      })
      .toBe("done");
  });
}

test("Quick Add retries a partial save without adding a second row", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const blocked = path.join(
    root,
    "records/reviews/browser-recovery-qa-engineer.json",
  );
  fs.mkdirSync(blocked, { recursive: true });
  try {
    await page.goto("/apply");
    await page
      .getByLabel("Job 1 description", { exact: true })
      .fill(
        "Browser Recovery — QA Engineer. Test Python APIs and document issues for the team.",
      );
    await page
      .getByRole("button", { name: /Quick add/i })
      .last()
      .click();
    await expect(
      page.getByRole("heading", { name: "Save incomplete", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/A tracker row may already exist/),
    ).toBeVisible();
    fs.rmdirSync(blocked);
    await page.reload();
    await expect(
      page.getByLabel("Job 1 description", { exact: true }),
    ).toHaveValue(/Browser Recovery/);
    await page
      .getByRole("button", { name: /Quick add/i })
      .last()
      .click();
    await expect(
      page.getByRole("heading", { name: "Added 1 job", exact: true }),
    ).toBeVisible();
    const rows = (await (await request.get("/api/applications")).json()).rows;
    expect(
      rows.filter((r: { company: string }) => r.company === "Browser Recovery"),
    ).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(blocked, "utf8")).kind).toBe("quick");
  } finally {
    if (fs.existsSync(blocked) && fs.statSync(blocked).isDirectory())
      fs.rmdirSync(blocked);
  }
});

test("a cache-only review stays in History and can retry permanent saving", async ({
  page,
  request,
}, info) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const runId = crypto.randomUUID();
  const { result, analysis } = fixtureScore(
    "2026-10-30",
    undefined,
    undefined,
    runId,
  );
  result.company = "Save Failure Browser";
  result.suggestedSlug = "save-failure-browser";
  result.meta.persistenceWarning =
    "This review could not be permanently saved. It is only in the working cache; retry saving before clearing that cache.";
  const cache = path.join(root, "ui/.cache/runs", runId + ".json");
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(
    cache,
    JSON.stringify({
      version: 2,
      request: { jobPost: "Browser save example", resume: "tech" },
      result,
      analysis,
      savedAt: new Date().toISOString(),
    }),
  );
  const blocked = path.join(root, "records/reviews/save-failure-browser.json");
  fs.mkdirSync(blocked, { recursive: true });
  try {
    await page.goto("/apply");
    await page
      .getByRole("button", { name: /Save Failure Browser/ })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Retry saving", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Retry saving", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry saving", exact: true }),
    ).toBeEnabled();
    fs.rmdirSync(blocked);
    await page
      .getByRole("button", { name: "Retry saving", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry saving", exact: true }),
    ).toHaveCount(0);
    const run = await (await request.get(`/api/runs/${runId}`)).json();
    expect(run.result.meta.persistenceWarning).toBeUndefined();
    expect(fs.statSync(blocked).isFile()).toBe(true);
    await page.screenshot({
      path: info.outputPath("review-save-recovered.png"),
      fullPage: true,
    });
  } finally {
    if (fs.existsSync(blocked) && fs.statSync(blocked).isDirectory())
      fs.rmdirSync(blocked);
  }
});
