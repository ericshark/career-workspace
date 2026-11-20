// Launch only a fixture server with disposable career data; always release its port afterward.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.dirname(ui);
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "career-browser-")),
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const available = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
let server;
let port = 3001;
let status = 1;
function removeFixture(dir) {
  fs.chmodSync(dir, 0o755);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
    if (entry.isDirectory()) removeFixture(path.join(dir, entry.name));
}
try {
  for (const category of ["tech", "general", "datacenter"]) {
    for (const rel of [
      `source/${category}/resume.tex`,
      `resumes/${category}/Resume.pdf`,
    ]) {
      const dest = path.join(root, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(repo, rel), dest);
    }
  }
  for (const rel of [
    "scripts/build.sh",
    "scripts/resume_build.py",
    "scripts/ats_check.py",
    "profile/career.md",
    "prompts/review-job.md",
    "prompts/tailor-resume.md",
    "prompts/quick-add.md",
    "prompts/answer-questions.md",
    "prompts/cover-letter.md",
    "prompts/review-followup.md",
  ]) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), dest);
    if (rel.endsWith(".sh") || rel.endsWith(".py")) fs.chmodSync(dest, 0o755);
  }
  fs.mkdirSync(path.join(root, "records"), { recursive: true });
  fs.copyFileSync(
    path.join(ui, "tests/fixtures/applications.one-row.md"),
    path.join(root, "records/applications.md"),
  );
  while (!(await available(port))) port++;
  const env = {
    ...process.env,
    CAREER_ROOT: root,
    UI_FIXTURES: "1",
    UI_FIXTURE_STEP_MS: "50",
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${port}`,
    PLAYWRIGHT_CAREER_ROOT: root,
    WORKSHOP_GITHUB_ROOT: path.join(root, "GitHub"),
  };
  // The installed production build is exercised; no watcher or compilation process remains.
  server = spawn(
    process.execPath,
    [
      path.join(ui, "node_modules/next/dist/bin/next"),
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    { cwd: ui, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let serverLog = "";
  server.stdout.on("data", (b) => (serverLog += b));
  server.stderr.on("data", (b) => (serverLog += b));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    try {
      if ((await fetch(`${env.PLAYWRIGHT_BASE_URL}/api/applications`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(200);
  }
  if (!ready) throw new Error(`Fixture server failed to start: ${serverLog}`);
  const test = spawn(
    process.execPath,
    [
      path.join(ui, "node_modules/@playwright/test/cli.js"),
      "test",
      ...process.argv.slice(2),
    ],
    { cwd: ui, env, stdio: "inherit" },
  );
  status = await new Promise((resolve) => {
    test.once("exit", (code) => resolve(code ?? 1));
    test.once("error", () => resolve(1));
  });
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      delay(5000),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  for (let i = 0; i < 50 && !(await available(port)); i++) await delay(100);
  if (!(await available(port))) {
    console.error(`Verification port ${port} was not released`);
    status = 1;
  } else console.log(`Fixture server stopped; port ${port} released.`);
  removeFixture(root);
  fs.rmSync(root, { recursive: true, force: true });
}
process.exitCode = status;
