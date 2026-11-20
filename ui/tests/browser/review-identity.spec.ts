import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { fixtureScore, FIXTURE_POST } from "../../src/lib/claude/fixtures";
import type { ReviewJobStatus } from "../../src/lib/types";

test("opens the earliest completed review and logs a persisted identity correction", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const runDir = path.join(root, "ui/.cache/runs");
  fs.mkdirSync(runDir, { recursive: true });
  function seedReview() {
    const { result, analysis } = fixtureScore("2026-10-08");
    result.company = "";
    result.role = "Unknown job title";
    fs.writeFileSync(
      path.join(runDir, `${result.runId}.json`),
      JSON.stringify({
        version: 2,
        request: { jobPost: FIXTURE_POST, resume: "tech", source: "Other" },
        analysis,
        result,
        savedAt: new Date().toISOString(),
        viewedAt: null,
      }),
    );
    return result.runId;
  }
  const first = seedReview();
  const second = seedReview();
  let jobs: ReviewJobStatus[] = [];
  await page.route("**/api/score/status", async (route) => {
    await route.fulfill({
      json: { jobs, status: "idle", runningCount: 0, queuedCount: 0 },
    });
  });
  await page.goto("/apply");
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  const draft = page.getByLabel("Job post", { exact: true });
  await draft.fill("A draft for the next review");
  const now = Date.now();
  jobs = [second, first].map((runId, index) => ({
    runId,
    status: "done",
    startedAt: now - 1000,
    finishedAt: now - index,
    running: false,
    step: null,
    elapsedMs: 1000,
    preview: "",
  }));

  const card = page.locator("#completed-review");
  await expect(card).toHaveAttribute("data-review-id", first);
  await expect(draft).toHaveValue("A draft for the next review");
  const remaining = page
    .locator(`[data-run-id="${second}"]`)
    .getByRole("button", { name: "View review" });
  await expect(remaining).toBeVisible();

  const edit = card.getByRole("button", { name: "Edit company" });
  await edit.click();
  const company = card.getByRole("textbox", { name: "Company" });
  await expect(company).toBeFocused();
  await company.fill("Discard this edit");
  await company.press("Escape");
  await expect(edit).toBeFocused();
  let rejectEdit = true;
  await page.route(`**/api/reviews/${first}`, async (route) => {
    if (route.request().method() !== "PATCH" || !rejectEdit) {
      await route.continue();
      return;
    }
    rejectEdit = false;
    await route.fulfill({
      status: 409,
      json: {
        error: { code: "CONFLICT", message: "Try the correction again" },
      },
    });
  });
  await edit.click();
  await company.fill("Corrected Fixture Company");
  await company.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Try the correction again" }),
  ).toBeVisible();
  await expect(company).toHaveValue("Corrected Fixture Company");
  await company.press("Enter");
  await expect(
    card.getByRole("heading", { name: /Corrected Fixture Company/ }),
  ).toBeVisible();

  await page.reload();
  await expect(
    card.getByRole("heading", { name: /Corrected Fixture Company/ }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Mark applied", exact: true }).click();
  await expect(page.getByText(/^Logged as applied/)).toBeVisible();
  const rows = async () =>
    (await (await request.get("/api/applications")).json()).rows;
  expect(await rows()).toContainEqual(
    expect.objectContaining({
      recordId: first,
      company: "Corrected Fixture Company",
      role: "Unknown job title",
    }),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card).toHaveAttribute("data-review-id", first);
  expect(await rows()).not.toContainEqual(
    expect.objectContaining({ recordId: first }),
  );
  await remaining.click();
  await expect(card).toHaveAttribute("data-review-id", second);
});
