import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";

// The server can run an agent that writes files, so keep it off the LAN.
const HOST = "127.0.0.1";
const START = Number(process.env.CAREER_PORT || 3001);
if (!Number.isInteger(START) || START < 1024 || START > 65535)
  throw new Error("Invalid CAREER_PORT");
const BUILD_ID = ".next/BUILD_ID";
const BUILD_INPUTS = ".next/career-build-inputs";
const mode = process.argv[2] ?? "start";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
let child;
let interrupted = false;
let killTimer;
const GRACE_MS = 5000;

// Next runs in its own process group so one signal reaches every descendant
// (Next CLI, workers, the dev server), and nothing outside the group.
function signalGroup(signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {}
}

function shutdown(signal) {
  if (interrupted) {
    signalGroup("SIGKILL"); // second signal: stop waiting
    return;
  }
  interrupted = true;
  signalGroup(signal === "SIGHUP" ? "SIGTERM" : signal);
  // Bounded: escalate if Next ignores or hangs on the graceful signal.
  killTimer = setTimeout(() => signalGroup("SIGKILL"), GRACE_MS);
  if (!child) process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(signal));
}
// Terminal gone without a signal: stdout/stderr pipe breaks or stdin closes.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if (err.code === "EPIPE" || err.code === "EIO") shutdown("SIGTERM");
  });
}
if (process.stdin.isTTY) {
  process.stdin.on("end", () => shutdown("SIGTERM"));
  process.stdin.on("error", () => shutdown("SIGTERM"));
  process.stdin.resume();
}
// Last resort if this launcher exits any other way.
process.on("exit", () => signalGroup("SIGKILL"));

function runNext(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [nextBin, ...args], {
      stdio: "inherit",
      detached: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      signalGroup("SIGKILL"); // sweep any descendants that outlived Next
      clearTimeout(killTimer);
      child = undefined;
      resolve(interrupted ? 0 : (code ?? 1));
    });
  });
}

// A port counts as free only if we can actually listen on it.
function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, HOST);
  });
}

function buildFingerprint() {
  const hash = createHash("sha256");
  function add(path) {
    const contents = readFileSync(path);
    hash.update(JSON.stringify([path, contents.length])).update(contents);
  }
  for (const path of ["src", "public"]) {
    if (!existsSync(path)) continue;
    for (const file of readdirSync(path, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => `${entry.parentPath}/${entry.name}`)
      .sort()) {
      add(file);
    }
  }
  for (const path of [
    "next.config.ts",
    "postcss.config.mjs",
    "tsconfig.json",
    "package.json",
    "package-lock.json",
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ]) {
    if (existsSync(path)) add(path);
  }
  return hash.digest("hex");
}

async function main() {
  const fingerprint = mode === "dev" ? null : buildFingerprint();
  const current =
    existsSync(BUILD_ID) &&
    existsSync(BUILD_INPUTS) &&
    readFileSync(BUILD_INPUTS, "utf8") ===
      JSON.stringify([readFileSync(BUILD_ID, "utf8"), fingerprint]);
  if (mode === "rebuild" || (mode === "start" && !current)) {
    rmSync(BUILD_INPUTS, { force: true });
    console.log("Building the local Career UI…");
    const code = await runNext(["build"]);
    if (code || interrupted) {
      // A failed build can leave a partial output directory. Retry on next start.
      rmSync(BUILD_ID, { force: true });
      return code;
    }
    if (buildFingerprint() !== fingerprint) {
      console.error(
        "UI files changed during the build. Start the launcher again.",
      );
      return 1;
    }
    writeFileSync(
      BUILD_INPUTS,
      JSON.stringify([readFileSync(BUILD_ID, "utf8"), fingerprint]),
    );
  }
  if (mode === "rebuild" || interrupted) return 0;

  // No port escalation: a busy port means another instance (or program) owns it.
  const port = START;
  if (interrupted) return 0;
  if (!(await isFree(port))) {
    console.error(
      `Port ${port} is in use. Run scripts/ui.sh status or stop, then retry.`,
    );
    return 1;
  }

  console.log(`Career Workspace → http://127.0.0.1:${port}`);
  return runNext([mode, "-H", HOST, "-p", String(port)]);
}

const statePath = ".cache/launcher.pid";
if (process.env.CAREER_TRACK_LAUNCHER === "1") {
  mkdirSync(".cache", { recursive: true });
  writeFileSync(statePath, `${process.pid} ${START}`, { mode: 0o600 });
  process.on("exit", () => {
    if (
      existsSync(statePath) &&
      readFileSync(statePath, "utf8") === `${process.pid} ${START}`
    )
      rmSync(statePath, { force: true });
  });
}
process.exitCode = await main();
