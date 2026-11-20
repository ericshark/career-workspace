import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import { DevError } from "@/lib/dev/errors";
import {
  checkout,
  commitAll,
  fetchRepo,
  getGraph,
  listBranches,
  listCommits,
  pull,
  push,
  workingChanges,
} from "@/lib/dev/git";
import { openInEditor } from "@/lib/dev/open";
import { devProcesses } from "@/lib/dev/processes";
import { resolveCheckout, resolveRepo } from "@/lib/dev/repo";
import {
  restartServices,
  runSetup,
  startServices,
  stopServices,
  uninstallDependencies,
} from "@/lib/dev/run";
import { buildDetail, buildSummary } from "@/lib/dev/status";
import type { LogLine } from "@/lib/dev/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; action: string }> };

const idSchema = z.uuid();
const checkoutBody = z.strictObject({ worktree: z.string().optional() });
const serviceBody = checkoutBody.extend({ service: z.string().optional() });
const commitBody = checkoutBody.extend({
  message: z.string().trim().min(1, "Write a commit message.").max(5000),
});
const installBody = checkoutBody.extend({ all: z.boolean().optional() });
const switchBody = checkoutBody
  .extend({
    branch: z.string().min(1).max(250).optional(),
    commit: z.string().min(1).max(64).optional(),
  })
  .refine(
    (body) => Number(Boolean(body.branch)) + Number(Boolean(body.commit)) === 1,
    {
      message: "Choose a branch or a commit.",
    },
  );

/** Ports that dev servers must never take: the one this server answers on. */
function ownPorts(request: Request) {
  return [Number(new URL(request.url).port), Number(process.env.PORT)].filter(
    (port) => Number.isInteger(port) && port > 0,
  );
}

