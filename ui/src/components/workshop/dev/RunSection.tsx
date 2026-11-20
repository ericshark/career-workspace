"use client";

import { useState } from "react";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type {
  DevDetail,
  RunInfo,
  RunStatus,
  WorktreeInfo,
} from "@/lib/dev/types";
import { cn } from "@/lib/utils";
import { devPost } from "./api";
import { LogsPanel } from "./LogsPanel";

const statusLabel: Record<RunStatus, string> = {
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  exited: "Stopped",
  failed: "Failed",
};
const statusTone: Record<RunStatus, string> = {
  starting: "bg-warning/15 text-warning",
  running: "bg-success/15 text-success",
  stopping: "bg-warning/15 text-warning",
  exited: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};
const active = (run: RunInfo) =>
  run.status === "starting" ||
  run.status === "running" ||
  run.status === "stopping";

/** Stop is red and Open is green, so the two read at a glance. */
const stopClass =
  "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive";
const openClass =
  "border-success/30 bg-success/15 text-success hover:bg-success/25 hover:text-success";

/** The latest run of a named service or setup step. */
const latest = (runs: RunInfo[], name: string, kind: RunInfo["kind"]) =>
  runs
    .filter((run) => run.name === name && run.kind === kind)
    .sort((a, b) => b.startedAt - a.startedAt)[0];

const branchOf = (entry: WorktreeInfo) =>
  entry.git.branch ?? entry.git.head ?? "Detached HEAD";

/**
 * Run, stop and install for one checkout, as one thin bar. The chevron opens
 * the command, setup instructions and logs. The server decides what a run is
 * (the project's own dev script, or a setup in ui/.workshop/dev.json); nothing
 * typed here becomes a command.
 */
