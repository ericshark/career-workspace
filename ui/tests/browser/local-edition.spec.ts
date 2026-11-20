import path from "node:path";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("local library creates, imports, edits, finds, and removes documents", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/docs");
  await page.getByRole("button", { name: "New doc" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Interview preparation");
  await page
    .getByLabel("Markdown", { exact: true })
    .fill(
      "## Before the call\n\n- Review the job posting.\n- Prepare an example of a tradeoff.\n- Write down two questions for the team.",
    );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Before the call" }),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "Questions.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("What does the first month look like?"),
  });
  await expect(
    page.getByText("What does the first month look like?"),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "Role notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("## Orchard Systems\n\nTalk about API reliability."),
  });
  await expect(
    page.getByRole("heading", { name: "Orchard Systems" }),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "Resume example.pdf",
    mimeType: "application/pdf",
    buffer: await readFile(
      path.join(process.env.PLAYWRIGHT_CAREER_ROOT!, "resumes/tech/Resume.pdf"),
    ),
  });
  await expect(page.getByRole("link", { name: "Open PDF" })).toBeVisible();
  const pdf = await page.request.get(
    (await page.getByRole("link", { name: "Open PDF" }).getAttribute("href"))!,
  );
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.reload();
  await page.getByRole("button", { name: "Interview preparation" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Interview checklist");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Interview checklist" }),
  ).toBeVisible();
  const screenshots = process.env.CAREER_SCREENSHOTS;
  if (screenshots) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: path.join(screenshots, "docs.png"),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Search documents").fill("interview");
  await expect(page.getByRole("button", { name: "Questions" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Before the call" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Interview checklist" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);

  if (screenshots) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Docs" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(screenshots, "dashboard.png"),
      animations: "disabled",
    });
    await page.goto("/apply");
    await expect(page.getByRole("heading", { name: "Apply" })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshots, "apply.png"),
      animations: "disabled",
    });
  }
});

test("ChatGPT sign-in prepares a local callback and rejects an unrelated state", async ({
  request,
  baseURL,
}) => {
  const started = await request.post("/api/ai-connection", {
    data: { action: "connect" },
  });
  expect(started.ok()).toBeTruthy();
  const url = new URL((await started.json()).url);
  expect(url.origin).toBe("https://auth.openai.com");
  expect(url.searchParams.get("redirect_uri")).toBe(baseURL + "/auth/callback");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const invalid = await request.get(
    "/auth/callback?state=mismatch&error=access_denied",
    { maxRedirects: 0 },
  );
  expect(invalid.status()).toBe(303);
  expect(invalid.headers().location).toBe("/apply?chatgpt=failed");
  const status = await request.get("/api/ai-connection");
  expect((await status.json()).connected).toBe(false);
});
