// Walks the tour on desktop and phone. DEMO_URL checks a deployed copy; otherwise serves out/.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { serve } from "./serve.mjs";

const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const server = process.env.DEMO_URL ? null : await serve(4100);
const base = process.env.DEMO_URL ?? "http://127.0.0.1:4100";
const origin = new URL(base).origin;
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
});
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
      colorScheme: "dark",
      viewport,
      hasTouch: name === "phone",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    const outside = [];
    const apiCalls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (/^https?:$/.test(url.protocol) && url.origin !== origin)
        outside.push(r.url());
      if (url.pathname.startsWith("/api/")) apiCalls.push(r.url());
    });
    const seen = async (text, timeout = 15000) =>
      page
        .getByText(text)
        .filter({ visible: true })
        .first()
        .waitFor({ timeout })
        .then(
          () => true,
          () => false,
        );
    const settle = async (shot) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(900);
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      check(wide <= 0, `${name} ${shot}: no sideways scroll (${wide})`);
      if (shots)
        await page.screenshot({ path: `${shots}/${name}-${shot}.png` });
    };
    const visit = async (path) => {
      await page.goto(base + path);
      check(
        await page
          .getByRole("link", { name: "How to set it up" })
          .first()
          .waitFor()
          .then(
            () => true,
            () => false,
          ),
        `${name} ${path}: setup link is visible`,
      );
    };
    const go = async (label) => {
      if (name === "phone")
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .filter({ visible: true })
        .getByRole("link", { name: label })
        .click();
    };

    await visit("/");
    check(
      await seen("Complete the take-home exercise"),
      `${name} dashboard shows follow-ups`,
    );
    await settle("dashboard");

    await go("Tracker");
    check(await seen("Tidewell Health"), `${name} tracker lists applications`);
    await settle("tracker");
    const search = page.getByPlaceholder(/search/i).first();
    await search.fill("Kitebridge");
    check(
      await seen("Kitebridge Logistics"),
      `${name} tracker search finds a job`,
    );
    check(
      !(await page
        .getByText("Tidewell Health")
        .filter({ visible: true })
        .count()),
      `${name} tracker search hides others`,
    );
    await page
      .getByText("Kitebridge Logistics")
      .filter({ visible: true })
      .first()
      .click();
    check(
      await seen(/Build and run Python services at Kitebridge/),
      `${name} application opens`,
    );
    await settle("application");
    await page.keyboard.press("Escape");

    await page.goto(`${base}/actions`);
    check(
      await seen("Choose a time for a phone screen"),
      `${name} actions list`,
    );
    await settle("actions");
    await page
      .getByRole("button", { name: /mark completed/i })
      .filter({ visible: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Confirm complet/i })
      .filter({ visible: true })
      .first()
      .click();
    check(
      await page
        .getByRole("button", { name: /^Open\s*3/ })
        .first()
        .waitFor()
        .then(
          () => true,
          () => false,
        ),
      `${name} completing an action updates the count`,
    );

    await page.goto(`${base}/workshop`);
    check(await seen("Trail Conditions"), `${name} workshop lists projects`);
    await settle("workshop");

    await page.goto(`${base}/docs`);
    await page.getByRole("button", { name: /Interview checklist/ }).click();
    check(
      await seen("Send a short thank-you note the same day"),
      `${name} doc opens`,
    );
    await settle("docs");

    await page.goto(`${base}/apply`);
    await page.getByRole("button", { name: "Load Quick add example" }).click();
    check(
      await seen("Example loaded. Choose Quick add"),
      `${name} quick example loads`,
    );
    await settle("quick-loaded");
    await page.getByRole("button", { name: /^Quick add \(2\)/ }).click();
    check(await seen(/Added 2 jobs/), `${name} quick add logs both`);
    await settle("quick-done");
    await go("Tracker");
    check(
      await seen("Lanternfish Learning"),
      `${name} quick add reaches the tracker`,
    );
    await go("Apply");
    await page.getByRole("button", { name: "Load Review example" }).click();
    check(
      await seen("Example loaded. Choose Review"),
      `${name} review example loads`,
    );
    check(
      (await page.locator("#jobpost").inputValue()).includes("Harborlight"),
      `${name} review text is filled in`,
    );
    await page
      .locator("main")
      .getByRole("button", { name: /^Review( job)?\b/ })
      .last()
      .click();
    check(
      await seen(/Prepared example · /),
      `${name} review shows a labelled result`,
    );
    await page
      .getByText(/Prepared example · /)
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await settle("review");

    await page.goto(`${base}/run-locally`);
    check(/\/setup$/.test(page.url()), `${name} old setup address redirects`);
    check(await seen("./scripts/setup.sh"), `${name} setup shows commands`);
    await page
      .getByRole("button", { name: "Copy all commands" })
      .first()
      .click();
    const copied = await page
      .evaluate(() => navigator.clipboard.readText())
      .catch(() => "");
    check(
      /^git clone [\s\S]*\.\/scripts\/setup\.sh\n\.\/scripts\/ui\.sh$/.test(
        copied,
      ),
      `${name} commands copy`,
    );
    for (const label of [
      "Install what you need",
      "Download, set up and run",
      "Add your profile and resume",
      "Connect your AI (optional)",
      "Option 3: ChatGPT plan",
      "Connect your email (optional)",
      "Log your first application",
      "Back to the demo",
      "View on GitHub",
    ])
      check(await seen(label), `${name} setup: ${label}`);
    await settle("setup");
    if (shots)
      await page.screenshot({
        path: `${shots}/${name}-setup-full.png`,
        fullPage: true,
      });

    const root = page.locator("html");
    check(
      !/\bdark\b/.test((await root.getAttribute("class")) ?? ""),
      `${name} night mode is off by default`,
    );
    await page
      .getByRole("button", { name: "Night mode" })
      .filter({ visible: true })
      .click();
    check(
      /\bdark\b/.test((await root.getAttribute("class")) ?? ""),
      `${name} night mode turns on`,
    );
    await page.goto(`${base}/`);
    await seen("Complete the take-home exercise");
    await settle("dark");

    check(!outside.length, `${name} no outside requests ${outside}`);
    check(!apiCalls.length, `${name} no API network calls ${apiCalls}`);
    check(
      !errors.length,
      `${name} no browser errors ${errors.join(" | ").slice(0, 600)}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server?.close();
}
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
