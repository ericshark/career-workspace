import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function journalCommands() {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  const ui = path.resolve(import.meta.dirname, "../..");
  const inputFile = path.join(root, "journal-test-input.json");
  const mail = (operation: string, input: object) => {
    fs.writeFileSync(inputFile, JSON.stringify(input));
    return JSON.parse(
      execFileSync(
        path.join(ui, "node_modules/.bin/tsx"),
        [
          path.join(ui, "scripts/apps.ts"),
          "mail",
          operation,
          "--input",
          inputFile,
        ],
        { env: { ...process.env, CAREER_ROOT: root }, encoding: "utf8" },
      ),
    );
  };
  return mail;
}

test("Updates shows compact feedback for running and incomplete checks", async ({
  page,
  request,
}, info) => {
  const mail = journalCommands();
  const attempt = mail("begin", { mode: "daily" });
  mail("sync", {
    mode: "inbox",
    complete: true,
    startedAt: attempt.startedAt,
    leaseId: attempt.leaseId,
    discoveries: [
      {
        messageId: "journal-message",
        threadId: "journal-thread",
        url: "https://mail.google.com/mail/u/0/#all/journal-thread",
        receivedAt: attempt.startedAt,
        kind: "first-request",
        summary: "Reply with availability",
      },
    ],
  });
  mail("fail", { leaseId: attempt.leaseId, failure: "actions-processing" });
  const response = await (await request.get("/api/mail")).json();
  expect(response.checkAttempts[0]).not.toHaveProperty("leaseId");
  expect(response.checkAttempts[0]).not.toHaveProperty("acknowledge");
  const resumed = mail("begin", { mode: "daily" });
  expect(resumed.step).toBe("actions");

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto("/");
      const panel = page.getByRole("region", { name: "Updates & actions" });
      await expect(panel.getByText("Check running.")).toBeVisible();
      await expect(
        panel.getByText(/Inbox completed|discovery awaiting Actions/),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`journal-${width}.png`),
        fullPage: true,
      });
    }
  } finally {
    mail("fail", { leaseId: resumed.leaseId, failure: "actions-processing" });
  }
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Updates & actions" })
      .getByText("Latest check incomplete."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Updates uses the latest successful Career Check or Quick, excluding standalone Inbox", async ({
  page,
  request,
}) => {
  const mail = journalCommands();
  const prior = "2026-01-01T12:00:00.000Z";
  await page.route("**/api/mail", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        lastCareerCheck: {
          completedAt: prior,
          summary: { newActions: 1, newUpdates: 0, newRejections: 0 },
        },
      },
    });
  });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Updates & actions" });
  const timestamp = panel.getByText("Last check").locator("time");
  await expect(timestamp).toHaveAttribute("datetime", prior);
  const attempt = mail("begin", { mode: "inbox" });
  mail("sync", {
    mode: "inbox",
    complete: true,
    startedAt: attempt.startedAt,
    leaseId: attempt.leaseId,
  });
  const state = await (await request.get("/api/mail")).json();
  expect(state.checkAttempts.at(-1).status).toBe("succeeded");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(timestamp).toHaveAttribute("datetime", prior);
  await expect(panel.getByLabel("Latest successful run results")).toContainText(
    "1 new actions",
  );
  const quick = mail("begin", { mode: "quick" });
  const actions = await (await request.get("/api/actions")).json();
  mail("publish", { leaseId: quick.leaseId, fileHash: actions.fileHash });
  const quickState = await (await request.get("/api/actions")).json();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(timestamp).toHaveAttribute(
    "datetime",
    quickState.lastQuickCheck.completedAt,
  );
});
