import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CAREER_ROOT } from "@/lib/paths";
import { NotFoundError } from "@/lib/applications";
import { readWorkshop } from "@/lib/workshop/store";
import { DevError } from "./errors";
import { git, listWorktrees } from "./git";
import type { WorktreeRef } from "./types";

/**
 * The guard in front of every Dev action. The browser only ever names a Workshop
 * item (and optionally one of its checkouts); the folder, and so every path a git
 * or run command touches, comes from here, never from the request.
 */
export interface DevRepo {
  itemId: string;
  title: string;
  /** The saved local folder, symlinks resolved. */
  folder: string;
  /** The git work tree the folder belongs to. */
  root: string;
  /** The folder inside `root` ("" when they are the same). */
  subpath: string;
  /** The folder belongs to this Career workspace, i.e. the running app itself. */
  isThisApp: boolean;
}

export function expandHome(folder: string) {
  return folder === "~" || folder.startsWith("~/")
    ? path.join(os.homedir(), folder.slice(1))
    : folder;
}

function realDirectory(folder: string) {
  try {
    const real = fs.realpathSync(folder);
    return fs.statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/** Resolves a Workshop item to its linked git repository, or says why it cannot. */
export async function resolveRepo(itemId: string): Promise<DevRepo> {
  const item = readWorkshop().snapshot.items.find(
    (entry) => entry.id === itemId,
  );
  if (!item) throw new NotFoundError("Item no longer exists.");
  if (!item.localFolder)
    throw new DevError(404, "This item has no local folder linked.");
  const expanded = expandHome(item.localFolder);
  if (!path.isAbsolute(expanded))
    throw new DevError(400, "The local folder must be an absolute path.");
  const folder = realDirectory(expanded);
  if (!folder) throw new DevError(404, `Folder not found: ${item.localFolder}`);
  const top = (await git(folder, ["rev-parse", "--show-toplevel"]))?.trim();
  const root = top ? realDirectory(top) : null;
  if (!root)
    throw new DevError(400, "The local folder is not a Git repository.");
  return {
    itemId,
    title: item.title,
    folder,
    root,
    subpath: path.relative(root, folder),
    isThisApp: root === realDirectory(CAREER_ROOT),
  };
}

/** The directory of the project inside one checkout (a worktree or the main one). */
export const projectDir = (repo: DevRepo, checkout: { path: string }) =>
  path.join(checkout.path, repo.subpath);

/**
 * Picks the checkout an action applies to. A requested path must be one git
 * itself lists for this repository; nothing else is accepted.
 */
export async function resolveCheckout(
  repo: DevRepo,
  requested?: string | null,
) {
  const worktrees = await listWorktrees(repo.root);
  const checkout = requested
    ? worktrees.find((entry) => entry.path === requested)
    : worktrees[0];
  if (!checkout) throw new DevError(400, "Unknown checkout.");
  return { worktrees, checkout, dir: projectDir(repo, checkout) };
}
