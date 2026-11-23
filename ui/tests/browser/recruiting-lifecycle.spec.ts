import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
test("connected updates, grouped history, matching, research and closure across desktop/mobile", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const added = await request.post("/api/quick", {
    data: {
      source: "LinkedIn",
      jobs: [
        {
          description:
            "Lifecycle Company\nCompany information with no title or job responsibilities.",
          link: "https://example.test/lifecycle-role",
        },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  const saved = (await added.json()).added[0].quickId;
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows.find((r: { recordId: string }) => r.recordId === saved);
  expect(row).toMatchObject({ role: "Software Engineer", source: "LinkedIn" });
  const recruiting = await (await request.get("/api/recruiting")).json();
  const submission = recruiting.events.find(
    (e: { kind: string; recordId?: string }) =>
      e.kind === "submitted" && e.recordId === saved,
  );
  expect(submission?.discoveredAt).toBeTruthy();
  const now = new Date().toISOString(),
    past = new Date(Date.now() - 6 * 86400000).toISOString();
  const action = (id: string, text: string) => ({
    id,
    externalKeys: [`gmail:lifecycle:${id}`],
    revision: 1,
    text,
    company: row.company,
    role: row.role,
    application: { rowKey: row.key, recordId: row.recordId },
    state: "completed",
    createdAt: past,
    updatedAt: past,
    completedAt: past,
    explanation: "A distinct recruiting request with its own source email.",
    email: {
      threadId: "lifecycle",
      messageId: id,
      receivedAt: past,
      url: "https://mail.google.com/mail/u/0/#all/lifecycle",
    },
  });
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({
      version: 1,
      importedNext: true,
      actions: [
        action("11111111-1111-4111-8111-111111111110", "Technical assessment"),
        action(
          "11111111-1111-4111-8111-111111111120",
          "Recruiter questionnaire",
        ),
      ],
    }),
  );
  fs.writeFileSync(
    path.join(root, "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now,
      events: [
        submission,
        {
          id: "confirmed:lifecycle",
          applicationKey: row.key,
          recordId: row.recordId,
          kind: "response",
          at: past,
          title: "Assessment confirmed",
          description: "Employer received the assessment.",
          email: "https://mail.google.com/mail/u/0/#all/lifecycle",
          responseExpected: true,
          notify: true,
          seen: false,
        },
      ],
      workflows: [],
      pending: [],
    }),
  );
  const reportId = "c33ca606-88d7-4e6e-a6d3-8a7b181ba9ab";
  const researchPath = path.join(root, "records/opportunities");
  fs.mkdirSync(researchPath, { recursive: true });
  fs.writeFileSync(
    path.join(researchPath, `${reportId}.json`),
    JSON.stringify({
      id: reportId,
      opportunityKey: row.key,
      fingerprint: "lifecycle-opportunity",
      company: row.company,
      role: row.role,
      applicationKey: row.key,
      recordId: row.recordId,
      receivedAt: past,
      researchedAt: now,
      depth: "full",
      complete: true,
      verdict: "Give It a Try",
      markdown: "Fixture recruiting research",
      sources: [],
    }),
  );
  fs.writeFileSync(
    path.join(researchPath, `${reportId}.md`),
    "# Fixture recruiting research\n",
  );
  expect(
    (await request.get(`/guide/records/opportunities/${reportId}.md`)).ok(),
  ).toBe(true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/actions");
    await page.getByRole("button", { name: /^Completed(?: \d+)?$/ }).click();
    await expect(
      page.getByRole("button", { name: "Timeline", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText("Technical assessment", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Recruiter questionnaire", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const status = dialog.getByText("Awaiting employer response", {
      exact: true,
    });
    await expect(status).toBeVisible();
    await expect(status.locator("svg")).toHaveClass(/text-success/);
    const first = dialog
      .getByLabel("Activity timeline")
      .getByRole("listitem")
      .last();
    await expect(first.getByRole("heading")).toHaveText("Applied");
    await expect(first.getByText("Via LinkedIn")).toBeVisible();
    // One date only: when it was marked applied.
    await expect(first.locator("time")).toHaveCount(1);
    await expect(first.getByRole("link")).toHaveCount(0);
    await expect(
      dialog
        .getByLabel("Activity timeline")
        .getByText("Assessment confirmed", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Job Info", exact: true }).click();
    await expect(
      dialog.getByRole("link", { name: /^Opportunity Check/ }),
    ).toHaveAttribute("href", `/guide/records/opportunities/${reportId}.md`);
    await expect(
      dialog.getByRole("button", { name: /Create Review/i }),
    ).toBeVisible();
    await expect(dialog.getByText(/Create Opportunity Check/)).toHaveCount(0);
    await expect(dialog.getByLabel("Job summary")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.cache/playwright/lifecycle-completed-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(
    page.getByText("Technical assessment", { exact: true }),
  ).toBeHidden();
  await page
    .locator("summary")
    .filter({ hasText: /^View hidden \(1\)$/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Unhide", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Technical assessment", { exact: true }),
  ).toBeVisible();
  await page.goto("/");
  const updates = page.getByRole("region", { name: "Recruiting updates" });
  await expect(updates.getByText(/^Assessment confirmed/)).toBeVisible();
  await updates
    .getByRole("button", { name: "Job Summary", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Job summary"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const current = await (await request.get("/api/applications")).json();
  expect(
    (
      await request.patch("/api/applications", {
        data: { fileHash: current.fileHash, key: row.key, status: "rejected" },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/actions");
  await page.getByRole("button", { name: /^Completed(?: \d+)?$/ }).click();
  await expect(
    page.getByText("Technical assessment", { exact: true }),
  ).toHaveCount(0);
  // Closed never hides history, even for a job hidden in Completed.
  await page.getByRole("button", { name: /^Closed(?: \d+)?$/ }).click();
  await expect(page.getByText("2 completed", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Timeline", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog").getByText("Rejected / Closed", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByLabel("Activity timeline")
      .getByRole("heading", { name: "Technical assessment", exact: true }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
test("Needs matching persists and links the exact selected tracker application", async ({
  page,
  request,
}) => {
  const apps = await (await request.get("/api/applications")).json();
  // Startup may age the Acme fixture to No Response, and the preceding test
  // adds a rejected application. Match the fixture by identity in either case.
  const row = apps.rows.find((r: { company: string }) => r.company === "Acme");
  expect(row).toBeTruthy();
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({ version: 1, importedNext: true, actions: [] }),
  );
  fs.writeFileSync(
    path.join(root, "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now,
      events: [],
      workflows: [],
      pending: [
        {
          id: "match:lifecycle",
          summary: "Choose an application for this recruiter request",
          reason: "Several roles could match",
          email: "https://mail.google.com/mail/u/0/#all/match",
          receivedAt: now,
          action: {
            externalKey: "gmail:match:questionnaire",
            text: "Answer recruiter questions",
            email: {
              threadId: "match",
              messageId: "match",
              receivedAt: now,
              url: "https://mail.google.com/mail/u/0/#all/match",
            },
          },
        },
      ],
    }),
  );
  await page.goto("/actions?filter=decisions");
  await expect(
    page.getByRole("region", { name: "Needs attention" }),
  ).toBeVisible();
  await page
    .getByText("Choose an application for this recruiter request", {
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Choose matching application" })
    .click();
  await page
    .getByRole("combobox", { name: "Search applications" })
    .fill(row.company);
  await page
    .getByRole("option", {
      name: `${row.company} ${row.role} · ${row.date} · ${row.status}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Confirm application", exact: true })
    .click();
  // The confirmed request is now a ready task, so it lives on Open.
  await page.getByRole("button", { name: /^Open/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Answer recruiter questions",
      exact: true,
    }),
  ).toBeVisible();
  const tasks = await (await request.get("/api/actions")).json();
  expect(tasks.actions).toHaveLength(1);
  expect(tasks.actions[0].application.rowKey).toBe(row.key);
  await page.getByRole("button", { name: "Job Summary", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(row.role);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByLabel("Activity timeline")
      .getByRole("heading", {
        name: "Answer recruiter questions",
        exact: true,
      }),
  ).toBeVisible();
  await page.goto("/actions");
  await expect(
    page.getByRole("heading", {
      name: "Answer recruiter questions",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/actions")).json()).actions,
  ).toHaveLength(1);
});
test("explicit creation can save an unsubmitted recruiter opportunity without inventing an application", async ({
  page,
  request,
}) => {
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({ version: 1, importedNext: true, actions: [] }),
  );
  fs.writeFileSync(
    path.join(root, "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now,
      events: [],
      workflows: [],
      pending: [
        {
          id: "new-company",
          summary: "New company recruiting request",
          reason: "No tracker entry",
          email: "https://mail.google.com/mail/u/0/#all/newcompany",
          receivedAt: now,
          action: {
            externalKey: "gmail:newcompany:reply",
            text: "Reply to new recruiter",
            email: {
              threadId: "newcompany",
              messageId: "newcompany",
              receivedAt: now,
              url: "https://mail.google.com/mail/u/0/#all/newcompany",
            },
          },
        },
      ],
    }),
  );
  await page.goto("/actions?filter=decisions");
  await page
    .getByText("New company recruiting request", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create application", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Company", exact: true })
    .fill("New Lifecycle Employer");
  await page
    .getByRole("textbox", { name: "Role", exact: true })
    .fill("Recruiter opportunity");
  await expect(page.getByLabel("New application status")).toHaveValue("later");
  await page
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm application", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm application", exact: true })
    .click();
  await page.getByRole("button", { name: /^Open/ }).click();
  await expect(
    page.getByRole("heading", { name: "Reply to new recruiter", exact: true }),
  ).toBeVisible();
  const apps = await (await request.get("/api/applications")).json();
  expect(
    apps.rows.find(
      (r: { company: string }) => r.company === "New Lifecycle Employer",
    ).status,
  ).toBe("to apply");
  // The open task sits in its job's card; Job Summary is in that card's footer.
  const card = page
    .locator("section")
    .filter({ hasText: "Reply to new recruiter" });
  await expect(card.getByText(/^Applied /)).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Job Summary" })).toBeEnabled();
});

test("Actions shows one card per request and lets users dismiss mail-only reviews", async ({
  page,
  request,
}) => {
  const now = new Date().toISOString();
  const discovery = (messageId: string, summary: string) => ({
    messageId,
    threadId: messageId,
    url: `https://mail.google.com/mail/u/0/#all/${messageId}`,
    receivedAt: now,
    kind: "uncertain",
    summary,
    reviewReason: "Application identity is unclear",
  });
  const duplicate = discovery("duplicate", "Duplicate mail card");
  const mailOnly = discovery("mail-only", "Mail-only review");
  fs.writeFileSync(
    path.join(root, "records/actions.json"),
    JSON.stringify({ version: 1, importedNext: true, actions: [] }),
  );
  fs.writeFileSync(
    path.join(root, "records/mail-sync.json"),
    JSON.stringify({
      version: 1,
      discoveries: [duplicate, mailOnly],
      interactions: {},
    }),
  );
  fs.writeFileSync(
    path.join(root, "records/recruiting.json"),
    JSON.stringify({
      version: 1,
      startedAt: now,
      events: [],
      workflows: [],
      pending: [
        {
          id: "gmail:duplicate:match",
          summary: "Match this recruiter request",
          reason: duplicate.reviewReason,
          email: duplicate.url,
          receivedAt: now,
        },
      ],
    }),
  );

  await page.goto("/actions?filter=decisions");
  const matching = page.getByRole("region", { name: "Needs attention" });
  await expect(
    matching.getByText("Match this recruiter request"),
  ).toBeVisible();
  const review = page.getByRole("region", { name: "Mail-only review" });
  await expect(
    page.getByRole("heading", { name: "Mail-only review" }),
  ).toBeVisible();
  await expect(page.getByText("Duplicate mail card")).toHaveCount(0);
  await review.getByRole("button", { name: "Dismiss request" }).click();
  await expect(review).toHaveCount(0);
  await matching.getByRole("button", { name: "Dismiss request" }).click();
  await expect(matching).toHaveCount(0);
  await page.goto("/actions?filter=all");
  await expect(
    page.getByText("You're all caught up!", { exact: true }),
  ).toBeVisible();
  const saved = await (await request.get("/api/mail")).json();
  expect(
    saved.discoveries.find(
      (item: { messageId: string }) => item.messageId === "mail-only",
    ).dismissedAt,
  ).toBeTruthy();
});
