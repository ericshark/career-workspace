import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("career-ui.hideQuestions", "false"),
  );
});
test("always-visible summary, saved outputs, confirmation, shared review and keyboard navigation", async ({
  page,
  request,
}, info) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "career-ui.tracker",
      JSON.stringify({
        columns: ["company", "role", "status", "fit", "match", "link"],
        sortKey: "company",
        sortDir: "asc",
      }),
    ),
  );
  const raw =
    "Tracker Test Co — Software Engineer. Posted 2 days ago. Build Python services and PostgreSQL applications. Required: Python. Preferred: React. Location: New York. ".repeat(
      3,
    );
  const added = await request.post("/api/quick", {
    data: {
      source: "Simplify",
      jobs: [
        { description: raw, link: "https://example.test/tracker-summary" },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  const id = (await added.json()).added[0].quickId;
  await request.post("/api/extras", {
    data: { target: { kind: "quick", id }, questions: ["Why this role?"] },
  });
  const details = await request.get(`/api/tracker/details?id=${id}`);
  expect(details.ok()).toBe(true);
  const job = await details.json();
  await page.route(`**/api/tracker/details?id=${id}`, (route) =>
    route.fulfill({
      json: {
        ...job,
        displayBrief: {
          ...job.displayBrief,
          compensation: "Salary range: $100,000–$120,000",
        },
      },
    }),
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/tracker");
    await expect(
      page.getByLabel("No review yet").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", { name: /^Job posting/ })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await page
      .getByText(job.company, { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByLabel("Job facts").locator("[title]")).toHaveCount(
      5,
    );
    expect(
      await modal
        .getByLabel("Job facts")
        .locator("[title]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("title")),
        ),
    ).toEqual(["Source", "Location", "Salary", "Applied", "Posted"]);
    await expect(
      modal
        .locator("summary")
        .filter({ hasText: "Responsibilities and details" }),
    ).toHaveCount(0);

    await expect(
      modal.getByText("$100,000–$120,000", { exact: true }),
    ).toBeVisible();
    await expect(modal.getByText("Simplify", { exact: true })).toHaveCSS(
      "color",
      "rgb(6, 160, 138)",
    );
    await expect(
      modal.getByLabel(/^Applied: \d{2}\/\d{2}\/\d{2}$/),
    ).toBeVisible();
    if (viewport.width === 1440) {
      const positions = await modal
        .getByRole("navigation", { name: "Job actions" })
        .locator("button, a")
        .evaluateAll((elements) =>
          elements.map((element) =>
            Math.round(element.getBoundingClientRect().top),
          ),
        );
      expect(new Set(positions).size).toBe(1);
    }

    await expect(
      modal.getByRole("region", { name: "Job summary" }),
    ).toBeVisible();
    await expect(
      modal.getByRole("heading", { name: "Role overview" }),
    ).toBeVisible();
    await expect(
      modal.getByRole("heading", { name: "Key requirements" }),
    ).toBeVisible();
    await expect(
      modal.getByRole("heading", { name: "Responsibilities and details" }),
    ).toBeVisible();
    await expect(modal.getByRole("button", { name: /summary/i })).toHaveCount(
      0,
    );
    await expect(
      modal.getByRole("button", { name: "View pasted", exact: true }),
    ).toBeVisible();
    await expect(modal.getByText(raw, { exact: true })).toBeHidden();
    await modal
      .getByRole("button", { name: "View pasted", exact: true })
      .click();
    await expect(modal.getByText(raw, { exact: true })).toBeVisible();
    await modal
      .getByRole("button", { name: "View pasted", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Remove entry", exact: true })
      .click();
    await expect(
      modal.getByRole("button", { name: "Remove", exact: true }),
    ).toBeVisible();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await modal.getByRole("button", { name: "Saved", exact: true }).click();
    await page.getByRole("menuitem", { name: /saved answers/i }).click();
    await expect(
      modal.getByRole("heading", { name: /saved answers/i }),
    ).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(
      modal.getByRole("button", { name: "View pasted", exact: true }),
    ).toBeVisible();
    await modal.getByRole("button", { name: /Create review/ }).click();
    await expect(
      modal.getByRole("region", { name: "Confirm review" }),
    ).toBeVisible();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`tracker-${viewport.width}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Backspace");
    await expect(modal).toBeHidden();
  }
  await page.unroute(`**/api/tracker/details?id=${id}`);
  const before = await (await request.get("/api/applications")).json();
  const started = await request.post("/api/score", {
    data: { sourceRecordId: id },
  });
  expect(started.status()).toBe(202);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/score/status")).json()).jobs.find(
          (j: any) => j.sourceRecordId === id,
        )?.status,
    )
    .toBe("done");
  const updated = await (
    await request.get(`/api/tracker/details?id=${id}`)
  ).json();
  expect(updated.review).toBeTruthy();
  expect((await (await request.get("/api/applications")).json()).fileHash).toBe(
    before.fileHash,
  );
  expect(
    (
      await request.post("/api/score", { data: { sourceRecordId: id } })
    ).status(),
  ).toBe(200);
  expect(updated.extras.questions).toHaveLength(1);
  await request.post("/api/extras", {
    data: {
      target: { kind: "review", id: updated.review.runId },
      questions: ["Linked review question?"],
      coverLetter: true,
    },
  });
  await page.goto("/tracker");
  await expect(
    page.getByLabel("View review").filter({ visible: true }).first(),
  ).toBeVisible();
  await page
    .getByText(job.company, { exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByRole("menuitem", { name: "View saved answers" }).click();
  await expect(
    page.getByText("Linked review question?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to job" }).click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByRole("menuitem", { name: "View cover letter" }).click();
  await expect(
    page.getByRole("heading", { name: "Saved cover letter" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to job" }).click();
  await page.getByRole("button", { name: "View review", exact: true }).click();
  await expect(
    page.getByLabel("Completed review", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/runs/${updated.review.runId}`)).json())
          .viewedAt,
    )
    .toBeTruthy();
  expect(browserErrors).toEqual([]);
  const history = await (await request.get("/api/reviews")).json();
  expect(
    history.items.some(
      (j: any) => j.id === updated.review.runId && j.status === "applied",
    ),
  ).toBe(true);
});

test("Questions selected job can be cleared with X and New", async ({
  page,
  request,
}) => {
  const added = await request.post("/api/quick", {
    data: {
      jobs: [
        {
          description:
            "Reset Questions Co — Software Engineer. Build useful Python services and React interfaces for customers.",
          link: "https://example.test/questions-reset",
        },
      ],
    },
  });
  const id = (await added.json()).added[0].quickId;
  await page.goto(`/apply?questions=${id}`);
  await expect(
    page.getByRole("button", { name: "Clear selected job" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear selected job" }).click();
  await expect(
    page.getByRole("button", { name: "Select previous job" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select previous job" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Reset Questions Co/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear selected job" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Quick add", exact: true }),
  ).toBeChecked();
  await page.getByRole("radio", { name: "Questions", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Select previous job" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear selected job" }),
  ).toHaveCount(0);
});

test("compact status/date controls and removal preserve the saved Quick Add record", async ({
  page,
  request,
}) => {
  const added = await request.post("/api/quick", {
    data: {
      jobs: [
        {
          description:
            "Compact Status Co — Software Engineer. Build Python services and test the application.",
          link: "https://example.test/compact-status",
        },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  const id = (await added.json()).added[0].quickId;
  const payload = await (await request.get("/api/applications")).json();
  const row = payload.rows.find((r: { recordId: string }) => r.recordId === id);
  expect(
    (
      await request.patch("/api/applications", {
        data: {
          fileHash: payload.fileHash,
          key: row.key,
          lineIndex: row.lineIndex,
          status: "to apply",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/tracker?application=${id}`);
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Change status" }).click();
  await page.getByLabel("Submit date").fill("2026-10-29");
  await page
    .getByRole("menuitemradio", { name: "Applied", exact: true })
    .click();
  const current = async () =>
    (await (await request.get("/api/applications")).json()).rows.find(
      (r: { recordId: string }) => r.recordId === id,
    );
  await expect.poll(async () => (await current())?.date).toBe("2026-10-29");
  await expect.poll(async () => (await current())?.status).toBe("applied");
  // Reopen by stable ID if moving between Tracker tabs closed the sheet.
  await page.goto(`/tracker?application=${id}`);
  await modal.getByRole("button", { name: "Change status" }).click();
  await page
    .getByRole("menuitemradio", { name: "In progress", exact: true })
    .click();
  await expect.poll(async () => (await current())?.status).toBe("in progress");
  await page.goto(`/tracker?application=${id}`);
  await modal
    .getByRole("button", { name: "Remove entry", exact: true })
    .click();
  await modal.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(modal).toBeHidden();
  await expect.poll(current).toBeUndefined();
  expect((await request.get(`/api/runs/${id}`)).ok()).toBe(true);
});

test("sparse saved jobs have an accessible title without inventing metadata or unavailable links", async ({
  page,
  request,
}) => {
  const added = await request.post("/api/quick", {
    data: {
      jobs: [
        {
          description:
            "Unknown — Unknown. Build Python APIs and maintain PostgreSQL services. Experience preferred.",
        },
      ],
    },
  });
  expect(added.ok()).toBe(true);
  const id = (await added.json()).added[0].quickId;
  const apps = await (await request.get("/api/applications")).json();
  await page.route("**/api/applications", (route) =>
    route.fulfill({
      json: {
        ...apps,
        rows: apps.rows.map((r: { recordId: string }) =>
          r.recordId === id ? { ...r, company: "Unknown", role: "Unknown" } : r,
        ),
      },
    }),
  );
  const job = await (await request.get(`/api/tracker/details?id=${id}`)).json();
  await page.route(`**/api/tracker/details?id=${id}`, (route) =>
    route.fulfill({
      json: {
        ...job,
        company: "Unknown",
        role: "Unknown",
        postedAt: null,
        link: "",
        displayBrief: {
          overview: "",
          location: "",
          workMode: "",
          compensation: "",
          experience: "",
          qualifications: [],
          responsibilities: [],
        },
      },
    }),
  );
  await page.goto(`/tracker?application=${id}`);
  const modal = page.getByRole("dialog");
  await expect(
    page.getByRole("dialog", { name: "Saved job", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("heading", { name: "Saved job", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByLabel("Location: Unknown", { exact: true }),
  ).toHaveCount(0);
  await expect(
    modal.getByLabel("Salary: Unknown", { exact: true }),
  ).toHaveCount(0);
  await expect(
    modal.getByRole("link", { name: "Link", exact: true }),
  ).toHaveCount(0);
  await expect(
    modal.getByLabel("Job facts").locator('[title="Posted"]'),
  ).toHaveCount(0);
  await expect(
    modal.getByRole("heading", { name: "Responsibilities and details" }),
  ).toHaveCount(0);
  await expect(modal.getByRole("alert")).toHaveCount(0);
});
