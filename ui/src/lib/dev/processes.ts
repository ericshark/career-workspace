import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path, { dirname } from "node:path";
import { CAREER_ROOT } from "@/lib/paths";
import { stripVTControlCharacters } from "node:util";
import { isPortAccepting } from "./ports";
import type { LogLine, RunInfo, RunKind } from "./types";

const MAX_LOG_LINES = 5000;
const READY_POLL_MS = 500;
const SIGTERM_AFTER_MS = 3000;
const SIGKILL_AFTER_MS = 8000;

export interface StartSpec {
  projectId: string;
  worktree: string;
  name: string;
  kind: RunKind;
  command: string;
  cwd: string;
  env?: Record<string, string>;
  port?: number | null;
  url?: string | null;
}

interface Run {
  info: RunInfo;
  child: ChildProcess;
  pgid: number;
  logs: LogLine[];
  partial: { out: string; err: string };
  stopRequested: boolean;
  readyTimer?: NodeJS.Timeout;
  exited: Promise<void>;
}

interface PidRecord {
  pgid: number;
  startTime: string | null;
  command: string;
}

/** The pid file: which server wrote it, and the process groups it had running. */
interface PidFile {
  owner: { pid: number; startTime: string | null };
  runs: PidRecord[];
}

const LOCAL_URL =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s'")]*/;

/** Field 22 of /proc/<pid>/stat: start time since boot, which tells a reused pid apart. */
function processStartTime(pid: number): string | null {
  try {
    if (process.platform === "darwin")
      return (
        execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() || null
      );
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // The group is already gone.
  }
}

