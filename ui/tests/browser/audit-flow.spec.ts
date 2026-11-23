import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Fixture server with disposable career data (see scripts/browser-tests.mjs).
const root = () => process.env.PLAYWRIGHT_CAREER_ROOT!;
const now = () => new Date().toISOString();
const email = (id: string) => ({
  threadId: id,
  messageId: id,
  receivedAt: now(),
  url: `https://mail.google.com/mail/u/0/#all/${id}`,
});
const task = (
  id: string,
  text: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  externalKeys: [`gmail:${id}:ask`],
  revision: 1,
  text,
  priority: "medium",
  state: "open",
  createdAt: now(),
  updatedAt: now(),
  email: email(id),
  ...extra,
});

// The fixture row ages to "no response" at startup; every test needs an open application.
test.beforeEach(async ({ request }) => {
  const apps = await (await request.get("/api/applications")).json();
  if (apps.rows[0] && apps.rows[0].status !== "applied")
    await request.patch("/api/applications", {
      data: {
        fileHash: apps.fileHash,
        key: apps.rows[0].key,
        status: "applied",
      },
    });
});

test("Open lists only ready tasks; decisions live in their own labeled tab", async ({
  page,
  request,
}) => {
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows[0];
  fs.writeFileSync(
    path.join(root(), "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        task(
          "11111111-1111-4111-8111-111111111111",
          "Take the online assessment",
          {
            company: row.company,
            role: row.role,
            application: { rowKey: row.key },
          },
        ),
      ],
    }),
  );
  fs.writeFileSync(
    path.join(root(), "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now(),
      events: [],
      workflows: [],
      pending: [
        {
          id: "gmail:flow:match",
          company: "Flow",
          role: "Software Engineer",
          summary: "LinkedIn reports an application delivery failure",
          reason:
            "Two Flow applications were logged; confirm which one failed.",
          email: email("flow").url,
          receivedAt: now(),
          action: {
            externalKey: "gmail:flow:finish-application",
            text: "Complete the Flow application on the company site",
            explanation: "LinkedIn says your application did not complete.",
            advancesStatus: false,
            email: email("flow"),
          },
        },
      ],
    }),
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // Decisions is the landing tab while anything needs one, so ask for Open.
    await page.goto("/actions?filter=all");
    // Open shows the ready-to-do task and no decision block.
    await expect(
      page.getByText("Take the online assessment", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: /Needs attention/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Open\s*1$/ }),
    ).toBeVisible();
    // The request that needs matching is counted in Decisions, not Open.
    await page.getByRole("button", { name: /^Decisions\s*1$/ }).click();
    const decision = page.getByRole("region", { name: /Needs attention/ });
    await expect(decision).toBeVisible();
    // The card says what kind of decision it is and leads with the task it will become.
    await expect(decision.getByText("Request to match")).toBeVisible();
    await expect(
      decision.getByRole("heading", {
        name: "Complete the Flow application on the company site",
      }),
    ).toBeVisible();
    await expect(decision.getByText("Why it needs you:")).toBeVisible();
    await expect(decision.getByText("Take the online assessment")).toHaveCount(
      0,
    );
  }
});

test("Delete on the Closed tab removes the action history but keeps the application", async ({
  page,
  request,
}) => {
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows[0];
  const id = "22222222-2222-4222-8222-222222222222";
  fs.writeFileSync(
    path.join(root(), "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        task(id, "Send availability", {
          company: row.company,
          role: row.role,
          application: { rowKey: row.key },
          state: "completed",
          completedAt: now(),
          manuallyClosedAt: now(),
        }),
      ],
    }),
  );
  fs.writeFileSync(
    path.join(root(), "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now(),
      events: [],
      workflows: [],
      pending: [],
    }),
  );
  await page.goto("/actions?filter=closed");
  await expect(page.getByText("Closed by you")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Confirm delete" }),
  ).toBeVisible();
  // Cancel keeps everything.
  await page.getByRole("button", { name: "Cancel delete" }).click();
  await expect(page.getByRole("group", { name: "Confirm delete" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByText("No closed actions.")).toBeVisible();
  const after = await (await request.get("/api/actions")).json();
  expect(after.actions).toHaveLength(0);
  expect(
    after.dismissed.some((d: { externalKeys: string[] }) =>
      d.externalKeys.includes(`gmail:${id}:ask`),
    ),
  ).toBe(true);
  const stillThere = await (await request.get("/api/applications")).json();
  expect(
    stillThere.rows.some((r: { company: string }) => r.company === row.company),
  ).toBe(true);
});

