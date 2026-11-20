import { existsSync } from "node:fs";
import { NotFoundError } from "@/lib/applications";
import { projectOverride } from "./config";
import { DevError } from "./errors";
import {
  attentionItems,
  countCommits,
  getGitInfo,
  hasRemote,
  listBranches,
} from "./git";
import { canOpenInEditor } from "./open";
import { devProcesses } from "./processes";
import { projectDir, resolveCheckout, resolveRepo, type DevRepo } from "./repo";
import {
  installedPaths,
  missingSetup,
  resolveServices,
  resolveSetup,
} from "./services";
import type {
  DevDetail,
  DevSummary,
  RunInfo,
  WorktreeInfo,
  WorktreeRef,
} from "./types";

/** Runs of this item's services and setup steps, optionally for one checkout. */
export function runsFor(repo: DevRepo, checkout?: string): RunInfo[] {
  return devProcesses().list({ projectId: repo.itemId, worktree: checkout });
}

const empty = (problem: string): DevSummary => ({
  available: false,
  problem,
  path: null,
  isThisApp: false,
  branch: null,
  worktrees: 0,
  localBranches: 0,
  remoteBranches: 0,
  uncommitted: 0,
  attention: [],
  defaultBranch: null,
  needsInstall: false,
  running: [],
  totalCommits: 0,
});

async function checkoutInfo(
  repo: DevRepo,
  checkout: WorktreeRef,
): Promise<WorktreeInfo> {
  const dir = projectDir(repo, checkout);
  const setup = resolveSetup(dir, projectOverride(repo.folder));
  return {
    ...checkout,
    git: await getGitInfo(checkout.path),
    missing: existsSync(dir) ? missingSetup(dir, setup) : [],
    installed: existsSync(dir) ? installedPaths(dir, setup) : [],
    runs: runsFor(repo, checkout.path),
  };
}

/** The quick facts: what the card hover and the Dev tab header show. */
export async function buildSummary(itemId: string): Promise<DevSummary> {
  let repo: DevRepo;
  try {
    repo = await resolveRepo(itemId);
  } catch (error) {
    // A missing item is the caller's problem; a bad folder is shown as a state.
    if (error instanceof DevError) return empty(error.message);
    throw error;
  }
  const { worktrees, checkout } = await resolveCheckout(repo);
  const checkouts = await Promise.all(
    worktrees.map((entry) => checkoutInfo(repo, entry)),
  );
  const [branches, attention, totalCommits] = await Promise.all([
    listBranches(checkout.path, worktrees),
    attentionItems(
      repo.root,
      worktrees,
      checkouts.map((entry) => entry.git),
    ),
    countCommits(repo.root),
  ]);
  const main = branches.branches.find(
    (branch) => !branch.remote && branch.name === branches.defaultBranch,
  );
  return {
    available: true,
    problem: null,
    path: repo.folder,
    isThisApp: repo.isThisApp,
    branch: checkouts[0].git.branch,
    worktrees: worktrees.length,
    localBranches: branches.branches.filter((branch) => !branch.remote).length,
    remoteBranches: branches.branches.filter((branch) => branch.remote).length,
    uncommitted: checkouts.reduce((sum, entry) => sum + entry.git.dirty, 0),
    attention,
    defaultBranch:
      main?.compare && branches.defaultBranch
        ? {
            name: branches.defaultBranch,
            ahead: main.compare.ahead,
            behind: main.compare.behind,
            against: main.compare.against,
          }
        : null,
    needsInstall: checkouts.some((entry) => entry.missing.length > 0),
    running: runsFor(repo)
      .filter((run) => run.status === "running" || run.status === "starting")
      .map((run) => ({ name: run.name, url: run.url })),
    totalCommits,
  };
}

/** Everything the Dev tab shows for one selected checkout. */
export async function buildDetail(
  itemId: string,
  requested?: string | null,
): Promise<DevDetail> {
  const repo = await resolveRepo(itemId);
  const { worktrees, dir } = await resolveCheckout(repo, requested);
  const [summary, checkouts] = await Promise.all([
    buildSummary(itemId),
    Promise.all(worktrees.map((entry) => checkoutInfo(repo, entry))),
  ]);
  if (!summary.available) throw new NotFoundError(summary.problem ?? "");
  const override = projectOverride(repo.folder);
  return {
    ...summary,
    checkouts,
    services: existsSync(dir) ? resolveServices(dir, override) : [],
    setup: existsSync(dir) ? resolveSetup(dir, override) : [],
    canRun: !repo.isThisApp,
    canOpenInEditor,
    hasRemote: await hasRemote(repo.root),
  };
}
