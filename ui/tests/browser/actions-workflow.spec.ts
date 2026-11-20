import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
test.beforeEach(async ({ request }) => {
  const apps = await (await request.get("/api/applications")).json();
  if (apps.rows[0] && ["rejected", "no response"].includes(apps.rows[0].status))
    await request.patch("/api/applications", {
      data: {
        fileHash: apps.fileHash,
        key: apps.rows[0].key,
        status: "applied",
      },
    });
});
test("New shows once, in-place summary, no priority, completion and dismissal", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows[0];
  const now = new Date().toISOString();
  const id = "11111111-1111-4111-8111-111111111111";
  const action = {
    id,
    externalKeys: ["gmail:t:ask"],
    revision: 1,
    text: "Complete the assessment",
    company: row.company,
    role: row.role,
    application: { rowKey: row.key },
    explanation: "Complete this assessment in one sitting.",
    priority: "medium",
    state: "open",
    createdAt: now,
    updatedAt: now,
    email: {
      messageId: "m",
      threadId: "t",
      receivedAt: now,
      url: "https://mail.google.com/mail/u/0/#all/t",
    },
  };
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        action,
        {
          ...action,
          id: "22222222-2222-4222-8222-222222222222",
          externalKeys: ["gmail:t:older"],
          text: "Older high priority task",
          priority: "high",
        },
      ],
      lastCheck: {
        runId: "fixture",
        startedAt: now,
        completedAt: now,
        changes: [{ id, activityId: "m", kind: "new" }],
      },
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let visit = 0;
  for (const width of [1280, 390])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
      await page.goto("/actions");
      // New is shown on the first visit only; displaying it saves it as seen.
      if (visit++ === 0)
        await expect(page.getByText("New", { exact: true })).toBeVisible();
      else await expect(page.getByText("New", { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "New", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Needs confirmation", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator("li h3").first()).toHaveText(
        "Complete the assessment",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.cache/playwright/actions-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  await page
    .getByRole("button", { name: "Job Summary", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(page.url()).toContain("/actions");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove entry", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Change status" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Priority:/ })).toHaveCount(0);
  await expect(page.getByText(/^(High|Medium|Low)$/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mark Completed", exact: true })
    .first()
    .click();
  expect(
    (await (await request.get("/api/actions")).json()).actions.find(
      (a: { id: string }) => a.id === id,
    ).state,
  ).toBe("open");
  await page
    .getByRole("button", {
      name: "Cancel completion: Complete the assessment",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Mark Completed", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", {
      name: "Confirm completion: Complete the assessment",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /^Completed(?: \d+)?$/ }).click();
  await expect(page.locator(`#action-${id}`)).toContainText(
    "Complete the assessment",
  );
  await page.reload();
  await page.getByRole("button", { name: /^Completed(?: \d+)?$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Complete the assessment", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Complete the assessment", exact: true }),
  ).toHaveCount(0);
  await page
    .locator("summary")
    .filter({ hasText: /^View hidden \(1\)$/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Complete the assessment", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unhide", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unhide", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("unlinked decisions keep their order and show no priority", async ({
  page,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const now = new Date().toISOString();
  const base = {
    externalKeys: ["gmail:p:first"],
    revision: 1,
    company: "Example",
    role: "Engineer",
    state: "open",
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        {
          ...base,
          id: "11111111-1111-4111-8111-111111111111",
          text: "First task",
          priority: "high",
        },
        {
          ...base,
          id: "22222222-2222-4222-8222-222222222222",
          externalKeys: ["gmail:p:second"],
          text: "Second task",
          priority: "medium",
        },
      ],
    }),
  );
  // Tasks with no application are decisions until matched.
  await page.goto("/actions?filter=decisions");
  await expect(page.locator("li h3").first()).toHaveText("First task");
  await expect(page.getByRole("button", { name: /^Priority:/ })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("li h3").first()).toHaveText("First task");
});

test("dismiss uses inline confirm and cancel without a browser dialog", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const now = new Date().toISOString();
  const id = "44444444-4444-4444-8444-444444444444";
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        {
          id,
          externalKeys: ["gmail:dismiss:ask"],
          revision: 1,
          text: "Dismiss this task",
          company: "Example",
          state: "open",
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  // Tasks with no application are decisions until matched.
  await page.goto("/actions?filter=decisions");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Confirm dismissal" }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/actions")).json()).actions,
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Cancel dismissal: Dismiss this task" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dismiss this task" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm dismissal: Dismiss this task" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dismiss this task" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Nothing needs your decision.", { exact: true }),
  ).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(
    (await (await request.get("/api/actions")).json()).actions,
  ).toHaveLength(1);
});

