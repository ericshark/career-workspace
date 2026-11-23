import { submitAndOpenReview } from "./reviewHelpers";
import { fixtureScore } from "../../src/lib/claude/fixtures";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const post =
  "Fixture Co — Backend Engineer (New Grad). Posted 2 days ago. Requirements: Python, PostgreSQL, OAuth2, Redis, CI/CD. Nice: AWS. ".repeat(
    3,
  );

test("keyboard menus, segmented controls, named modal, trapped focus and opener restoration", async ({
  page,
}) => {
  await page.goto("/tracker");
  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await filter.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemcheckbox").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(filter).toBeFocused();
  const opener = page.getByRole("row").filter({ hasText: "Acme" }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Acme/ });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("No saved job summary is available for this application."),
  ).toBeVisible();
  expect(await page.locator("[data-aria-hidden]").count()).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByRole("menuitemradio").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.locator("[data-aria-hidden]").count()).toBe(0);
  await expect(opener).toBeFocused();
});

test("review refresh, tailored auto-selection and the tailored PDF link", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/apply");
  // Quick add is the default mode; reviews are one click away.
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  const reviewModels = page.getByRole("radiogroup", {
    name: "Review model",
    exact: true,
  });
  const tailorModels = page.getByRole("radiogroup", {
    name: "Tailor model",
    exact: true,
  });
  // Model choices live behind the Models settings button.
  const modelSettings = page.getByRole("button", {
    name: "Model settings",
    exact: true,
  });
  await modelSettings.click();
  await page
    .getByRole("radiogroup", { name: "Provider", exact: true })
    .getByRole("radio", { name: "Claude", exact: true })
    .click();
  await reviewModels
    .getByRole("radio", { name: "Haiku 5.5", exact: true })
    .click();
  await page.keyboard.press("Escape");
  let requestedTailorModel: string | undefined;
  let requestedTailorBody: Record<string, unknown> | undefined;
  page.on("request", (req) => {
    if (
      new URL(req.url()).pathname === "/api/tailor" &&
      req.method() === "POST"
    ) {
      requestedTailorModel = req.postDataJSON().model;
      requestedTailorBody = req.postDataJSON();
    }
  });
  await page.getByLabel("Job post", { exact: true }).fill(post);
  await submitAndOpenReview(page);
  await expect(
    page.getByRole("heading", { name: /^Fixture Co/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /^Fixture Co/ }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Tailor",
      exact: true,
    })
    .first()
    .click();
  // A refresh reopens the review on its tab; the Review and Tailor models are under Models.
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  await modelSettings.click();
  await expect(
    reviewModels.getByRole("radio", { name: "Haiku 5.5", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    tailorModels.getByRole("radio", { name: "Sonnet 5.5", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  const selectedNote = page.getByText("Selected for this application.");
  await expect(selectedNote).toBeVisible({ timeout: 30_000 });
  expect(requestedTailorModel).toBe("claude-sonnet-5-5");
  expect(requestedTailorBody).not.toHaveProperty("mode");
  await expect(
    page.getByRole("heading", { name: "Tailor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Light Tailor|Full Tailor|Tailor anyway/),
  ).toHaveCount(0);
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    // The open desktop history column becomes a phone sheet when the viewport changes.
    const historySheet = page.getByRole("dialog", {
      name: "History",
      exact: true,
    });
    if (await historySheet.isVisible()) {
      await historySheet
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(historySheet).toBeHidden();
    }
    if (viewport.name === "mobile")
      await expect(
        page.getByText(/Tailored resume ready and selected/),
      ).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Tailor", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Targeted changes for this job, preserving your resume.s structure\./,
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const panel = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "Tailor", exact: true }),
    });
    await panel.screenshot({
      path: testInfo.outputPath(`tailor-${viewport.name}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sendWith = page.getByRole("radiogroup", {
    name: "Resume to send",
    exact: true,
  });
  const tailoredOption = sendWith.getByRole("radio", { name: "Tailored" });
  // A validated tailored resume is selected automatically and can be switched back.
  await expect(tailoredOption).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Full content diff")).toBeVisible();
  await expect(page.getByAltText("Tailored resume preview")).toBeVisible();
  await sendWith.getByRole("radio", { name: "tech master" }).click();
  await expect(
    sendWith.getByRole("radio", { name: "tech master" }),
  ).toHaveAttribute("aria-checked", "true");
  // Reopening a validated draft after clearing disposable runs keeps it selectable.
  fs.rmSync(path.join(process.env.PLAYWRIGHT_CAREER_ROOT!, "ui/.cache/runs"), {
    recursive: true,
  });
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Review", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(selectedNote).toBeVisible();
  await tailoredOption.click();
  await expect(tailoredOption).toHaveAttribute("aria-checked", "true");
  // Mark applied logs straight away (no confirm sheet), preserves the next draft, and offers Undo.
  await page
    .getByLabel("Job post", { exact: true })
    .fill("Next review after marking applied");
  await page.getByRole("button", { name: "Mark applied", exact: true }).click();
  await expect(page.getByText(/^Logged as applied\./)).toBeVisible();
  await expect(page.getByLabel("Job post", { exact: true })).toHaveValue(
    "Next review after marking applied",
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  // Afterwards the page is clear for the next job.
  await expect(page.getByRole("heading", { name: /^Fixture Co/ })).toHaveCount(
    0,
  );
  const payload = await (await request.get("/api/applications")).json();
  const row = payload.rows.find(
    (r: { company: string }) => r.company === "Fixture Co",
  );
  expect(row.resume).toContain("tailored/");
  expect(row.recordId).toMatch(/^[a-f0-9-]{36}$/);
  const review = await (await request.get(`/api/runs/${row.recordId}`)).json();
  expect(review.tailor.actualMatch).toBe(72);
  expect(review.tailor.result.matchAssessment.sourceHash).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(review.result.match.total).toBe(68);
  expect(review.postFormat).toBe("brief");
  expect(review.jobPost).toContain("# Fixture Co —");
  expect(review.jobPost).not.toContain(post);
  const cache = fs.readFileSync(
    path.join(
      process.env.PLAYWRIGHT_CAREER_ROOT!,
      "ui/.cache/runs",
      `${row.recordId}.json`,
    ),
    "utf8",
  );
  expect(JSON.parse(cache).request.originalJobPost).toBe(post);
  await page.goto("/tracker");
  await page.getByText("Fixture Co", { exact: true }).first().click();
  await expect(
    page
      .getByRole("dialog", { name: /Fixture Co/ })
      .getByRole("region", { name: "Job summary" }),
  ).toBeVisible();
  // A tailored row links straight to its PDF; no archived copy is kept.
  const link = page.getByRole("link", {
    name: "Resume PDF ↗",
    exact: true,
  });
  await expect(link).toBeVisible();
  const pdf = await request.get((await link.getAttribute("href"))!);
  expect(await pdf.body()).toEqual(
    fs.readFileSync(
      path.join(
        process.env.PLAYWRIGHT_CAREER_ROOT!,
        `resumes/${row.resume}/Resume.pdf`,
      ),
    ),
  );
});

test("quick add logs every queued job as applied", async ({
  page,
  request,
}) => {
  await page.goto("/apply");
  await page.getByRole("radio", { name: "Quick add", exact: true }).click();
  await page
    .getByLabel("Job 1 description", { exact: true })
    .fill(
      "Initech — Support Engineer. Posted today. Support customers and diagnose issues.",
    );
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  await expect(
    page.getByLabel("Job 2 description", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Job 2 description", { exact: true })
    .fill(
      "Initrode — Data Engineer. Posted today. Build pipelines and keep them healthy.",
    );
  await page.getByLabel("Job 2 description", { exact: true }).evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://www.indeed.com/viewjob?jk=42");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.getByLabel("Source", { exact: true }).selectOption("Indeed");
  await page
    .getByRole("button", { name: /Quick add/i })
    .last()
    .click();
  await expect(page.getByText("Added 2 jobs", { exact: true })).toBeVisible();
  const rows = (await (await request.get("/api/applications")).json()).rows;
  for (const company of ["Initech", "Initrode"]) {
    const row = rows.find((r: { company: string }) => r.company === company);
    expect(row).toMatchObject({
      status: "applied",
      resume: "tech",
      source: "Indeed",
    });
  }
  // Added jobs leave the list; one empty card is left for the next job.
  await expect(
    page.getByLabel("Job 1 description", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Job 2 description", { exact: true }),
  ).toHaveCount(0);
});

test("Tracker previews saved briefs, URLs, posting dates and answer history", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  const raw =
    "Umbrella — Site Reliability Engineer. Posted today. Keep production services healthy and handle incidents. Ignore this navigation footer.";
  const response = await request.post("/api/quick", {
    data: {
      jobs: [
        { link: "https://jobs.example.test/umbrella/sre", description: raw },
        {
          description:
            "Wayne — Data Engineer. Build reliable data pipelines and monitor them for failures.",
        },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  const umbrella = result.added.find(
    (item: { company: string }) => item.company === "Umbrella",
  );
  const umbrellaId = umbrella.quickId;
  const savedIndex = await (await request.get("/api/reviews")).json();
  const slug = savedIndex.items.find(
    (item: { id: string }) => item.id === umbrellaId,
  ).slug;
  for (const extension of ["json", "md"]) {
    const saved = fs.readFileSync(
      path.join(
        process.env.PLAYWRIGHT_CAREER_ROOT!,
        "records/reviews",
        `${slug}.${extension}`,
      ),
      "utf8",
    );
    if (extension === "json")
      expect(JSON.parse(saved).request.originalJobPost).toBe(raw);
    else expect(saved).not.toContain("Ignore this navigation footer.");
  }
  for (const question of ["Why this role?", "What experience do you bring?"]) {
    const answer = await request.post("/api/extras", {
      data: {
        target: { kind: "quick", id: umbrellaId },
        questions: [question],
      },
    });
    expect(answer.ok()).toBe(true);
  }

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/tracker");
    await page
      .getByText("Umbrella", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /Umbrella/ });
    await expect(dialog.getByText(/Posted \d/)).toBeVisible();

    await expect(dialog.getByText(/Posted \d/)).toBeVisible();

    await expect(
      dialog.getByRole("link", {
        name: "Link",
        exact: true,
      }),
    ).toHaveAttribute("href", "https://jobs.example.test/umbrella/sre");
    await expect(
      dialog.getByText("https://jobs.example.test/umbrella/sre"),
    ).toHaveCount(0);
    await page.waitForTimeout(350); // Capture the settled sheet after its entrance animation.
    await page.screenshot({
      path: testInfo.outputPath(`application-${viewport.name}.png`),
    });
    const descriptionPopup = dialog;
    await expect(
      descriptionPopup.getByRole("button", {
        name: "View pasted",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      descriptionPopup.getByText("Ignore this navigation footer.", {
        exact: true,
      }),
    ).toBeHidden();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Saved", exact: true }).click();
    await page.getByRole("menuitem", { name: /saved answers/ }).click();
    const answersPopup = dialog;
    await expect(answersPopup.getByText("Why this role?")).toBeVisible();
    await expect(
      answersPopup.getByText("What experience do you bring?"),
    ).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({
      path: testInfo.outputPath(`answers-${viewport.name}.png`),
    });
    await answersPopup.getByRole("button", { name: /Back to job/ }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await page
      .getByText("Wayne", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page
        .getByRole("dialog", { name: /Wayne/ })
        .getByRole("link", { name: "Link", exact: true }),
    ).toHaveCount(0);
  }
});

test("Tracker opens an older saved post through its unique URL", async ({
  page,
  request,
}) => {
  const legacyPost =
    "LegacyCo — Platform Engineer. Preserve this original posting for older records.";
  const added = await request.post("/api/quick", {
    data: {
      jobs: [
        {
          link: "https://jobs.example.test/legacy/platform",
          description: legacyPost,
        },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  const quickId = (await added.json()).added[0].quickId;
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const index = await (await request.get("/api/reviews")).json();
  const slug = index.items.find(
    (item: { id: string }) => item.id === quickId,
  ).slug;
  const recordPath = path.join(root, "records/reviews", `${slug}.json`);
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  delete record.postFormat;
  record.request.jobPost = legacyPost;
  fs.writeFileSync(recordPath, JSON.stringify(record));
  const applicationsPath = path.join(root, "records/applications.md");
  fs.writeFileSync(
    applicationsPath,
    fs.readFileSync(applicationsPath, "utf8").replace(`| ${quickId} |`, "|  |"),
  );

  await page.goto("/tracker");
  await page
    .getByText("LegacyCo", { exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: /LegacyCo/ });
  await dialog
    .getByRole("button", { name: "View pasted", exact: true })
    .click();
  await expect(dialog.getByText(legacyPost, { exact: true })).toBeVisible();
});

test("Add questions answers the chosen job after one Quick add of every card", async ({
  page,
  request,
}) => {
  await page.goto("/apply");
  await page
    .getByLabel("Job 1 description", { exact: true })
    .fill(
      "Vandelay — Import Engineer. Posted today. Build import and export tooling for customers.",
    );
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  await page
    .getByLabel("Job 2 description", { exact: true })
    .fill(
      "Globex — Product Engineer. Posted today. Build customer-facing features end to end.",
    );
  await page.getByRole("button", { name: "Add questions" }).click();
  // The picker defaults to the last card; pick Job 1, then Job 2.
  const forJob = page.getByLabel("For job");
  await forJob.selectOption({ index: 0 });
  await forJob.selectOption({ index: 1 });
  await page
    .getByLabel("Question 1", { exact: true })
    .fill("Why do you want to work here?");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByLabel("Question 2", { exact: true })).toBeFocused();
  await page
    .getByLabel("Question 2", { exact: true })
    .fill("Tell us about a project you built.");
  await page.getByRole("checkbox", { name: "Cover letter" }).check();
  // One button: both jobs are added, then the questions are answered for Job 2.
  await expect(page.getByRole("button", { name: /^Answer & add/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: /^Quick add \(2\)/ }).click();
  await expect(page.getByText("Added 2 jobs", { exact: true })).toBeVisible();
  const companies = (
    await (await request.get("/api/applications")).json()
  ).rows.map((r: { company: string }) => r.company);
  expect(companies).toEqual(expect.arrayContaining(["Globex", "Vandelay"]));
  const extras = page.getByRole("region", { name: "Extras" });
  await expect(extras.getByText(/^Dear Hiring Manager/)).toBeVisible();
  await expect(
    extras.getByText("Why do you want to work here?", { exact: true }),
  ).toBeVisible();
  await expect(
    extras.getByRole("button", { name: "Copy letter" }),
  ).toBeVisible();
  // Quick Add jobs remain available through Questions rather than review-only History.
  const saved = (await (await request.get("/api/reviews")).json()).items.find(
    (item: { kind: string; company: string }) =>
      item.kind === "quick" && item.company === "Globex",
  );
  await page.goto(`/apply?questions=${saved.id}`);
  await expect(
    page
      .getByRole("region", { name: "Extras" })
      .getByText(/^Dear Hiring Manager/),
  ).toBeVisible();
});

test("Quick add caps the batch at 50 cards and compresses pasted text", async ({
  page,
}) => {
  await page.goto("/apply");
  const description = page.getByLabel("Job 1 description", { exact: true });
  await description.focus();
  const paste = (text: string) =>
    page.evaluate((t) => {
      const data = new DataTransfer();
      data.setData("text/plain", t);
      document.activeElement!.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, text);
  await paste("Initech — Engineer\r\n\r\n   \nAbout us\n\n\nBuild   things");
  // Short fragment lines fold onto the line before.
  await expect(description).toHaveValue(
    "Initech — Engineer About us Build things",
  );
  // A lone URL pasted into the description fills the empty URL box instead.
  await paste("https://jobs.example.test/initech/1");
  await expect(
    page.getByRole("link", {
      name: "https://jobs.example.test/initech/1",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://jobs.example.test/initech/1");
  const addJob = page.getByRole("button", { name: "Add job", exact: true });
  for (let i = 2; i < 50; i++) await addJob.click();
  await expect(page.getByLabel(/^Job \d+ description$/)).toHaveCount(50);
  await expect(addJob).toBeDisabled();
  await expect(page.getByText("1/50 jobs in this batch")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(addJob).toBeDisabled();
  await expect(page.getByText("1/50 jobs in this batch")).toBeVisible();
});

test("Review takes a pasted URL as the link, and Skip discards the review", async ({
  page,
  request,
}) => {
  await page.goto("/apply");
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  const box = page.getByLabel("Job post", { exact: true });
  await box.focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "boards.greenhouse.io/skipco/jobs/77");
    document.activeElement!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(box).toHaveValue("");
  await expect(
    page.getByRole("link", { name: "boards.greenhouse.io" }),
  ).toHaveAttribute("href", "https://boards.greenhouse.io/skipco/jobs/77");
  await expect(page.getByRole("combobox", { name: "Resume" })).toHaveCount(0);
  await box.fill(post);
  await submitAndOpenReview(page);
  await expect(
    page.getByRole("heading", { name: /^Fixture Co/ }),
  ).toBeVisible();
  const before = (await (await request.get("/api/reviews")).json()).items;
  const runId = before.find(
    (i: { link: string }) =>
      i.link === "https://boards.greenhouse.io/skipco/jobs/77",
  )?.id;
  expect(runId).toBeTruthy();
  // Questions stay hidden until asked for.
  await expect(page.getByRole("region", { name: "Extras" })).toHaveCount(0);
  await page.getByRole("button", { name: "Questions & cover letter" }).click();
  await expect(page.getByRole("region", { name: "Extras" })).toBeVisible();
  // Follow-ups build a thread on the page only; nothing is written to the run.
  await page
    .getByRole("button", { name: "Ask about this review", exact: true })
    .click();
  const followUp = page.getByRole("region", { name: "Ask about this review" });
  const runBefore = await (await request.get(`/api/runs/${runId}`)).json();
  for (const q of ["Why a stretch?", "Should I tailor?"]) {
    await followUp.getByLabel("Follow-up question").fill(q);
    await followUp.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(followUp.getByText(`Fixture answer to: ${q}`)).toBeVisible();
  }
  await expect(followUp.getByLabel("Follow-up question")).toHaveValue("");
  expect(await (await request.get(`/api/runs/${runId}`)).json()).toEqual(
    runBefore,
  );
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByText("Skipped · review discarded")).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Review", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  const after = (await (await request.get("/api/reviews")).json()).items;
  expect(after.some((i: { id: string }) => i.id === runId)).toBe(false);
  expect((await request.get(`/api/runs/${runId}`)).status()).toBe(404);
});

test("Tracker opens the Questions tab with the job selected", async ({
  page,
  request,
}) => {
  const added = await request.post("/api/quick", {
    data: {
      jobs: [
        {
          link: "https://jobs.example.test/soylent/eng",
          description:
            "Soylent — Backend Engineer. Posted today. Build APIs that feed millions of customers.",
        },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  await page.goto("/tracker");
  await page
    .getByText("Soylent", { exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole("dialog", { name: /Soylent/ })
    .getByRole("link", { name: "Questions", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apply$/);
  await expect(
    page.getByRole("radio", { name: "Questions", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "Soylent" })).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "Note for the writer (optional)" })
    .click();
  await page
    .getByLabel("Note for the writer (optional)")
    .fill("Keep it casual");
  await page.getByLabel("Question 1", { exact: true }).fill("Why this team?");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  const extras = page.getByRole("region", { name: "Extras" });
  await expect(extras.getByText("Why this team?")).toBeVisible();
  await expect(extras.getByText("Keep it casual")).toBeVisible();
  await expect(page.getByLabel("Note for the writer (optional)")).toHaveValue(
    "",
  );
  // Change opens the picker; rows without a saved description can't be picked.
  await page.getByRole("button", { name: "Change", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Select a previous job" });
  await expect(
    picker.getByRole("button", { name: /Acme.*No saved description/ }),
  ).toBeDisabled();
  await picker.getByPlaceholder("Search company or role").fill("soylent");
  await expect(picker.getByRole("button", { name: /Soylent/ })).toBeEnabled();
});

test("YC intro message fills the first empty question box once", async ({
  page,
}) => {
  await page.goto("/apply");
  await page.getByRole("button", { name: "Add questions" }).click();
  const yc = page.getByRole("button", { name: "YC intro message" });
  await yc.click();
  await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue(
    /^YC intro message: Start a conversation with the team/,
  );
  await expect(page.getByLabel("Question 2", { exact: true })).toHaveCount(0);
  await expect(yc).toBeDisabled();
});

test("Undo reverses the last log and puts the job back in the list", async ({
  page,
  request,
}) => {
  const post =
    "Hooli — Platform Engineer. Posted today. Build and run internal developer platforms.";
  await page.goto("/apply");
  await page.getByRole("radio", { name: "Quick add", exact: true }).click();
  await page.getByLabel("Job 1 description", { exact: true }).fill(post);
  await page
    .getByRole("button", { name: /Quick add/i })
    .last()
    .click();
  const hooli = async () =>
    (await (await request.get("/api/applications")).json()).rows.some(
      (r: { company: string }) => r.company === "Hooli",
    );
  await expect.poll(hooli).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Undone.")).toBeVisible();
  await expect.poll(hooli).toBe(false);
  await expect(
    page.getByLabel("Job 1 description", { exact: true }),
  ).toHaveValue(post);
});

test("late history responses cannot replace the currently opened review", async ({
  page,
}) => {
  // Reuse fixture-generated review content; all identifiers and network responses are local fixtures.
  const { result } = fixtureScore("2026-10-08");
  const item = {
    kind: "review",
    id: result.runId,
    company: result.company,
    role: result.role,
    status: "not decided",
    reviewedAt: result.reviewedAt,
    savedAt: "2026-10-08T10:00:00Z",
    decision: "undecided",
    fit: 85,
    match: 61,
    slug: "fixture",
    jsonPath: "",
    mdPath: "",
    link: "",
    jobId: "",
  };
  const original = {
    kind: "review",
    result,
    jobPost: post,
    decision: "undecided",
    tailor: null,
  };
  const make = (id: string, company: string) => ({ ...item, id, company });
  await page.route("**/api/reviews", (route) =>
    route.fulfill({
      json: {
        items: [
          make("slow-fixture", "Slow Review"),
          make("current-fixture", "Current Review"),
        ],
      },
    }),
  );
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/runs/slow-fixture", async (route) => {
    started();
    await gate;
    await route.fulfill({
      json: {
        ...original,
        result: {
          ...original.result,
          runId: "slow-fixture",
          company: "Slow Review",
        },
      },
    });
  });
  await page.route("**/api/runs/current-fixture", (route) =>
    route.fulfill({
      json: {
        ...original,
        tailor: null,
        result: {
          ...original.result,
          runId: "current-fixture",
          company: "Current Review",
        },
      },
    }),
  );
  await page.goto("/apply");
  await page
    .getByRole("group", { name: "History filter" })
    .getByRole("button", { name: /^To apply/ })
    .click();
  await page.getByRole("button", { name: /Slow Review/ }).click();
  await pending;
  await page.getByRole("button", { name: /Current Review/ }).click();
  await expect(
    page.getByRole("heading", { name: /^Current Review/ }),
  ).toBeVisible();
  const slowResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/runs/slow-fixture"),
  );
  release();
  await (await slowResponse).body();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem("career-ui.apply.open")),
    )
    .toBe('"current-fixture"');
  await expect(
    page.getByRole("heading", { name: /^Current Review/ }),
  ).toBeVisible();
});

test("the provider toggle swaps every model to its ChatGPT counterpart and is remembered", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const prefs = await (await page.request.get("/api/preferences")).json();
    prefs.provider = "claude";
    prefs.selections.claude = {
      review: "claude-sonnet-5-5",
      tailor: "claude-sonnet-5-5",
      extras: "claude-sonnet-5-5",
    };
    prefs.selections.openai = {
      review: "gpt-6.1-terra",
      tailor: "gpt-6.1-terra",
      extras: "gpt-6.1-terra",
    };
    await page.request.put("/api/preferences", { data: prefs });
    await page.goto("/apply");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const modelSettings = page.getByRole("button", {
      name: "Model settings",
      exact: true,
    });
    const provider = page.getByRole("radiogroup", { name: "Provider" });
    await modelSettings.click();
    await expect(page.locator('[aria-label="Quick add model"]')).toHaveText(
      "Haiku 5.5",
    );
    await provider.getByRole("radio", { name: "OpenAI", exact: true }).click();
    await expect(page.locator('[aria-label="Quick add model"]')).toHaveText(
      "GPT-6 Luna",
    );
    await expect(
      page.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeVisible();
    const extras = page.getByRole("radiogroup", {
      name: "Questions & cover letter model",
    });
    await expect(extras.getByRole("radio")).toHaveText([
      "GPT-6.1 Sol",
      "GPT-6.1 Terra",
      "GPT-6 Luna",
    ]);
    await expect(
      extras.getByRole("radio", { name: "GPT-6.1 Terra" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");

    // Quick add sends the provider; the request is answered here so nothing is logged.
    let quickBody: Record<string, unknown> | undefined;
    await page.route("**/api/quick", async (route) => {
      quickBody = route.request().postDataJSON();
      await route.fulfill({
        status: 503,
        json: { error: { code: "CLAUDE_UNAVAILABLE", message: "stubbed" } },
      });
    });
    await page
      .getByLabel("Job 1 description", { exact: true })
      .fill(
        "Initech — Platform Engineer. Posted today. Build internal developer tooling and services.",
      );
    await page
      .getByRole("button", { name: /^Quick add/ })
      .last()
      .click();
    await expect.poll(() => quickBody?.provider).toBe("openai");
    await page.unroute("**/api/quick");

    // The model picker is available in Quick Add after reload, even if Review is hidden.
    await page.reload();
    await modelSettings.click();
    await expect(
      provider.getByRole("radio", { name: "OpenAI", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page
        .getByRole("radiogroup", { name: "Tailor model" })
        .getByRole("radio", { name: "GPT-6.1 Terra" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.screenshot({
      path: test.info().outputPath(`provider-${viewport.width}.png`),
    });
    await provider.getByRole("radio", { name: "Claude", exact: true }).click();
    await expect(
      page
        .getByRole("radiogroup", { name: "Review model" })
        .getByRole("radio", { name: "Sonnet 5.5" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  }
});
