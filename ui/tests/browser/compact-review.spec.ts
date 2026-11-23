import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { showUndecidedHistory } from "./reviewHelpers";
import { fixtureScore } from "../../src/lib/claude/fixtures";
import type { ReviewJobStatus } from "../../src/lib/types";

test("queue shows independent jobs, failure/retry/cancel and explicit viewing without replacing drafts", async ({
  page,
}) => {
  const jobs: ReviewJobStatus[] = [];
  let submitted = 0,
    markingFails = true;
  const { result } = fixtureScore("2026-10-30");
  await page.route("**/api/score", async (route) => {
    const runId = `queue-browser-${++submitted}`;
    jobs.push({
      runId,
      status: submitted <= 2 ? "running" : "queued",
      running: submitted <= 2,
      preview: `Queue job ${submitted}`,
      step: "Reviewing",
      elapsedMs: 1000,
      startedAt: Date.now(),
    });
    await route.fulfill({ status: 202, json: { runId } });
  });
  await page.route("**/api/score/status", (route) =>
    route.fulfill({ json: { jobs } }),
  );
  for (const action of ["cancel", "resume"])
    await page.route(`**/api/score/${action}`, async (route) => {
      const j = jobs.find(
        (j) => j.runId === route.request().postDataJSON().runId,
      )!;
      j.status = action === "cancel" ? "cancelled" : "running";
      j.running = action === "resume";
      j.error = undefined;
      await route.fulfill({ json: { ok: true } });
    });
  await page.route("**/api/runs/queue-browser-1", (route) =>
    route.fulfill({
      json: {
        kind: "review",
        result: {
          ...result,
          runId: "queue-browser-1",
          company: "Queue result",
        },
        decision: "undecided",
        tailor: null,
      },
    }),
  );
  await page.route("**/api/reviews/queue-browser-1/view", (route) => {
    // The real status endpoint removes viewed completions; mirror that durable server effect.
    if (!markingFails) {
      const index = jobs.findIndex((job) => job.runId === "queue-browser-1");
      if (index >= 0) jobs.splice(index, 1);
    }
    return route.fulfill(
      markingFails
        ? { status: 503, json: { error: { message: "Unavailable" } } }
        : { json: { viewedAt: new Date().toISOString() } },
    );
  });
  await page.goto("/apply");
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  const composer = page.getByLabel("Job post", { exact: true });
  for (let n = 1; n <= 3; n++) {
    await composer.fill(
      `Queue job ${n}. Build and test Python APIs with PostgreSQL. `.repeat(5),
    );
    await page.getByRole("button", { name: /^Review job/ }).click();
    await expect(composer).toHaveValue("");
  }
  const queue = page.getByRole("region", { name: "Review progress" });
  await expect(
    queue.getByRole("status").filter({ hasText: "Processing" }),
  ).toHaveCount(2);
  await expect(
    queue.getByRole("status").filter({ hasText: "Queued" }),
  ).toHaveCount(1);
  await composer.fill("The next draft stays here");
  jobs[0].status = "done";
  jobs[0].running = false;
  jobs[1].status = "error";
  jobs[1].error = "Fixture review failed";
  jobs[1].running = false;
  jobs[2].status = "running";
  jobs[2].running = true;
  const failed = queue.locator('[data-run-id="queue-browser-2"]');
  await expect(
    failed.getByText("Fixture review failed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Queue result/ })).toHaveCount(
    0,
  );
  await failed.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(failed.getByRole("status")).toContainText("Processing");
  const third = queue.locator('[data-run-id="queue-browser-3"]');
  await third.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(third.getByRole("status")).toHaveText("Cancelled");
  await third.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(third.getByRole("status")).toContainText("Processing");
  await queue.getByRole("button", { name: "View review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /^Queue result/ }),
  ).toBeVisible();
  await expect(composer).toHaveValue("The next draft stays here");
  const notice = page
    .getByRole("status")
    .filter({ hasText: "Couldn't save viewed status" });
  await expect(notice).toBeVisible();
  markingFails = false;
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(queue.locator('[data-run-id="queue-browser-1"]')).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /^Queue result/ }),
  ).toBeVisible();
  await expect(composer).toHaveValue("The next draft stays here");
  await page.reload();
  await expect(page.locator('[data-run-id="queue-browser-1"]')).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /^Queue result/ }),
  ).toBeVisible();
  await expect(
    page.locator('[data-run-id="queue-browser-2"]').getByRole("status"),
  ).toContainText("Processing");
});

