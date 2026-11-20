// Run scripts/build.sh and parse its output. Owner: Agent B. Spec: docs/03-data-layer.md ("Running and parsing scripts/build.sh").
import { spawn } from "node:child_process";
import { CAREER_ROOT } from "./paths";
import { scrubbedEnv } from "./claude/env";
import type { BuildResult } from "./types";

const BUILD_TIMEOUT_MS = 3 * 60 * 1000;

/** Pure: parse build.sh stdout+stderr. `exitCode` is authoritative for `ok`; regexes only fill the display fields. */
export function parseBuildOutput(
  output: string,
  exitCode: number,
): BuildResult {
  const result: BuildResult = {
    ok: exitCode === 0,
    pages: null,
    fillPct: null,
    ats: null,
    warnings: [],
    failures: [],
    pdfPath: null,
    pngPath: null,
    raw: output,
  };

  let inWarnings = false; // inside the "! warnings:" block (indented lines)
  for (const line of output.split(/\r?\n/)) {
    const t = line.trim();

    if (t === "! warnings:") {
      inWarnings = true;
      continue;
    }
    if (inWarnings) {
      // The block ends at the first line that isn't indented.
      if (/^\s{2,}\S/.test(line)) {
        result.warnings.push(t);
        continue;
      }
      inWarnings = false;
    }

    let m: RegExpExecArray | null;
    if ((m = /^[✓✗]\s+(\d+) pages?\b/.exec(t))) {
      result.pages = Number(m[1]);
    } else if ((m = /fill:\s*(\d+(?:\.\d+)?)%/.exec(t))) {
      result.fillPct = Number(m[1]);
    } else if (t === "PASS (with warnings)") {
      result.ats = "PASS (with warnings)";
    } else if (t === "PASS") {
      result.ats = "PASS";
    } else if (t === "FAIL") {
      result.ats = "FAIL";
    } else if ((m = /^✓ wrote\s+(.+)$/.exec(t))) {
      result.pdfPath = m[1];
    } else if ((m = /^✓ render:\s+(.+)$/.exec(t))) {
      result.pngPath = m[1];
    }

    if (t.startsWith("✗")) {
      result.failures.push(t.replace(/^✗\s*/, ""));
    } else if (t.startsWith("! ")) {
      // ATS "!" check lines (their deeper-indented detail lines are not captured).
      result.warnings.push(t.replace(/^!\s*/, ""));
    }
  }
  return result;
}

/**
 * Spawn `scripts/build.sh <texRel> --png <pngDir> --no-text` in CAREER_ROOT (3-minute timeout).
 * `opts` lets tests point at a fake script/root; production callers pass nothing.
 */
export function runBuild(
  texRel: string,
  pngDir: string,
  opts: {
    root?: string;
    command?: string;
    timeoutMs?: number;
    staging?: boolean;
    signal?: AbortSignal;
    tempDir?: string;
  } = {},
): Promise<BuildResult> {
  const root = opts.root ?? CAREER_ROOT;
  const command = opts.command ?? "scripts/build.sh";
  const timeoutMs = opts.timeoutMs ?? BUILD_TIMEOUT_MS;

  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    // Declared before use in `finish`; assigned right after spawn.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let stopCode: number | undefined;
    let stopMessage = "";
    const finish = (code: number, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      opts.signal?.removeEventListener("abort", cancel);
      resolve(parseBuildOutput(out + extra, code));
    };

    const args = [texRel, "--png", pngDir, "--no-text"];
    if (opts.staging) args.push("--staging");
    const child = spawn(/* turbopackIgnore: true */ command, args, {
      cwd: root,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      // Never hand the server's full environment (tokens, API keys) to pdflatex, which compiles
      // Claude-written LaTeX. openin_any/openout_any=p is TeX's "paranoid" file-access mode: no
      // absolute paths or ".." outside the working tree and TeX's own directories.
      env: {
        ...scrubbedEnv({ ...process.env, ANTHROPIC_API_KEY: undefined }),
        ...(opts.tempDir ? { TMPDIR: opts.tempDir } : {}),
        openin_any: "p",
        openout_any: "p",
      } as unknown as NodeJS.ProcessEnv,
    });
    // Kill the entire process group, then wait for close: releasing the lock early leaves
    // pdflatex/sleep grandchildren running and allows a new job to overlap the old one.
    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already exited */
      }
    };
    const stop = (code: number, message: string) => {
      if (settled || stopCode !== undefined) return;
      stopCode = code;
      stopMessage = message;
      killTree("SIGTERM");
      escalation = setTimeout(() => killTree("SIGKILL"), 1000);
    };
    const cancel = () => stop(130, "\n✗ build cancelled\n");
    timer = setTimeout(
      () =>
        stop(
          124,
          `\n✗ build timed out after ${Math.round(timeoutMs / 1000)}s\n`,
        ),
      timeoutMs,
    );
    opts.signal?.addEventListener("abort", cancel, { once: true });
    if (opts.signal?.aborted) cancel();

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) =>
      finish(127, `\n✗ could not start build: ${e.message}\n`),
    );
    child.on("close", (code) => {
      // A detached descendant may ignore SIGTERM and close its pipes before the parent exits.
      // Kill the remaining group before clearing escalation and releasing the job lock.
      if (stopCode !== undefined) killTree("SIGKILL");
      finish(stopCode ?? code ?? 1, stopMessage);
    });
  });
}
