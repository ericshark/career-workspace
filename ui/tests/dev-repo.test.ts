import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
const career = fs.mkdtempSync(path.join(os.tmpdir(), "dev-career-"));
process.env.CAREER_ROOT = career;

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function seed(
  items: { title: string; kind: "project" | "idea"; folder: string }[],
) {
  const { writeWorkshop } = await import("@/lib/workshop/store");
  const { readWorkshop } = await import("@/lib/workshop/store");
  for (const { title, kind } of items) {
    await writeWorkshop(readWorkshop().hash, { operation: "add", kind, title });
  }
  const { itemDraft } = await import("@/lib/workshop/model");
  for (const { title, folder } of items) {
    const state = readWorkshop();
    const item = state.snapshot.items.find((entry) => entry.title === title)!;
    if (item.kind === "idea") continue;
    await writeWorkshop(state.hash, {
      operation: "edit",
      id: item.id,
      draft: { ...itemDraft(item), localFolder: folder },
    });
  }
  const { snapshot } = readWorkshop();
  return (title: string) =>
    snapshot.items.find((entry) => entry.title === title)!.id;
}

beforeEach(() => {
  fs.rmSync(path.join(career, "ui/.workshop"), {
    recursive: true,
    force: true,
  });
  fs.mkdirSync(path.join(career, "ui/.workshop"), { recursive: true });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-repo-"));
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "t@example.com",
  });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("the Dev repo guard", () => {
  it("resolves a project's folder, including from inside a repo", async () => {
    const repo = path.join(root, "app");
    sh(root, "init", "-qb", "main", repo);
    fs.mkdirSync(path.join(repo, "web"));
    fs.writeFileSync(path.join(repo, "web/a.txt"), "x");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "one");
    const idOf = await seed([
      { title: "Top", kind: "project", folder: repo },
      { title: "Sub", kind: "project", folder: path.join(repo, "web") },
    ]);
    const { resolveRepo, projectDir, resolveCheckout } =
      await import("@/lib/dev/repo");
    const top = await resolveRepo(idOf("Top"));
    expect(top).toMatchObject({
      root: fs.realpathSync(repo),
      subpath: "",
      isThisApp: false,
    });
    const sub = await resolveRepo(idOf("Sub"));
    expect(sub.subpath).toBe("web");
    const { checkout } = await resolveCheckout(sub);
    expect(projectDir(sub, checkout)).toBe(
      path.join(fs.realpathSync(repo), "web"),
    );
  });

  it("refuses ideas without a folder, missing folders, non-repositories and unknown checkouts", async () => {
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    const repo = path.join(root, "app");
    sh(root, "init", "-qb", "main", repo);
    const idOf = await seed([
      { title: "An idea", kind: "idea", folder: "" },
      { title: "Gone", kind: "project", folder: path.join(root, "nope") },
      { title: "Plain", kind: "project", folder: plain },
      { title: "Unlinked", kind: "project", folder: "" },
      { title: "Real", kind: "project", folder: repo },
    ]);
    const { resolveRepo, resolveCheckout } = await import("@/lib/dev/repo");
    await expect(resolveRepo(idOf("An idea"))).rejects.toMatchObject({
      status: 404,
    });
    await expect(resolveRepo(idOf("Gone"))).rejects.toMatchObject({
      status: 404,
    });
    await expect(resolveRepo(idOf("Plain"))).rejects.toMatchObject({
      status: 400,
    });
    await expect(resolveRepo(idOf("Unlinked"))).rejects.toMatchObject({
      status: 404,
    });
    await expect(resolveRepo(crypto.randomUUID())).rejects.toThrow(
      "Item no longer exists.",
    );
    const real = await resolveRepo(idOf("Real"));
    // Only a checkout git itself lists is accepted; arbitrary paths are not.
    await expect(resolveCheckout(real, "/etc")).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      resolveCheckout(real, path.join(root, "app")),
    ).resolves.toBeTruthy();
  });

  it("builds a summary: branches, worktrees, uncommitted files and totals", async () => {
    const repo = path.join(root, "app");
    sh(root, "init", "-qb", "main", repo);
    fs.writeFileSync(path.join(repo, "a.txt"), "1");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "one");
    sh(repo, "branch", "feature");
    const other = path.join(root, "wt");
    sh(repo, "worktree", "add", "-q", other, "feature");
    fs.writeFileSync(path.join(repo, "dirty.txt"), "x");
    const idOf = await seed([
      { title: "App", kind: "project", folder: repo },
      { title: "Missing", kind: "project", folder: path.join(root, "nope") },
    ]);
    const { buildSummary } = await import("@/lib/dev/status");
    const summary = await buildSummary(idOf("App"));
    expect(summary).toMatchObject({
      available: true,
      branch: "main",
      worktrees: 2,
      localBranches: 2,
      remoteBranches: 0,
      uncommitted: 1,
      totalCommits: 1,
      needsInstall: false,
    });
    expect(summary.attention.map((entry) => entry.kind)).toEqual([
      "uncommitted",
    ]);
    // A folder that cannot be read is a state, not an error.
    expect(await buildSummary(idOf("Missing"))).toMatchObject({
      available: false,
      problem: expect.stringContaining("Folder not found"),
    });
  });
});
