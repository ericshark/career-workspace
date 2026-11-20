import { test, expect } from "@playwright/test";
test("settings, paste focus, blank-card submission and compact responsive history", async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/apply");
  await expect(
    page.getByRole("radio", { name: "Questions", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Job 1 description", exact: true })
    .focus();
  await page
    .getByRole("textbox", { name: "Job 1 description", exact: true })
    .evaluate((el) => {
      const data = new DataTransfer();
      data.setData(
        "text/plain",
        "Settings Example — Engineer. Build useful Python services and React interfaces. Required: Python and PostgreSQL. Maintain backend APIs, test customer workflows, improve observability and collaborate with product designers. Location: Brooklyn, NY. Pay: $100,000–$120,000 per year.",
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await expect(
    page.getByRole("textbox", { name: "Job 2 description", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Job 1 description", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Job 2 description", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page.getByLabel("Hide questions", { exact: true }).uncheck();
  // Hide review persists across reloads and removes the Review button.
  await page.getByLabel("Hide review", { exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("radio", { name: "Review", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Review", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page.getByLabel("Hide review", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("radio", { name: "Review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Questions", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Questions", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page.getByLabel("Hide questions", { exact: true }).check();
  await page.getByLabel("Night mode").check();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Night mode")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("desktop-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("textbox", { name: "Job 1 description", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-dark.png"),
    fullPage: true,
  });
  const savedResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/quick") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^Quick add/ }).click();
  const response = await savedResponse;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().jobs).toHaveLength(1);
  const saved = await response.json();
  const id = saved.added[0].quickId;
  await page.goto(`/tracker?application=${id}`);
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("region", { name: "Job summary" }),
  ).toBeVisible();
  await expect(
    modal.getByRole("link", { name: "Questions", exact: true }),
  ).toHaveCount(0);
  await expect(modal.getByLabel("Resume: tech", { exact: true })).toHaveCount(
    0,
  );
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByLabel("Night mode").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.screenshot({
    path: info.outputPath("mobile-light.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("linked history summaries, progress reviews, legend and saved cover letters", async ({
  page,
  request,
}, info) => {
  const description =
    "History Example — Engineer. Build Python APIs and PostgreSQL services. Required Python; preferred React. Location: Brooklyn, New York. Pay $100,000–$120,000 annually. ".repeat(
      3,
    );
  const added = await request.post("/api/quick", {
    data: {
      jobs: [{ description, link: "https://example.test/settings-history" }],
    },
  });
  expect(added.ok()).toBe(true);
  const id = (await added.json()).added[0].quickId;
  const started = await request.post("/api/score", {
    data: { sourceRecordId: id },
  });
  expect(started.ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tracker/details?id=${id}`)).json())
          .review?.runId,
    )
    .toBeTruthy();
  const details = await (
    await request.get(`/api/tracker/details?id=${id}`)
  ).json();
  expect(
    (
      await request.post("/api/extras", {
        data: {
          target: { kind: "quick", id },
          questions: ["Why this role?"],
          coverLetter: true,
        },
      })
    ).ok(),
  ).toBe(true);
  const apps = await (await request.get("/api/applications")).json();
  const row = apps.rows.find((r: any) => r.recordId === id);
  expect(
    (
      await request.patch("/api/applications", {
        data: {
          fileHash: apps.fileHash,
          key: row.key,
          lineIndex: row.lineIndex,
          status: "in progress",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/apply");
  const history = page.locator("aside").filter({
    has: page.getByRole("heading", { name: "History", exact: true }),
  });
  await history.getByRole("button", { name: /Summaries/ }).click();
  await history.getByRole("list").getByRole("button").first().click();
  await expect(
    page.getByRole("dialog").getByRole("region", { name: "Job summary" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await history
    .getByRole("group", { name: "History filter" })
    .getByRole("button", { name: /In progress/ })
    .click();
  await expect(history.getByRole("list").getByRole("button")).toHaveCount(1);
  await history.getByRole("list").getByRole("button").click();
  const guide = page.getByRole("button", { name: "Score guide", exact: true });
  if (await guide.count()) await guide.click();
  await expect(page.getByLabel("Review ranking legend")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Questions & cover letter", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("tech resume", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Completed review", { exact: true })).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({
    path: info.outputPath("review-legend.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    localStorage.setItem("career-ui.hideQuestions", "false"),
  );
  await page.goto(`/tracker?application=${id}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "View saved answers" }),
  ).toHaveCount(1);
  await page.getByRole("menuitem", { name: "View cover letter" }).click();
  await expect(
    page.getByRole("heading", { name: "Saved cover letter" }),
  ).toBeVisible();
});

test("Quick Add API enforces trimmed 25-character minimum and batch capacity", async ({
  request,
}) => {
  for (const description of ["", " ".repeat(30), "x".repeat(24)]) {
    expect(
      (
        await request.post("/api/quick", { data: { jobs: [{ description }] } })
      ).status(),
    ).toBe(400);
  }
  expect(
    (
      await request.post("/api/quick", {
        data: { jobs: [{ description: "x".repeat(25) }] },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/quick", {
        data: {
          jobs: [{ description: "", link: "https://example.test/url-only" }],
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/quick", {
        data: {
          jobs: Array.from({ length: 51 }, () => ({
            description: "x".repeat(25),
          })),
        },
      })
    ).status(),
  ).toBe(400);
});