test("History filters, New to Viewed, legacy defaults and cross-browser persistence", async ({
  page,
  browser,
  request,
}) => {
  const savedDir = path.join(
    process.env.PLAYWRIGHT_CAREER_ROOT!,
    "records/reviews",
  );
  fs.mkdirSync(savedDir, { recursive: true });
  const prefix = `history-${crypto.randomUUID()}`;
  const seed = (
    suffix: string,
    viewedAt: string | null | undefined,
    decision = "undecided",
  ) => {
    const runId = `${prefix}-${suffix}`;
    const { result, analysis } = fixtureScore(
      "2026-10-30",
      undefined,
      undefined,
      runId,
    );
    result.company = `History ${suffix}`;
    fs.writeFileSync(
      path.join(savedDir, `${prefix}-${suffix}.json`),
      JSON.stringify({
        version: 2,
        result,
        analysis,
        request: { jobPost: "Python services", resume: "tech" },
        savedAt: new Date().toISOString(),
        viewedAt,
        decision,
      }),
    );
    return runId;
  };
  const fresh = seed("New", null);
  seed("Legacy", undefined);
  seed("Decided", null, "later");
  await page.goto("/apply");
  const filters = page.getByRole("group", { name: "History filter" });
  await expect(filters.getByRole("button")).toHaveText([
    /Summaries/,
    /Reviews/,
    /To apply/,
    /In progress/,
  ]);
  await expect(page.getByLabel("Search history")).toHaveCount(0);
  await filters.getByRole("button", { name: /^To apply/ }).click();
  const freshButton = page.getByRole("button", { name: /History New/ });
  await expect(freshButton.getByText("New", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: /History Legacy/ })
      .getByText("Viewed", { exact: true }),
  ).toBeVisible();
  await filters.getByRole("button", { name: /^To apply/ }).click();
  await expect(
    page.getByRole("button", { name: /History Decided/ }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  await page
    .getByLabel("Job post", { exact: true })
    .fill("Keep this next job draft");
  await freshButton.click();
  await expect(freshButton.getByText("Viewed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Job post", { exact: true })).toHaveValue(
    "Keep this next job draft",
  );
  const item = (await (await request.get("/api/reviews")).json()).items.find(
    (item: { id: string }) => item.id === fresh,
  );
  expect(item.decision).toBe("undecided");
  expect(item.viewedAt).toBeTruthy();
  await page.getByRole("radio", { name: "Quick add", exact: true }).click();
  await expect(
    filters.getByRole("button", { name: /^To apply/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto(new URL("/apply", page.url()).href);
    await showUndecidedHistory(second);
    await expect(
      second
        .getByRole("button", { name: /History New/ })
        .getByText("Viewed", { exact: true }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
  await filters.getByRole("button", { name: /^To apply/ }).click();
  await expect(
    page.getByRole("button", { name: /History Decided/ }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  await freshButton.click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByLabel("Job post", { exact: true })).toHaveValue(
    "Keep this next job draft",
  );
  await expect(freshButton).toHaveCount(0);
});

test("acceptance preserves newer input and guards repeated clicks", async ({
  page,
}) => {
  let release!: () => void,
    requests = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/score", async (route) => {
    requests++;
    await gate;
    await route.fulfill({ status: 202, json: { runId: "acceptance-browser" } });
  });
  await page.goto("/apply");
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  const composer = page.getByLabel("Job post", { exact: true });
  await composer.fill("Submitted Python engineering job. ".repeat(10));
  await page.getByRole("button", { name: /^Review job/ }).click();
  await composer.fill("New job typed before acceptance. ".repeat(10));
  await composer.press("Control+Enter");
  await expect(page.getByRole("button", { name: /^Queuing/ })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: /^Review job/ })).toBeEnabled();
  await expect(composer).toHaveValue(
    "New job typed before acceptance. ".repeat(10),
  );
  expect(requests).toBe(1);
});

test("progress bounds completed rows, keeps recovery controls, and retains rejected drafts", async ({
  page,
}) => {
  const jobs: ReviewJobStatus[] = Array.from({ length: 5 }, (_, n) => ({
    runId: `completed-${n}`,
    status: "done",
    running: false,
    step: null,
    elapsedMs: 200,
    startedAt: 1,
    finishedAt: n + 10,
    preview: `Completed job ${n}`,
  }));
  jobs.push(
    ...(["paused", "interrupted"] as const).map((status) => ({
      runId: `recovery-${status}`,
      status,
      running: false,
      step: null,
      elapsedMs: 0,
      startedAt: null,
      preview: `Recovery ${status}`,
    })),
  );
  await page.route("**/api/score/status", (route) =>
    route.fulfill({ json: { jobs } }),
  );
  await page.route("**/api/score", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: "TEST_FAILURE", message: "Fixture submission rejected" },
      },
    }),
  );
  await page.goto("/apply");
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  const queue = page.getByRole("region", { name: "Review progress" });
  await expect(
    queue.getByRole("button", { name: "View review", exact: true }),
  ).toHaveCount(3);
  await expect(
    queue.getByRole("button", { name: "Resume", exact: true }),
  ).toHaveCount(2);
  await expect(queue.locator('[data-run-id="completed-4"]')).toBeVisible();
  await expect(queue.locator('[data-run-id="completed-0"]')).toHaveCount(0);
  await queue.getByRole("button", { name: "Show all 5 completed" }).click();
  await expect(
    queue.getByRole("button", { name: "View review", exact: true }),
  ).toHaveCount(5);
  await queue.getByRole("button", { name: "Show fewer" }).click();
  const draft = "Rejected Python engineering job. ".repeat(10);
  await page.getByLabel("Job post", { exact: true }).fill(draft);
  await page.getByRole("button", { name: /^Review job/ }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Fixture submission rejected" }),
  ).toBeVisible();
  await expect(page.getByLabel("Job post", { exact: true })).toHaveValue(draft);
});
