#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.dirname(import.meta.dirname);
const launcher = path.join(root, "scripts/ui.sh");
const log = path.join(root, "ui/.cache/shortcut.log");

function runningPort() {
  const result = spawnSync("bash", [launcher, "status"], { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error("Could not check the workspace launcher.");
  return Number(/http:\/\/127\.0\.0\.1:(\d+)/.exec(result.stdout)?.[1]);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function ready(url) {
  try {
    const response = await fetch(`${url}/api/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(1500),
    });
    return response.ok && (await response.json()).careerRoot === root;
  } catch {
    return false;
  }
}

async function openBrowser(url) {
  const onWsl = process.platform === "linux" && /microsoft/i.test(os.release());
  const [command, ...args] = onWsl
    ? ["rundll32.exe", "url.dll,FileProtocolHandler", url]
    : [process.platform === "darwin" ? "open" : "xdg-open", url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  } catch {
    console.error("Open the address above in your browser.");
  }
}

async function main() {
  if (
    process.argv.length > 3 ||
    (process.argv[2] && !/^\d+$/.test(process.argv[2]))
  )
    throw new Error("Usage: node scripts/open-workspace.mjs [port]");
  const requested = Number(process.argv[2] ?? process.env.CAREER_PORT ?? 3001);
  if (!Number.isInteger(requested) || requested < 1024 || requested > 65535)
    throw new Error("Choose a port from 1024 to 65535.");

  let port = runningPort();
  let child;
  let startError;
  if (!port) {
    const portAvailable = await portIsFree(requested);
    // Another click may have started the workspace while the port was checked.
    port = runningPort();
    if (!port && !portAvailable)
      throw new Error(
        `Port ${requested} is in use. Pass a different port and update your shortcut and bookmark.`,
      );
    if (!port) {
      port = requested;
      mkdirSync(path.dirname(log), { recursive: true });
      const output = openSync(log, "a", 0o600);
      try {
        child = spawn("bash", [launcher], {
          cwd: root,
          detached: true,
          env: {
            ...process.env,
            PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
            CAREER_PORT: String(port),
          },
          stdio: ["ignore", output, output],
        });
        child.once("error", (error) => {
          startError = error;
        });
        child.unref();
      } finally {
        closeSync(output);
      }
    }
  }

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (await ready(url)) {
      console.log(url);
      await openBrowser(url);
      return;
    }
    if (startError) throw startError;
    if (child?.exitCode != null && runningPort() !== port)
      throw new Error(`The workspace launcher stopped. See ${log}.`);
    await delay(500);
  }
  throw new Error(
    `The workspace did not respond at ${url}. Check launcher status and ${log}.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
