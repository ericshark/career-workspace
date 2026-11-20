import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const career = fs.mkdtempSync(path.join(os.tmpdir(), "dev-actions-career-"));
process.env.CAREER_ROOT = career;
fs.mkdirSync(path.join(career, "ui/.workshop"), { recursive: true });

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

let repo: string;
let ids: { app: string; idea: string; self: string };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(
  method: "GET" | "POST",
  id: string,
  action: string,
  body?: object,
  query = "",
) {
  const route = await import("@/app/api/workshop/dev/[id]/[action]/route");
  const request = new Request(
    `http://127.0.0.1:3999/api/workshop/dev/${id}/${action}${query}`,
    method === "GET"
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        },
  );
  const context = { params: Promise.resolve({ id, action }) };
  return method === "GET"
    ? route.GET(request, context)
    : route.POST(request, context);
}
const json = async (response: Response) => response.json();

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (done(value)) return value;
    await sleep(100);
  }
  throw new Error("Timed out waiting.");
}

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "dev-actions-repo-"));
  git(repo, "init", "-qb", "main");
  fs.writeFileSync(
    path.join(repo, "server.js"),
    `require("http").createServer((q, r) => r.end("hello")).listen(Number(process.argv[2]), "127.0.0.1");`,
  );
  fs.writeFileSync(path.join(repo, "a.txt"), "1");
  // What install creates is ignored, as node_modules is in a real project.
  fs.writeFileSync(path.join(repo, ".gitignore"), "installed.txt\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "first");
  git(repo, "branch", "feature");
  // The repo is the Career workspace itself for the "this app" check.
  git(career, "init", "-qb", "main");

  const { writeWorkshop, readWorkshop } = await import("@/lib/workshop/store");
  const { itemDraft } = await import("@/lib/workshop/model");
  for (const [kind, title] of [
    ["project", "App"],
    ["idea", "Idea"],
    ["project", "Self"],
  ] as const)
    await writeWorkshop(readWorkshop().hash, {
      operation: "add",
      kind,
      title,
    });
  const link = async (title: string, folder: string) => {
    const state = readWorkshop();
    const item = state.snapshot.items.find((entry) => entry.title === title)!;
    await writeWorkshop(state.hash, {
      operation: "edit",
      id: item.id,
      draft: { ...itemDraft(item), localFolder: folder },
    });
  };
  await link("App", repo);
  await link("Self", path.join(career, "ui"));
  const { snapshot } = readWorkshop();
  const idOf = (title: string) =>
    snapshot.items.find((entry) => entry.title === title)!.id;
  ids = { app: idOf("App"), idea: idOf("Idea"), self: idOf("Self") };
  fs.writeFileSync(
    path.join(career, "ui/.workshop/dev.json"),
    JSON.stringify({
      projects: {
        [fs.realpathSync(repo)]: {
          services: [
            {
              name: "web",
              command: "node server.js {port}",
              defaultPort: 47100,
              open: true,
            },
          ],
          setup: [
            {
              name: "deps",
              command: "touch installed.txt",
              creates: "installed.txt",
            },
          ],
        },
      },
    }),
  );
});

afterAll(async () => {
  const { devProcesses } = await import("@/lib/dev/processes");
  await devProcesses().stopAll();
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(career, { recursive: true, force: true });
});

describe("Dev actions", () => {
  it("installs, runs, serves, streams logs and stops", async () => {
    let detail = await json(await call("GET", ids.app, "detail"));
    expect(detail.needsInstall).toBe(true);
    expect(
      detail.services.map((entry: { name: string }) => entry.name),
    ).toEqual(["web"]);

    await call("POST", ids.app, "install", {});
    await until(
      async () => json(await call("GET", ids.app, "detail")),
      (value) => value.checkouts[0].missing.length === 0,
    );
    expect(fs.existsSync(path.join(repo, "installed.txt"))).toBe(true);

    const started = await json(await call("POST", ids.app, "run", {}));
    const run = started.runs[0];
    // Never the default port itself, and never the port this server answers on.
    expect(run.port).toBeGreaterThan(47100);
    expect(run.url).toBe(`http://localhost:${run.port}`);
    detail = await until(
      async () => json(await call("GET", ids.app, "detail")),
      (value) =>
        value.checkouts[0].runs.some(
          (entry: { kind: string; status: string }) =>
            entry.kind === "service" && entry.status === "running",
        ),
    );
    expect((await fetch(run.url)).status).toBe(200);
    expect((await call("GET", ids.app, "summary").then(json)).running).toEqual([
      { name: "web", url: run.url },
    ]);

    // The log stream starts with the backlog.
    const logs = await call(
      "GET",
      ids.app,
      "logs",
      undefined,
      `?run=${run.id}`,
    );
    const reader = logs.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: backlog");
    expect(first).toContain("node server.js");
    await reader.cancel();

    await call("POST", ids.app, "stop", {});
    await until(
      async () => json(await call("GET", ids.app, "detail")),
      (value) =>
        value.checkouts[0].runs.every(
          (entry: { kind: string; status: string }) =>
            entry.kind !== "service" || entry.status === "exited",
        ),
    );
    await expect(fetch(run.url)).rejects.toThrow();
  }, 30_000);

  it("switches branches, but not while there are uncommitted changes", async () => {
    await call("POST", ids.app, "checkout", { branch: "feature" });
    expect(git(repo, "branch", "--show-current")).toBe("feature");
    fs.writeFileSync(path.join(repo, "dirty.txt"), "x");
    const refused = await call("POST", ids.app, "checkout", { branch: "main" });
    expect(refused.status).toBe(409);
    expect(git(repo, "branch", "--show-current")).toBe("feature");
    fs.rmSync(path.join(repo, "dirty.txt"));
    await call("POST", ids.app, "checkout", { branch: "main" });
    expect(git(repo, "branch", "--show-current")).toBe("main");
  });

  it("refuses what the guard does not allow", async () => {
    // An idea without a linked folder has nothing to run; unknown checkouts and other paths are not accepted.
    expect((await call("POST", ids.idea, "run", {})).status).toBe(404);
    expect(
      (await call("POST", ids.app, "run", { worktree: "/etc" })).status,
    ).toBe(400);
    expect(
      (await call("POST", ids.app, "checkout", { worktree: "/tmp" })).status,
    ).toBe(400);
    // A body must pick a branch or a commit, and only known fields.
    expect((await call("POST", ids.app, "checkout", {})).status).toBe(400);
    expect(
      (await call("POST", ids.app, "run", { command: "touch /tmp/pwned" }))
        .status,
    ).toBe(400);
    // An unknown action and a malformed id.
    expect((await call("POST", ids.app, "nope", {})).status).toBe(404);
    expect((await call("GET", "not-a-uuid", "summary")).status).toBe(400);
    // The Career UI cannot run itself.
    const self = await call("POST", ids.self, "run", {});
    expect(self.status).toBe(409);
    expect((await call("GET", ids.self, "summary").then(json)).isThisApp).toBe(
      true,
    );
    // Logs of a run belong to its own project.
    const other = await call("GET", ids.idea, "logs", undefined, "?run=abc");
    expect(other.status).toBeGreaterThanOrEqual(400);
  });
});
