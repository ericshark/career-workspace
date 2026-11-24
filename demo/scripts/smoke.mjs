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
    const agentTab = page.getByRole("tab", { name: "Set up with your agent" });
    const manualTab = page.getByRole("tab", { name: "Set up manually" });
    check(
      (await agentTab.getAttribute("aria-selected")) === "true",
      `${name}: agent setup opens first`,
    );
    const agentSetup = page.getByRole("tabpanel", {
      name: "Set up with your agent",
    });
    check(
      (await agentSetup.getByRole("listitem").count()) === 4,
      `${name}: agent setup explains all four steps`,
    );
    await page.getByRole("button", { name: "Copy prompt" }).click();
    const prompt = await page.locator("pre").textContent();
    check(
      prompt?.includes("--yes --no-start") &&
        (await page.evaluate(() => navigator.clipboard.readText())) === prompt,
      `${name}: full setup prompt copies`,
    );
    await settle("agent setup");
    if (shots)
      await page.screenshot({
        path: `${shots}/${name}-setup-agent.png`,
        fullPage: true,
      });
    await agentTab.focus();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("tabpanel", { name: "Set up manually" }).waitFor();
    check(
      (await manualTab.getAttribute("aria-selected")) === "true",
      `${name}: keyboard selects manual setup`,
    );
    await page
      .getByRole("button", { name: "Copy all commands" })
      .first()
      .click();
    check(
      (await page.evaluate(() => navigator.clipboard.readText())) ===
        "npx create-career-workspace",
      `${name}: terminal command copies`,
    );
    for (const label of [
      "Clone with Git",
      "Reopen Career Workspace",
      "Back to the demo",
    ])
      check(await seen(label), `${name} manual setup: ${label}`);
    await settle("manual setup");
    if (shots)
      await page.screenshot({
        path: `${shots}/${name}-setup-manual.png`,
        fullPage: true,
      });

    await page
      .locator("header.sticky")
      .getByRole("link", { name: "How it works" })
      .click();
    await page.waitForURL("**/how-it-works");
    for (const [label, href] of [
      ["Dashboard", "/"],
      ["Actions", "/actions"],
      ["Apply", "/apply"],
      ["Tracker", "/tracker"],
      ["Workshop", "/workshop"],
      ["Docs", "/docs"],
    ]) {
      const link = page
        .getByRole("heading", { name: label, exact: true })
        .getByRole("link");
      check(
        (await link.getAttribute("href")) === href,
        `${name}: feature link for ${label}`,
      );
    }
    check(
      await seen("Career Check Dry Run"),
      `${name}: Gmail workflow explained`,
    );
    const appGuide = page.getByRole("region", { name: "In the app" });
    const agentGuide = page.getByRole("region", { name: "In your agent" });
    for (const skill of [
      "Career Workspace Setup",
      "Career Check",
      "Inbox Check",
      "Actions Check",
      "Opportunity Check",
      "Tailor Resume",
      "ATS Check",
    ]) {
      check(
        await agentGuide
          .getByRole("heading", { name: skill, exact: true })
          .isVisible(),
        `${name}: explains ${skill}`,
      );
    }
    check(
      await appGuide
        .getByText("Uses your AI connection", { exact: true })
        .isVisible(),
      `${name}: app authentication is identified`,
    );
    const jump = page
      .getByRole("navigation", { name: "On this page" })
      .getByRole("link", { name: "In your agent" });
    await jump.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/how-it-works#in-your-agent");
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle("how it works");
    if (shots)
      await page.screenshot({
        path: `${shots}/${name}-how-it-works.png`,
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