/** Streams one run's output as server-sent events: the backlog, then batches of new lines. */
function streamLogs(request: Request, itemId: string, runId: string) {
  const processes = devProcesses();
  const info = processes.get(runId);
  const backlog = processes.logs(runId);
  // A run of another project is as good as unknown.
  if (!info || !backlog || info.projectId !== itemId)
    throw new DevError(404, "Unknown run.");
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          cleanup();
        }
      };
      // Output can arrive in bursts of thousands of lines, so it goes out in batches.
      let pending: LogLine[] = [];
      let flushTimer: NodeJS.Timeout | undefined;
      const onLog = (id: string, lines: LogLine[]) => {
        if (id !== runId) return;
        pending.push(...lines);
        flushTimer ??= setTimeout(() => {
          flushTimer = undefined;
          const batch = pending;
          pending = [];
          send("lines", batch);
        }, 50);
      };
      const ping = setInterval(() => send("ping", {}), 25_000);
      processes.on("log", onLog);
      cleanup = () => {
        processes.off("log", onLog);
        clearInterval(ping);
        clearTimeout(flushTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", cleanup);
      send("backlog", backlog);
    },
    cancel: () => cleanup(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

/** Reads for one Workshop project's linked repository. The id is the only input that picks a folder. */
export async function GET(request: Request, context: Context) {
  try {
    const { id, action } = await context.params;
    const itemId = idSchema.parse(id);
    const query = new URL(request.url).searchParams;
    const worktree = query.get("worktree");
    switch (action) {
      case "summary":
        return NextResponse.json(await buildSummary(itemId));
      case "detail":
        return NextResponse.json(await buildDetail(itemId, worktree));
      case "branches": {
        const repo = await resolveRepo(itemId);
        const { worktrees, checkout } = await resolveCheckout(repo, worktree);
        return NextResponse.json(await listBranches(checkout.path, worktrees));
      }
      case "commits": {
        const repo = await resolveRepo(itemId);
        const { checkout } = await resolveCheckout(repo, worktree);
        const skip = Number(query.get("skip") ?? 0);
        return NextResponse.json({
          commits: await listCommits(
            checkout.path,
            query.get("ref") ?? "HEAD",
            Number.isFinite(skip) ? skip : 0,
          ),
        });
      }
      case "changes": {
        const repo = await resolveRepo(itemId);
        const { checkout } = await resolveCheckout(repo, worktree);
        return NextResponse.json(await workingChanges(checkout.path));
      }
      case "logs":
        return streamLogs(request, itemId, query.get("run") ?? "");
      case "graph": {
        const repo = await resolveRepo(itemId);
        const { worktrees, checkout } = await resolveCheckout(repo, worktree);
        return NextResponse.json(await getGraph(checkout.path, worktrees));
      }
    }
    throw new ApiError("NOT_FOUND", "Unknown Dev action.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Actions on one Workshop project's linked repository. */
export async function POST(request: Request, context: Context) {
  try {
    const { id, action } = await context.params;
    const itemId = idSchema.parse(id);
    switch (action) {
      case "open": {
        const { worktree } = await parseBody(request, checkoutBody);
        const repo = await resolveRepo(itemId);
        const { dir } = await resolveCheckout(repo, worktree);
        openInEditor(dir);
        return NextResponse.json({ ok: true });
      }
      case "run": {
        const { worktree, service } = await parseBody(request, serviceBody);
        const repo = await resolveRepo(itemId);
        const { checkout: entry } = await resolveCheckout(repo, worktree);
        return NextResponse.json({
          runs: await startServices(
            repo,
            entry.path,
            service,
            ownPorts(request),
          ),
        });
      }
      case "stop": {
        const { worktree, service } = await parseBody(request, serviceBody);
        const repo = await resolveRepo(itemId);
        const { checkout: entry } = await resolveCheckout(repo, worktree);
        return NextResponse.json({
          stopped: await stopServices(repo, entry.path, service),
        });
      }
      case "restart": {
        const { worktree, service } = await parseBody(request, serviceBody);
        const repo = await resolveRepo(itemId);
        const { checkout: entry } = await resolveCheckout(repo, worktree);
        return NextResponse.json({
          runs: await restartServices(
            repo,
            entry.path,
            ownPorts(request),
            service,
          ),
        });
      }
      case "install": {
        const { worktree, all } = await parseBody(request, installBody);
        const repo = await resolveRepo(itemId);
        const { checkout: entry } = await resolveCheckout(repo, worktree);
        return NextResponse.json({
          steps: runSetup(repo, entry.path, Boolean(all)),
        });
      }
      case "uninstall": {
        const { worktree } = await parseBody(request, checkoutBody);
        const repo = await resolveRepo(itemId);
        const { checkout: entry } = await resolveCheckout(repo, worktree);
        return NextResponse.json({
          removed: await uninstallDependencies(repo, entry.path),
        });
      }
      case "checkout": {
        const { worktree, branch, commit } = await parseBody(
          request,
          switchBody,
        );
        const repo = await resolveRepo(itemId);
        const { worktrees, checkout: entry } = await resolveCheckout(
          repo,
          worktree,
        );
        await checkout(
          entry.path,
          worktrees,
          branch ? { branch } : { commit: commit! },
        );
        return NextResponse.json({ ok: true });
      }
      case "fetch": {
        await parseBody(request, checkoutBody);
        const repo = await resolveRepo(itemId);
        await fetchRepo(repo.root);
        return NextResponse.json({ ok: true });
      }
      case "commit": {
        // the workspace owner presses Commit all; this is the only write besides push and pull.
        const { worktree, message } = await parseBody(request, commitBody);
        const repo = await resolveRepo(itemId);
        const { checkout: entry } = await resolveCheckout(repo, worktree);
        await commitAll(entry.path, message);
        return NextResponse.json({ ok: true });
      }
      case "pull":
      case "push": {
        const { worktree } = await parseBody(request, checkoutBody);
        const repo = await resolveRepo(itemId);
        const { checkout: entry } = await resolveCheckout(repo, worktree);
        await (action === "pull" ? pull : push)(entry.path);
        return NextResponse.json({ ok: true });
      }
    }
    throw new ApiError("NOT_FOUND", "Unknown Dev action.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