test("the application summary can be edited with a check mark and keeps its tasks attached", async ({
  page,
  request,
}) => {
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows[0];
  const id = "33333333-3333-4333-8333-333333333333";
  fs.writeFileSync(
    path.join(root(), "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        task(id, "Reply to recruiter", {
          company: row.company,
          role: row.role,
          application: { rowKey: row.key },
        }),
      ],
    }),
  );
  fs.writeFileSync(
    path.join(root(), "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now(),
      events: [],
      workflows: [],
      pending: [],
    }),
  );
  await page.goto("/tracker");
  await page
    .getByText(row.company, { exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  const form = dialog.getByRole("region", { name: "Edit application" });
  await form.getByLabel("Company").fill("Edited Employer");
  await form.getByLabel("Role").fill("Principal Engineer");
  await form.getByLabel("Posting link").fill("https://example.test/edited");
  // Escape cancels the edit without closing the dialog.
  await form.getByLabel("Role").press("Escape");
  await expect(form).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await form.getByLabel("Company").fill("Edited Employer");
  await form.getByLabel("Role").fill("Principal Engineer");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByText("Edited Employer")).toBeVisible();
  await expect(dialog.getByText("Principal Engineer")).toBeVisible();
  const saved = await (await request.get("/api/applications")).json();
  const edited = saved.rows.find(
    (r: { company: string }) => r.company === "Edited Employer",
  );
  expect(edited.role).toBe("Principal Engineer");
  expect(edited.recordId).toBeTruthy();
  // The task followed the application to its new key.
  const tasks = await (await request.get("/api/actions")).json();
  expect(tasks.actions[0].application).toMatchObject({ rowKey: edited.key });
  // And it still resolves on the Actions page.
  await page.goto("/actions");
  await expect(
    page.getByRole("region", { name: /Needs attention/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Decisions/ })).toHaveCount(0);
  await expect(
    page.getByText("Reply to recruiter", { exact: true }),
  ).toBeVisible();
});

test("Quick Add drafts survive a refresh and come back when the request fails", async ({
  page,
}) => {
  const jobText =
    "Draft Co — Platform Engineer. Build reliable data pipelines with Python and PostgreSQL for a growing team.";
  await page.goto("/apply");
  const job = page.getByLabel("Job 1 description", { exact: true });
  await job.fill(jobText);
  await page.reload();
  await expect(
    page.getByLabel("Job 1 description", { exact: true }),
  ).toHaveValue(jobText);
  // Switching pages does not clear them either.
  await page
    .getByRole("link", { name: /Tracker/ })
    .first()
    .click();
  await page.goto("/apply");
  await expect(
    page.getByLabel("Job 1 description", { exact: true }),
  ).toHaveValue(jobText);

  // Server rejects the request: the composer is cleared at first, then the job comes back.
  await page.route("**/api/quick", (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: "BOOM", message: "Server exploded" } },
    }),
  );
  await page.getByRole("button", { name: /^Quick add/ }).click();
  await expect(
    page.getByText(/Your jobs are back in the editor/),
  ).toBeVisible();
  await expect(
    page.getByLabel("Job 1 description", { exact: true }),
  ).toHaveValue(jobText);

  // A dropped connection behaves the same.
  await page.unroute("**/api/quick");
  await page.route("**/api/quick", (route) => route.abort());
  await page.getByRole("button", { name: /^Quick add/ }).click();
  await expect(page.getByText(/back in the editor/)).toBeVisible();
  await expect(
    page.getByLabel("Job 1 description", { exact: true }),
  ).toHaveValue(jobText);
});

test("a batch the server never received is restored after a refresh", async ({
  page,
}) => {
  const jobText =
    "Lost Co — Backend Engineer. Own services written in Go and Postgres for a payments platform.";
  await page.addInitScript((text) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.removeItem("career-ui.quick.drafts");
    localStorage.setItem(
      "career-ui.quick.inflight",
      JSON.stringify([
        {
          batchId: "00000000-0000-4000-8000-000000000000",
          at: Date.now(),
          drafts: [
            {
              id: "abc12345",
              submissionId: "11111111-1111-4111-8111-111111111111",
              url: "",
              description: text,
            },
          ],
        },
      ]),
    );
  }, jobText);
  await page.goto("/apply");
  await expect(
    page.getByLabel("Job 1 description", { exact: true }),
  ).toHaveValue(jobText);
  await expect(page.getByText(/back in the editor/)).toBeVisible();
});