export function RunSection({
  itemId,
  detail,
  worktree,
  onSelectWorktree,
  onChange,
  onError,
}: {
  itemId: string;
  detail: DevDetail;
  /** The selected checkout's path. */
  worktree: string;
  onSelectWorktree: (path: string) => void;
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const checkout =
    detail.checkouts.find((entry) => entry.path === worktree) ??
    detail.checkouts[0];
  const [busy, setBusy] = useState<string | null>(null);
  const [logRun, setLogRun] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);
  const runs = checkout.runs;
  const logTabs = runs.filter(
    (run) => latest(runs, run.name, run.kind)?.id === run.id,
  );
  const selectedLog =
    logTabs.find((run) => run.id === logRun?.id) ??
    logTabs.find((run) => run.kind === "setup" && run.name === logRun?.title) ??
    logTabs[0];
  const running = runs.filter((run) => run.kind === "service" && active(run));
  const installing = runs.some((run) => run.kind === "setup" && active(run));
  const needsInstall = checkout.missing.length > 0;

  async function act(
    label: string,
    action: string,
    body: object = {},
    after?: (result: { runs?: RunInfo[]; steps?: string[] }) => void,
  ) {
    setBusy(label);
    try {
      const result = await devPost<{ runs?: RunInfo[]; steps?: string[] }>(
        itemId,
        action,
        {
          worktree: checkout.path,
          ...body,
        },
      );
      after?.(result);
      await onChange();
    } catch (failure) {
      onError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }
  // Starting something opens the panel so its output is in view.
  const showLogs = (run: RunInfo | undefined) => {
    if (run) setLogRun({ id: run.id, title: run.name });
    setExpanded(true);
  };
  const showSetup = (result: { steps?: string[] }) => {
    setLogRun({ id: "", title: result.steps?.[0] ?? "Setup" });
    setExpanded(true);
  };

  const multiple = detail.services.length > 1;
  // The bar speaks for the one service; with several, each gets its own row below.
  const only = multiple
    ? undefined
    : latest(runs, detail.services[0]?.name ?? "", "service");
  const onlyLive = only && active(only);
  const canStart = detail.canRun && detail.services.length > 0;
  const hasOptions =
    running.length > 0 ||
    checkout.installed.length > 0 ||
    (detail.setup.length > 0 && !needsInstall);

  return (
    <section aria-label="Run" className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <h3 className="text-sm font-semibold">Run locally</h3>
        {detail.checkouts.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="xs"
                variant="outline"
                aria-label="Choose checkout to run"
                className="max-w-48 font-mono"
              >
                <span className="truncate">{branchOf(checkout)}</span>
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-80">
              {detail.checkouts.map((entry) => (
                <DropdownMenuItem
                  key={entry.path}
                  title={entry.path}
                  onSelect={() => onSelectWorktree(entry.path)}
                >
                  <span className="truncate font-mono">{branchOf(entry)}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.isMain ? "Main" : "Worktree"}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="max-w-48 truncate font-mono text-xs text-muted-foreground">
            {branchOf(checkout)}
          </span>
        )}
        {only && (
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                statusTone[only.status],
              )}
            >
              {statusLabel[only.status]}
              {only.status === "failed" && only.exitCode !== null
                ? ` (${only.exitCode})`
                : ""}
            </span>
            {only.port && onlyLive && (
              <span className="font-mono text-xs text-muted-foreground">
                :{only.port}
              </span>
            )}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {detail.setup.length > 0 && detail.canRun && needsInstall && (
            <Button
              size="sm"
              disabled={busy !== null || installing}
              onClick={() => void act("install", "install", {}, showSetup)}
            >
              <DownloadIcon />
              {installing ? "Installing…" : "Install dependencies"}
            </Button>
          )}
          {canStart &&
            (running.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className={stopClass}
                disabled={busy !== null}
                onClick={() => void act("stop", "stop")}
              >
                <SquareIcon /> Stop
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy !== null || installing || needsInstall}
                title={
                  needsInstall
                    ? "Install dependencies first"
                    : "Start the dev server"
                }
                onClick={() =>
                  void act("run", "run", {}, (result) =>
                    showLogs(result.runs?.[0]),
                  )
                }
              >
                <PlayIcon /> {multiple ? "Run all" : "Run"}
              </Button>
            ))}
          {/* Open is there from the start but only works once the server answers. */}
          {canStart &&
            !multiple &&
            (only?.url && only.status === "running" ? (
              <Button asChild size="sm" variant="outline" className={openClass}>
                <a href={only.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon /> Open
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled>
                <ExternalLinkIcon /> Open
              </Button>
            ))}
          {detail.canRun && hasOptions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Run options"
                  disabled={busy !== null}
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {detail.setup.length > 0 && !needsInstall && (
                  <DropdownMenuItem
                    disabled={installing}
                    onSelect={() =>
                      void act("install", "install", { all: true }, showSetup)
                    }
                  >
                    Reinstall
                  </DropdownMenuItem>
                )}
                {running.length > 0 && (
                  <DropdownMenuItem
                    onSelect={() =>
                      void act("restart", "restart", {}, (result) =>
                        showLogs(result.runs?.[0]),
                      )
                    }
                  >
                    Restart
                  </DropdownMenuItem>
                )}
                {checkout.installed.length > 0 && (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      if (
                        window.confirm(
                          `Delete ${checkout.installed.join(", ")} from this checkout? Anything running is stopped first.`,
                        )
                      )
                        void act("uninstall", "uninstall");
                    }}
                  >
                    Uninstall
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={`run-details-${itemId}`}
            aria-label={expanded ? "Hide run details" : "Show run details"}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDownIcon
              className={cn("transition-transform", expanded && "rotate-180")}
            />
          </Button>
        </span>
      </div>

      {!detail.canRun && (
        <p className="border-t px-3 py-2 text-sm text-muted-foreground">
          This is the Career UI itself, so it is not run from here. Start it
          from a terminal.
        </p>
      )}
      {detail.canRun && detail.services.length === 0 && (
        <p className="border-t px-3 py-2 text-sm text-muted-foreground">
          No dev script found. Add a <span className="font-mono">dev</span>{" "}
          script to its package.json, or configure it in{" "}
          <span className="font-mono">ui/.workshop/dev.json</span>.
        </p>
      )}
      {detail.canRun && needsInstall && (
        <p className="flex items-start gap-1.5 border-t px-3 py-2 text-sm text-warning">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          Missing in this checkout: {checkout.missing.join(", ")}. Install
          before running.
        </p>
      )}

      <div
        id={`run-details-${itemId}`}
        hidden={!expanded}
        className="space-y-3 border-t px-3 py-3"
      >
        {!multiple && detail.services[0] && (
          <div className="space-y-0.5 text-xs">
            <p className="font-medium text-muted-foreground">Command</p>
            <p className="break-all">
              <code>
                {latest(runs, detail.services[0].name, "service")?.command ??
                  detail.services[0].command}
              </code>
              {detail.services[0].cwd && (
                <span className="text-muted-foreground">
                  {" "}
                  · {detail.services[0].cwd}
                </span>
              )}
            </p>
          </div>
        )}

        {detail.canRun && multiple && (
          <ul aria-label="Services" className="divide-y rounded-lg border">
            {detail.services.map((service) => {
              const run = latest(runs, service.name, "service");
              const live = run && active(run);
              return (
                <li
                  key={service.name}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-sm">{service.name}</span>
                    <code className="block text-xs break-all text-muted-foreground">
                      {run?.command ?? service.command}
                    </code>
                  </span>
                  {run && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        statusTone[run.status],
                      )}
                    >
                      {statusLabel[run.status]}
                      {run.status === "failed" && run.exitCode !== null
                        ? ` (${run.exitCode})`
                        : ""}
                    </span>
                  )}
                  {run?.port && live && (
                    <span className="font-mono text-xs text-muted-foreground">
                      :{run.port}
                    </span>
                  )}
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    {run?.url && run.status === "running" ? (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className={openClass}
                      >
                        <a
                          href={run.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLinkIcon /> Open
                        </a>
                      </Button>
                    ) : (
                      service.open && (
                        <Button size="sm" variant="outline" disabled>
                          <ExternalLinkIcon /> Open
                        </Button>
                      )
                    )}
                    {live ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className={stopClass}
                        aria-label={`Stop ${service.name}`}
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`stop-${service.name}`, "stop", {
                            service: service.name,
                          })
                        }
                      >
                        <SquareIcon /> Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Run ${service.name}`}
                        disabled={busy !== null || needsInstall}
                        onClick={() =>
                          void act(
                            `run-${service.name}`,
                            "run",
                            { service: service.name },
                            (result) => showLogs(result.runs?.[0]),
                          )
                        }
                      >
                        <PlayIcon /> Run
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {detail.setup.length > 0 && (
          <div className="space-y-0.5 text-xs">
            <p className="font-medium text-muted-foreground">Setup</p>
            <ul className="space-y-1">
              {detail.setup.map((step) => (
                <li key={step.name} className="break-all">
                  <span className="font-medium">{step.name}: </span>
                  <code>
                    {latest(runs, step.name, "setup")?.command ?? step.command}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Logs</p>
          {logTabs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Output appears here once something runs.
            </p>
          ) : (
            <>
              <div
                role="tablist"
                aria-label="Service and setup logs"
                className="flex flex-wrap gap-1"
              >
                {logTabs.map((run) => (
                  <button
                    key={run.id}
                    id={`log-tab-${run.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selectedLog.id === run.id}
                    aria-controls={`log-panel-${itemId}`}
                    tabIndex={selectedLog.id === run.id ? 0 : -1}
                    onKeyDown={(event) => {
                      const index = logTabs.findIndex(
                        (tab) => tab.id === run.id,
                      );
                      const target =
                        event.key === "ArrowRight"
                          ? (index + 1) % logTabs.length
                          : event.key === "ArrowLeft"
                            ? (index + logTabs.length - 1) % logTabs.length
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? logTabs.length - 1
                                : null;
                      if (target === null) return;
                      event.preventDefault();
                      showLogs(logTabs[target]);
                      event.currentTarget.parentElement
                        ?.querySelector<HTMLButtonElement>(
                          `[id="log-tab-${logTabs[target].id}"]`,
                        )
                        ?.focus();
                    }}
                    onClick={() => showLogs(run)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium",
                      selectedLog.id === run.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {run.name} ·{" "}
                    {run.kind === "setup" && run.status === "exited"
                      ? "Done"
                      : statusLabel[run.status]}
                  </button>
                ))}
              </div>
              <div
                role="tabpanel"
                id={`log-panel-${itemId}`}
                aria-labelledby={`log-tab-${selectedLog.id}`}
              >
                <LogsPanel
                  key={selectedLog.id}
                  itemId={itemId}
                  runId={selectedLog.id}
                  title={selectedLog.name}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