/** The Career UI's own npm env (npm_package_*, npm_config_*) and PORT would leak into the project's scripts. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // NODE_ENV is dropped too: the Career UI runs as "production", which would
    // make a project's own dev server behave like a production build.
    if (
      !key.startsWith("npm_") &&
      !/^(OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|CODEX_API_KEY)$/.test(
        key,
      ) &&
      !["INIT_CWD", "PORT", "NODE_ENV"].includes(key)
    )
      env[key] = value;
  }
  return {
    ...env,
    FORCE_COLOR: "1",
    BROWSER: "none",
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

export class ProcessManager extends EventEmitter<{
  change: [RunInfo];
  log: [string, LogLine[]];
}> {
  private runs = new Map<string, Run>();
  private pidFile: string;

  constructor(pidFile: string) {
    super();
    this.pidFile = pidFile;
  }

  list(filter: { projectId?: string; worktree?: string } = {}): RunInfo[] {
    return [...this.runs.values()]
      .map((run) => run.info)
      .filter(
        (info) =>
          (!filter.projectId || info.projectId === filter.projectId) &&
          (!filter.worktree || info.worktree === filter.worktree),
      );
  }

  get(id: string): RunInfo | undefined {
    return this.runs.get(id)?.info;
  }

  logs(id: string): LogLine[] | undefined {
    return this.runs.get(id)?.logs;
  }

  findActive(
    projectId: string,
    worktree: string,
    name: string,
    kind: RunKind,
  ): RunInfo | undefined {
    return this.list({ projectId, worktree }).find(
      (info) => info.name === name && info.kind === kind && isActive(info),
    );
  }

  /** Ports held by live runs; they may not be bound yet, so a free-port probe can't see them. */
  reservedPorts(): Set<number> {
    return new Set(
      this.list()
        .filter(isActive)
        .flatMap((info) => (info.port ? [info.port] : [])),
    );
  }

  start(spec: StartSpec): RunInfo {
    // Only the latest run per service is kept, so its logs stay around after it exits.
    for (const [id, run] of this.runs) {
      const { info } = run;
      if (
        info.projectId === spec.projectId &&
        info.worktree === spec.worktree &&
        info.name === spec.name &&
        info.kind === spec.kind &&
        !isActive(info)
      ) {
        this.runs.delete(id);
      }
    }

    const child = spawn("bash", ["-c", spec.command], {
      cwd: spec.cwd,
      env: childEnv(spec.env),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const info: RunInfo = {
      id: randomUUID().slice(0, 8),
      projectId: spec.projectId,
      worktree: spec.worktree,
      name: spec.name,
      kind: spec.kind,
      command: spec.command,
      cwd: spec.cwd,
      port: spec.port ?? null,
      url: spec.url ?? null,
      status: spec.kind === "service" && spec.port ? "starting" : "running",
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
    };

    let resolveExited!: () => void;
    const run: Run = {
      info,
      child,
      pgid: child.pid ?? -1,
      logs: [],
      partial: { out: "", err: "" },
      stopRequested: false,
      exited: new Promise((resolve) => (resolveExited = resolve)),
    };
    this.runs.set(info.id, run);
    this.append(run, [
      { stream: "sys", text: `$ ${spec.command}` },
      { stream: "sys", text: `  in ${spec.cwd}` },
    ]);

    child.stdout?.on("data", (chunk: Buffer) =>
      this.onOutput(run, "out", chunk),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      this.onOutput(run, "err", chunk),
    );
    child.on("error", (error) => {
      this.append(run, [
        { stream: "sys", text: `Failed to start: ${error.message}` },
      ]);
    });
    child.on("close", (code, signal) => {
      this.flushPartial(run);
      clearInterval(run.readyTimer);
      // `bash -c` may exit before its children (e.g. `a & b`), so sweep the rest of the group.
      if (groupAlive(run.pgid)) signalGroup(run.pgid, "SIGTERM");
      info.exitCode = code;
      info.endedAt = Date.now();
      info.status = run.stopRequested || code === 0 ? "exited" : "failed";
      const how = signal ? `signal ${signal}` : `code ${code}`;
      this.append(run, [
        {
          stream: "sys",
          text: run.stopRequested ? "Stopped." : `Exited with ${how}.`,
        },
      ]);
      this.savePids();
      this.emit("change", { ...info });
      resolveExited();
    });

    if (info.status === "starting" && info.port)
      this.watchReady(run, info.port);
    this.savePids();
    this.emit("change", { ...info });
    return { ...info };
  }

  stop(id: string): Promise<void> {
    const run = this.runs.get(id);
    if (!run || !isActive(run.info)) return Promise.resolve();
    run.stopRequested = true;
    run.info.status = "stopping";
    this.emit("change", { ...run.info });

    // SIGINT first: it's what Ctrl-C sends, and lets `docker compose up` stop its containers.
    signalGroup(run.pgid, "SIGINT");
    const term = setTimeout(
      () => signalGroup(run.pgid, "SIGTERM"),
      SIGTERM_AFTER_MS,
    );
    const kill = setTimeout(
      () => signalGroup(run.pgid, "SIGKILL"),
      SIGKILL_AFTER_MS,
    );
    return run.exited.then(() => {
      clearTimeout(term);
      if (!groupAlive(run.pgid)) clearTimeout(kill);
    });
  }

  /** Resolves with the run's final state once its process has exited. */
  async waitForExit(id: string): Promise<RunInfo | undefined> {
    const run = this.runs.get(id);
    if (!run) return undefined;
    await run.exited;
    return { ...run.info };
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      this.list()
        .filter(isActive)
        .map((info) => this.stop(info.id)),
    );
  }

  /** Last resort on process exit: synchronous, no waiting. */
  killAllNow(): void {
    for (const run of this.runs.values()) {
      if (groupAlive(run.pgid)) signalGroup(run.pgid, "SIGKILL");
    }
  }

  /** Kills process groups recorded by a previous server that didn't shut down cleanly. */
  reapOrphans(): number {
    let records: PidRecord[];
    try {
      const file = JSON.parse(readFileSync(this.pidFile, "utf8")) as PidFile;
      // Another Career server (say, a dev server beside the live one) still
      // owns these; they are not orphans.
      const { pid, startTime } = file.owner;
      if (pid !== process.pid && processStartTime(pid) === startTime) return 0;
      records = file.runs;
    } catch {
      return 0;
    }
    let reaped = 0;
    for (const record of records) {
      const leaderStart = processStartTime(record.pgid);
      // A live leader with a different start time means the pid now belongs to someone else.
      if (leaderStart !== null && leaderStart !== record.startTime) continue;
      if (groupAlive(record.pgid)) {
        signalGroup(record.pgid, "SIGKILL");
        reaped++;
      }
    }
    this.savePids();
    return reaped;
  }

  private watchReady(run: Run, port: number): void {
    run.readyTimer = setInterval(async () => {
      if (run.info.status !== "starting") return clearInterval(run.readyTimer);
      if (await isPortAccepting(port)) {
        clearInterval(run.readyTimer);
        if (run.info.status !== "starting") return;
        run.info.status = "running";
        this.emit("change", { ...run.info });
      }
    }, READY_POLL_MS);
  }

  private onOutput(run: Run, stream: "out" | "err", chunk: Buffer): void {
    const text = run.partial[stream] + chunk.toString("utf8");
    const parts = text.split(/\r?\n/);
    run.partial[stream] = parts.pop() ?? "";
    if (parts.length)
      this.append(
        run,
        parts.map((line) => ({ stream, text: line })),
      );
  }

  private flushPartial(run: Run): void {
    for (const stream of ["out", "err"] as const) {
      if (run.partial[stream])
        this.append(run, [{ stream, text: run.partial[stream] }]);
      run.partial[stream] = "";
    }
  }

  private append(run: Run, lines: LogLine[]): void {
    run.logs.push(...lines);
    if (run.logs.length > MAX_LOG_LINES)
      run.logs.splice(0, run.logs.length - MAX_LOG_LINES);
    this.emit("log", run.info.id, lines);

    // Services the hub can't assign a port to (docker compose, custom scripts) announce their URL.
    if (!run.info.url && run.info.kind === "service") {
      for (const line of lines) {
        if (line.stream === "sys") continue;
        const match = LOCAL_URL.exec(stripVTControlCharacters(line.text));
        if (match) {
          run.info.url = match[0].replace("0.0.0.0", "localhost");
          this.emit("change", { ...run.info });
          break;
        }
      }
    }
  }

  private savePids(): void {
    const records: PidRecord[] = [...this.runs.values()]
      .filter((run) => isActive(run.info) && run.pgid > 0)
      .map((run) => ({
        pgid: run.pgid,
        startTime: processStartTime(run.pgid),
        command: run.info.command,
      }));
    try {
      mkdirSync(dirname(this.pidFile), { recursive: true });
      const file: PidFile = {
        owner: { pid: process.pid, startTime: processStartTime(process.pid) },
        runs: records,
      };
      writeFileSync(this.pidFile, JSON.stringify(file, null, 2));
    } catch (error) {
      console.error(
        `[workshop dev] could not write ${this.pidFile}: ${(error as Error).message}`,
      );
    }
  }
}

export function isActive(info: RunInfo): boolean {
  return (
    info.status === "starting" ||
    info.status === "running" ||
    info.status === "stopping"
  );
}

const PID_FILE = path.join(CAREER_ROOT, "ui/.cache/dev-runs.json");

declare global {
  // eslint-disable-next-line no-var
  var __workshopDevProcesses: ProcessManager | undefined;
}

/**
 * The one process manager of this server. It lives on globalThis so a hot
 * reload in development does not orphan the dev servers it started, and it
 * stops them all when the Career UI shuts down.
 */
export function devProcesses(): ProcessManager {
  if (!globalThis.__workshopDevProcesses) {
    const manager = new ProcessManager(PID_FILE);
    globalThis.__workshopDevProcesses = manager;
    // SIGINT reaches each dev server's process group right away; the exit hook
    // is the synchronous backstop for anything that ignores it.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.once(signal, () => void manager.stopAll());
    process.on("exit", () => manager.killAllNow());
  }
  return globalThis.__workshopDevProcesses;
}
