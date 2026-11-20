import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;
const ui = path.join(import.meta.dirname, "..");

// Runs the real CLI against a disposable Career root, never the live snapshot.
function cli(...args: string[]) {
  const result = spawnSync(
    path.join(ui, "node_modules/.bin/tsx"),
    [
      "--tsconfig",
      path.join(ui, "tsconfig.json"),
      path.join(ui, "scripts/workshop.ts"),
      ...args,
    ],
    { env: { ...process.env, CAREER_ROOT: root }, encoding: "utf8" },
  );
  let json: any;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { code: result.status, json, stderr: result.stderr };
}
const snapshot = () =>
  JSON.parse(
    fs.readFileSync(path.join(root, "ui/.workshop/snapshot.json"), "utf8"),
  );

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-cli-"));
  fs.mkdirSync(path.join(root, "ui/.workshop"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it(
  "adds an idea with category, rating, tasks and a spec doc, unpinned at the top",
  { timeout: 60000 },
  () => {
    fs.writeFileSync(path.join(root, "spec.md"), "# Spec\nPurpose");
    const added = cli(
      "add",
      "--kind",
      "idea",
      "--title",
      "Weather Window",
      "--description",
      "Sky matching live weather",
      "--category",
      "Interactive",
      "--create-category",
      "--rating",
      "7",
      "--task",
      "Pick a weather API",
      "--task",
      "Sketch the sky",
      "--doc-title",
      "Spec",
      "--doc-file",
      path.join(root, "spec.md"),
    );
    expect(added.code).toBe(0);
    expect(added.json).toMatchObject({
      added: true,
      kind: "idea",
      status: "Saved",
      pinned: false,
      category: "Interactive",
      docs: ["Spec"],
      tasks: 2,
    });
    const data = snapshot();
    expect(data.items[0]).toMatchObject({
      ideaRating: 7,
      description: "Sky matching live weather",
    });
    expect(data.orders.idea[0]).toBe(data.items[0].id);
    expect(data.orders.current).toEqual([]);
  },
);

it(
  "refuses an unknown category unless it may be created",
  { timeout: 60000 },
  () => {
    const result = cli(
      "add",
      "--kind",
      "idea",
      "--title",
      "X",
      "--category",
      "Nope",
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No category");
    // Nothing was written, so no snapshot file exists.
    expect(fs.existsSync(path.join(root, "ui/.workshop/snapshot.json"))).toBe(
      false,
    );
  },
);

it(
  "flags likely duplicates, including archived ones, until forced",
  { timeout: 90000 },
  () => {
    cli("add", "--kind", "idea", "--title", "Advanced RAG System");
    cli("archive", "Advanced RAG System");
    const blocked = cli(
      "add",
      "--kind",
      "idea",
      "--title",
      "advanced rag system",
    );
    expect(blocked.code).toBe(2);
    expect(blocked.json.matches[0]).toMatchObject({
      match: "exact",
      archived: true,
    });
    expect(snapshot().items).toHaveLength(1);
    expect(
      cli("add", "--kind", "idea", "--title", "advanced rag system", "--force")
        .code,
    ).toBe(0);
    expect(snapshot().items).toHaveLength(2);
  },
);

it(
  "adds a project with repo links and rejects them on ideas",
  { timeout: 60000 },
  () => {
    const project = cli(
      "add",
      "--kind",
      "project",
      "--title",
      "Issue Pilot",
      "--local",
      "~/GitHub/issue-pilot",
    );
    expect(project.code).toBe(0);
    expect(snapshot().items[0]).toMatchObject({
      kind: "project",
      status: "Active",
      localFolder: "~/GitHub/issue-pilot",
    });
    expect(
      cli("add", "--kind", "project", "--title", "Z", "--priority", "High")
        .code,
    ).toBe(1);
    expect(
      cli("add", "--kind", "idea", "--title", "Y", "--local", "/x").code,
    ).toBe(1);
  },
);

it(
  "promotes an idea keeping docs and tasks, and updates docs without overwriting silently",
  { timeout: 120000 },
  () => {
    fs.writeFileSync(path.join(root, "a.md"), "one");
    fs.writeFileSync(path.join(root, "b.md"), "two");
    cli(
      "add",
      "--kind",
      "idea",
      "--title",
      "Pulse Watch",
      "--task",
      "Research uptime checks",
    );
    expect(
      cli(
        "doc",
        "Pulse Watch",
        "--title",
        "Spec",
        "--file",
        path.join(root, "a.md"),
      ).code,
    ).toBe(0);
    const clash = cli(
      "doc",
      "Pulse Watch",
      "--title",
      "spec",
      "--file",
      path.join(root, "b.md"),
    );
    expect(clash.code).toBe(2);
    expect(
      cli(
        "doc",
        "Pulse Watch",
        "--title",
        "Spec",
        "--file",
        path.join(root, "b.md"),
        "--append",
      ).code,
    ).toBe(0);
    expect(cli("promote", "Pulse Watch").code).toBe(0);
    const item = snapshot().items[0];
    expect(item).toMatchObject({
      kind: "project",
      status: "Active",
      pinned: false,
    });
    expect(item.docs[0].body).toBe("one\n\ntwo");
    expect(item.checklist).toHaveLength(1);
    expect(snapshot().orders.project[0]).toBe(item.id);
  },
);

it("pins only on request", { timeout: 60000 }, () => {
  cli("add", "--kind", "idea", "--title", "Color Palette Lab");
  expect(snapshot().items[0].pinned).toBe(false);
  expect(cli("pin", "Color Palette Lab").code).toBe(0);
  expect(snapshot().items[0].pinned).toBe(true);
});