test("History sidebar shows the four filters as a vertical list with counts", async ({
  page,
}, info) => {
  const stamp = now();
  const make = (id: string, company: string, kind: string, status: string) => ({
    id,
    company,
    kind,
    status,
    role: "Role",
    fit: 80,
    match: 70,
    reviewedAt: stamp.slice(0, 10),
    savedAt: stamp,
    decision: "submitted",
    viewedAt: stamp,
  });
  await page.route("**/api/reviews", (route) =>
    route.fulfill({
      json: {
        items: [
          make("q1", "Acme", "quick", "applied"),
          make("r1", "Beta", "review", "applied"),
          make("r2", "Gamma", "review", "to apply"),
          make("r3", "Delta", "review", "in progress"),
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apply");
  const filters = page.getByRole("group", { name: "History filter" });
  const buttons = filters.getByRole("button");
  await expect(buttons).toHaveCount(4);
  const tops = await buttons.evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(4); // stacked, not a 2×2 grid
  await expect(
    filters.getByRole("button", { name: /^In progress\s*1$/ }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("history-sidebar.png") });
});

test("Quick Add progress sits directly under the stats card and shows how many are added", async ({
  page,
}) => {
  const running = {
    batchId: "99999999-9999-4999-8999-999999999999",
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: null,
    status: "running",
    provider: "claude",
    source: "Other",
    // Status lists carry links only; the pasted text is fetched per batch on demand.
    jobLinks: [],
    totalCount: 12,
    added: [],
    skipped: Array.from({ length: 5 }, (_, i) => ({
      job: i + 1,
      reason: "skipped",
    })),
    remaining: Array.from({ length: 7 }, (_, i) => i + 6),
    viewedAt: null,
  };
  await page.route("**/api/quick/status", (route) =>
    route.fulfill({ json: { runningCount: 1, batches: [running] } }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apply");
  const bar = page.getByRole("progressbar", { name: "Quick Add progress" });
  await expect(bar).toHaveAttribute("aria-valuenow", "5");
  await expect(bar).toHaveAttribute("aria-valuemax", "12");
  await expect(page.getByText("Adding jobs · 5 of 12")).toBeVisible();
  // Order on the page: stats card, then the progress bar, then the Quick add form.
  const stats = await page.getByText("All time").boundingBox();
  const barBox = await bar.boundingBox();
  const form = await page
    .getByLabel("Job 1 description", { exact: true })
    .boundingBox();
  expect(stats!.y).toBeLessThan(barBox!.y);
  expect(barBox!.y).toBeLessThan(form!.y);
  expect(errors).toEqual([]);
});

test("a Quick Add job with no company gets its own red alert that can be fixed in place", async ({
  page,
  request,
}, info) => {
  const pasted =
    "Unknown — Platform Engineer. Build reliable data pipelines with Python and PostgreSQL for a growing team.";
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/apply");
  await page.getByLabel("Job 1 description", { exact: true }).fill(pasted);
  await page.getByRole("button", { name: /^Quick add/ }).click();
  // Separate from the normal "Added 1 job" result.
  await expect(page.getByRole("button", { name: /Added 1 job/ })).toBeVisible();
  const alert = page.getByRole("alert").filter({ hasText: "needs a company" });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveClass(/border-destructive/);
  // The bell turns red too.
  await expect(
    page.getByRole("button", { name: /^Quick Add activity/ }),
  ).toHaveClass(/text-destructive/);
  // A refresh keeps the alert until it is fixed.
  await page.reload();
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: /needs a company/ }).click();
  await alert.getByRole("button", { name: "View pasted" }).click();
  await expect(alert.getByText(/Build reliable data pipelines/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("missing-info.png") });
  // The company is required before saving.
  await alert.getByRole("button", { name: /^Save/ }).click();
  await expect(alert.getByText(/Enter the company/)).toBeVisible();
  await alert.getByLabel(/^Company/).fill("Pipeline Co");
  await alert.getByLabel(/^Company/).press("Enter");
  await expect(alert).toHaveCount(0);
  const rows = (await (await request.get("/api/applications")).json()).rows;
  expect(
    rows.some(
      (r: { company: string; role: string }) =>
        r.company === "Pipeline Co" && r.role === "Platform Engineer",
    ),
  ).toBe(true);
  await page.reload();
  await expect(alert).toHaveCount(0);
});
