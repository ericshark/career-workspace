import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectOverride } from "./config";
import { DevError } from "./errors";
import { findFreePort, waitForFreePort } from "./ports";
import { devProcesses, isActive } from "./processes";
import { projectDir, type DevRepo } from "./repo";
import {
  missingSetup,
  renderTemplate,
  resolveServices,
  resolveSetup,
  uninstall,
  usesPort,
} from "./services";
import type { RunInfo } from "./types";

/** Running the app that hosts Workshop would only fight over its own files and port. */
function refuseOwnApp(repo: DevRepo) {
  if (repo.isThisApp)
    throw new DevError(
      409,
      "This is the Career UI itself. Run it from a terminal instead.",
    );
}

/**
 * Starts every service of a checkout (or just `only`), allocating ports for all
 * of them first so `{ports.<name>}` resolves. `preferredPorts` are tried before a
 * fresh allocation, so a restart keeps its port. `keepClear` are ports that are
 * never handed out (the Career UI's own).
 */
export async function startServices(
  repo: DevRepo,
  checkoutPath: string,
  only?: string | string[],
  keepClear: number[] = [],
  preferredPorts: Record<string, number | null> = {},
): Promise<RunInfo[]> {
  refuseOwnApp(repo);
  const processes = devProcesses();
  const dir = projectDir(repo, { path: checkoutPath });
  const override = projectOverride(repo.folder);
  const services = resolveServices(dir, override);
  const names = only === undefined ? null : [only].flat();
  const targets = names
    ? services.filter((service) => names.includes(service.name))
    : services;
  if (targets.length === 0)
    throw new DevError(
      names ? 404 : 400,
      names
        ? `No service "${names.join('", "')}"`
        : "No dev script found for this project. Add one to its package.json, or configure it in ui/.workshop/dev.json.",
    );

  const reserved = processes.reservedPorts();
  for (const port of keepClear) reserved.add(port);
  const ports: Record<string, number | null> = {};
  for (const service of services) {
    const active = processes.findActive(
      repo.itemId,
      checkoutPath,
      service.name,
      "service",
    );
    if (active) ports[service.name] = active.port;
    else if (service.defaultPort && usesPort(service)) {
      const preferred = preferredPorts[service.name];
      const port =
        preferred &&
        !reserved.has(preferred) &&
        (await waitForFreePort(preferred))
          ? preferred
          : await findFreePort(service.defaultPort + 1, reserved);
      reserved.add(port);
      ports[service.name] = port;
    } else ports[service.name] = null;
  }

  const started: RunInfo[] = [];
  for (const service of targets) {
    if (
      processes.findActive(repo.itemId, checkoutPath, service.name, "service")
    )
      continue;
    const cwd = join(dir, service.cwd ?? "");
    if (!existsSync(cwd))
      throw new DevError(400, `${service.name}: ${cwd} does not exist`);
    const port = ports[service.name];
    const render = (template: string) => {
      try {
        return renderTemplate(template, ports, service.name);
      } catch (error) {
        throw new DevError(400, `${service.name}: ${(error as Error).message}`);
      }
    };
    started.push(
      processes.start({
        projectId: repo.itemId,
        worktree: checkoutPath,
        name: service.name,
        kind: "service",
        command: render(service.command),
        cwd,
        env: Object.fromEntries(
          Object.entries(service.env ?? {}).map(([key, value]) => [
            key,
            render(value),
          ]),
        ),
        port,
        url: service.url
          ? render(service.url)
          : service.open && port
            ? `http://localhost:${port}`
            : null,
      }),
    );
  }
  return started;
}

/** Stops the checkout's running services (all of them, or just one). */
export async function stopServices(
  repo: DevRepo,
  checkoutPath: string,
  service?: string,
) {
  const processes = devProcesses();
  const targets = processes
    .list({ projectId: repo.itemId, worktree: checkoutPath })
    .filter((info) => isActive(info) && (!service || info.name === service));
  await Promise.all(targets.map((info) => processes.stop(info.id)));
  return targets.map((info) => info.id);
}

/** Stops what is running and starts it again on the same ports. */
export async function restartServices(
  repo: DevRepo,
  checkoutPath: string,
  keepClear: number[],
  service?: string,
) {
  const processes = devProcesses();
  const running = processes
    .list({ projectId: repo.itemId, worktree: checkoutPath })
    .filter(
      (info) =>
        info.kind === "service" &&
        isActive(info) &&
        (!service || info.name === service),
    );
  if (running.length === 0)
    throw new DevError(400, "Nothing is running to restart");
  const ports = Object.fromEntries(
    running.map((info) => [info.name, info.port]),
  );
  await Promise.all(running.map((info) => processes.stop(info.id)));
  return startServices(
    repo,
    checkoutPath,
    running.map((info) => info.name),
    keepClear,
    ports,
  );
}

/** Runs setup steps one after another, stopping at the first failure. */
export function runSetup(repo: DevRepo, checkoutPath: string, all: boolean) {
  refuseOwnApp(repo);
  const processes = devProcesses();
  const dir = projectDir(repo, { path: checkoutPath });
  const setup = resolveSetup(dir, projectOverride(repo.folder));
  if (setup.length === 0)
    throw new DevError(400, "This project has no setup steps");
  const busy = processes
    .list({ projectId: repo.itemId, worktree: checkoutPath })
    .some((info) => info.kind === "setup" && isActive(info));
  if (busy)
    throw new DevError(409, "Setup is already running for this checkout");

  const missing = new Set(missingSetup(dir, setup));
  const steps =
    all || missing.size === 0
      ? setup
      : setup.filter((step) => !step.creates || missing.has(step.name));
  void (async () => {
    for (const step of steps) {
      const run = processes.start({
        projectId: repo.itemId,
        worktree: checkoutPath,
        name: step.name,
        kind: "setup",
        command: step.command,
        cwd: join(dir, step.cwd ?? ""),
      });
      const final = await processes.waitForExit(run.id);
      if (final?.status !== "exited" || final.exitCode !== 0) break;
    }
  })();
  return steps.map((step) => step.name);
}

/** Removes what setup installed (node_modules and the like), after stopping anything using it. */
export async function uninstallDependencies(
  repo: DevRepo,
  checkoutPath: string,
) {
  refuseOwnApp(repo);
  const processes = devProcesses();
  const active = processes
    .list({ projectId: repo.itemId, worktree: checkoutPath })
    .filter(isActive);
  if (active.some((info) => info.kind === "setup"))
    throw new DevError(409, "Setup is running for this checkout");
  // Running services would hold files open in node_modules or .venv.
  await Promise.all(active.map((info) => processes.stop(info.id)));
  const dir = projectDir(repo, { path: checkoutPath });
  return uninstall(dir, resolveSetup(dir, projectOverride(repo.folder)));
}