test("review evidence, uncertain relationships and stale confirmation stay safe", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const now = new Date().toISOString();
  const file = path.join(root, "records/actions.json");
  const action = {
    id: "55555555-5555-4555-8555-555555555555",
    externalKeys: ["gmail:review:reply"],
    revision: 1,
    text: "Answer recruiter questions",
    company: "Hiring employer",
    contactOrganization: "Recruiting partner",
    relationship: "agency",
    reviewReason: "Confirm which role this concerns",
    priority: "low",
    deadline: {
      kind: "requested",
      date: "2026-11-05",
      wording: "Please reply by Thursday",
    },
    completionSuggestion: {
      identity: "sent:reply",
      reason: "Sent reply answers the requested details",
      messageId: "sent",
      url: "https://mail.google.com/mail/u/0/#all/review",
      at: now,
    },
    state: "open",
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      importedNext: true,
      lastIncompleteAt: now,
      actions: [action],
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Tasks with no application are decisions until matched.
  await page.goto("/actions?filter=decisions");
  await expect(
    page.getByText("Recruitment Agency", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/actions")).json()).actions[0]
      .contactOrganization,
  ).toBe("Recruiting partner");
  await expect(
    page.getByText(action.reviewReason, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/latest check was incomplete/)).toBeVisible();
  await expect(page.getByTitle(action.deadline.wording)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View evidence" }),
  ).toHaveAttribute("href", action.completionSuggestion.url);
  await page.getByRole("button", { name: "Keep open", exact: true }).click();
  await expect(page.getByRole("link", { name: "View evidence" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText(action.reviewReason, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mark Completed", exact: true })
    .click();
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  current.actions[0].revision++;
  current.actions[0].text = "Newer request details";
  fs.writeFileSync(file, JSON.stringify(current));
  await page
    .getByRole("button", {
      name: "Confirm completion: Answer recruiter questions",
    })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Newer request details" }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/actions")).json()).actions[0].state,
  ).toBe("open");
  expect(errors).toEqual([]);
});

test("Quick recovery adds linked cards and Daily refreshes additive markers", async ({
  page,
  request,
}) => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const ui = path.resolve(import.meta.dirname, "../..");
  const cli = (command: string, operation: string, input?: unknown) => {
    const args = [path.join(ui, "scripts/apps.ts"), command, operation];
    if (input) {
      const file = path.join(root, "quick-check-input.json");
      fs.writeFileSync(file, JSON.stringify(input));
      args.push("--input", file);
    }
    return JSON.parse(
      execFileSync(path.join(ui, "node_modules/.bin/tsx"), args, {
        env: { ...process.env, CAREER_ROOT: root },
        encoding: "utf8",
      }),
    );
  };
  const row = (await (await request.get("/api/applications")).json()).rows[0];
  fs.rmSync(path.join(root, "records/actions.json"), { force: true });
  const dailyStart = new Date(Date.now() - 120000).toISOString();
  const quickStart = new Date(Date.now() - 60000).toISOString();
  const makeTask = (key: string, text: string) => ({
    externalKey: `gmail:t:${key}`,
    text,
    company: row.company,
    role: row.role,
    application: { rowKey: row.key },
    email: {
      threadId: "t",
      messageId: key,
      url: "https://mail.google.com/mail/u/0/#all/t",
    },
  });
  let saved = cli("actions", "sync", {
    fileHash: cli("actions", "list").fileHash,
    complete: true,
    actions: [makeTask("daily", "Reply to the employer")],
  });
  cli("actions", "finalize", {
    fileHash: saved.fileHash,
    runId: "daily",
    startedAt: dailyStart,
    complete: true,
  });
  saved = cli("actions", "sync", {
    fileHash: cli("actions", "list").fileHash,
    complete: false,
    scope: "quick",
    actions: [makeTask("quick", "Schedule the interview")],
  });
  // Lost publication response: retry with no explicit changes recovers the saved Quick finding.
  cli("actions", "finalize", {
    fileHash: saved.fileHash,
    scope: "quick",
    complete: true,
    runId: "quick",
    startedAt: quickStart,
    changes: [],
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let visit = 0;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/actions");
    // Both tasks share one job card: one New chip, a New dot per task, and only on the first visit.
    if (visit++ === 0) {
      await expect(page.getByText("New", { exact: true })).toHaveCount(1);
      await expect(page.locator("[data-new-dot]")).toHaveCount(2);
    } else await expect(page.getByText("New", { exact: true })).toHaveCount(0);
    const heading = page.getByRole("heading", {
      name: "Schedule the interview",
      exact: true,
    });
    const row = page.locator("li").filter({ has: heading });
    await expect(row.getByRole("link", { name: "View email" })).toHaveAttribute(
      "href",
      "https://mail.google.com/mail/u/0/#all/t",
    );
    await page
      .locator("section")
      .filter({ has: heading })
      .getByRole("button", { name: "Job Summary" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.cache/playwright/quick-recovery-${width}.png`,
      fullPage: true,
    });
  }
  saved = cli("actions", "list");
  cli("actions", "finalize", {
    fileHash: saved.fileHash,
    scope: "quick",
    complete: true,
    runId: "empty",
    startedAt: new Date(Date.now() - 30000).toISOString(),
    changes: [],
  });
  await page.reload();
  // Seen markers stay seen across later finalizations that bring nothing new.
  await expect(page.getByText("New", { exact: true })).toHaveCount(0);
  cli("actions", "finalize", {
    fileHash: cli("actions", "list").fileHash,
    complete: true,
    runId: "next-daily",
    startedAt: new Date().toISOString(),
    changes: [],
  });
  await page.reload();
  await expect(page.getByText("New", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
