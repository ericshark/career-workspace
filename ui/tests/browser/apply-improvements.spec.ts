import { test, expect } from "@playwright/test";
for (const width of [1440, 390])
  test(`review composer retains a new draft and exposes durable preferences at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/apply");
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    const composer = page.getByLabel("Job post", { exact: true });
    const post =
      `Acceptance ${width} ${crypto.randomUUID()} Python backend role. Build PostgreSQL APIs and test software. `.repeat(
        5,
      );
    await composer.fill(post);
    const accepted = page.waitForResponse(
      (r) => r.url().endsWith("/api/score") && r.status() === 202,
    );
    await page.getByRole("button", { name: /Review job/ }).click();
    const runId = (await (await accepted).json()).runId;
    await expect(composer).toHaveValue("");
    await composer.fill(
      "My next draft stays here while the first job finishes",
    );
    await expect(
      page.getByRole("heading", { name: /^Fixture Co/ }),
    ).toBeVisible();
    await expect(composer).toHaveValue(
      "My next draft stays here while the first job finishes",
    );
    await page
      .getByRole("button", { name: "Model settings", exact: true })
      .click();
    await expect(
      page.getByRole("radio", { name: "GPT-6.1 Terra", exact: true }).first(),
    ).toBeVisible();
    await page.getByLabel("Review effort", { exact: true }).selectOption("low");
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/preferences")).json())
            .operationEfforts["review:gpt-6.1-terra"],
      )
      .toBe("low");
    await page.reload();
    await page
      .getByRole("button", { name: "Model settings", exact: true })
      .click();
    await expect(page.getByLabel("Review effort", { exact: true })).toHaveValue(
      "low",
    );
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.waitForTimeout(350);
    await page.screenshot({
      path: info.outputPath(`apply-${width}.png`),
      fullPage: true,
    });
    if (width === 1440) {
      // Refresh verifies preferences; restore the next draft before testing the decision action.
      await composer.fill(
        "My next draft stays here while the first job finishes",
      );
      const before = await (await request.get("/api/progress")).json();
      await page.getByRole("button", { name: "To apply", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await (await request.get(`/api/runs/${runId}`)).json()).decision,
        )
        .toBe("later");
      await expect(composer).toHaveValue(
        "My next draft stays here while the first job finishes",
      );
      const after = await (await request.get("/api/progress")).json();
      expect(after.today.tech + after.today.bridge).toBe(
        before.today.tech + before.today.bridge,
      );
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await (await request.get(`/api/runs/${runId}`)).json()).decision,
        )
        .toBe("undecided");
    }
  });
test("accepts three reviews, limits concurrency, and saves both job text representations", async ({
  request,
}) => {
  const ids: string[] = [];
  for (let n = 0; n < 3; n++) {
    const jobPost =
      `${crypto.randomUUID()} queue job ${n} Build Python APIs with PostgreSQL. `.repeat(
        5,
      );
    const r = await request.post("/api/score", {
      data: { jobPost, resume: "tech" },
    });
    expect(r.status()).toBe(202);
    ids.push((await r.json()).runId);
  }
  const state = await (await request.get("/api/score/status")).json();
  expect(state.runningCount).toBeLessThanOrEqual(2);
  await expect
    .poll(async () => {
      const s = await (await request.get("/api/score/status")).json();
      return s.jobs.filter(
        (j: { runId: string; status: string }) =>
          ids.includes(j.runId) && j.status === "done",
      ).length;
    })
    .toBe(3);
  for (const id of ids) {
    const saved = await (await request.get(`/api/runs/${id}`)).json();
    expect(saved.postFormat).toBe("brief");
    expect(saved.result.meta.originalAvailable).toBe(true);
  }
});

test("background quick add resets composer immediately, shares source, warns on duplicate URLs, and shows top bar + bell popover", async ({
  page,
  request,
}) => {
  await page.goto("/apply");

  // 1. Source dropdown has no Auto option and shares state with Review.
  const sourceSelect = page.getByLabel("Source", { exact: true });
  await expect(sourceSelect.locator("option")).not.toContainText([
    "Auto (from each link)",
  ]);
  await sourceSelect.selectOption("Jobright");
  await page.getByRole("radio", { name: "Review", exact: true }).click();
  await expect(page.getByLabel("Source", { exact: true })).toHaveValue(
    "Jobright",
  );
  await page.getByRole("radio", { name: "Quick add", exact: true }).click();
  await expect(page.getByLabel("Source", { exact: true })).toHaveValue(
    "Jobright",
  );

  // 2. Quick Add model effort selector in Model settings popover.
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  const quickEffort = page.getByLabel("Quick add effort", {
    exact: true,
  });
  await expect(quickEffort).toHaveValue("low");
  await quickEffort.selectOption("high");
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/preferences")).json()).operationEfforts[
          "quick:gpt-6-luna"
        ],
    )
    .toBe("high");
  await page.keyboard.press("Escape");

  // 3. Pre-submit duplicate URL warning across cards in the batch.
  const firstDesc = page.getByLabel("Job 1 description", { exact: true });
  await firstDesc.focus();
  await firstDesc.evaluate((el) => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      "https://boards.greenhouse.io/nebula/jobs/555\nNebula — Distributed Systems Engineer. Posted today. Build fault-tolerant storage engines in Rust and Go.",
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const secondDesc = page.getByLabel("Job 2 description", { exact: true });
  await secondDesc.focus();
  await secondDesc.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://boards.greenhouse.io/nebula/jobs/555");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.getByText("Duplicate URL in this batch (Job 1)"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove Job 2", exact: true }).click();

  // 4. Pressing Quick add immediately clears the composer so the user can type the next job.
  await page.getByRole("button", { name: /^Quick add/ }).click();
  await expect(firstDesc).toHaveValue("");
  await firstDesc.fill(
    "Draft typed immediately while background batch completes.",
  );

  // 5. Top bar shows "Added 1 job", expands on click, and Summary opens QuickSummaryModal with dates & View pasted.
  const addedBar = page.getByRole("button", { name: /Added 1 job/ });
  await expect(addedBar).toBeVisible();
  await expect(firstDesc).toHaveValue(
    "Draft typed immediately while background batch completes.",
  );
  await addedBar.click();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Nebula/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/^Applied:/)).toBeVisible();
  await expect(dialog.getByLabel(/^Posted:/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "View pasted", exact: true })
    .click();
  await expect(
    dialog.getByText(/Build fault-tolerant storage engines in Rust and Go/),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  // 6. Bell icon shows notification badge and opens recent batches popover.
  const bell = page.getByRole("button", { name: /^Quick Add activity/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(
    page.getByRole("heading", { name: "Quick Add activity" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
