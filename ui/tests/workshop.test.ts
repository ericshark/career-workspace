import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
let GET: typeof import("@/app/api/workshop/route").GET;
let POST: typeof import("@/app/api/workshop/route").POST;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-workshop-"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
  ({ GET, POST } = await import("@/app/api/workshop/route"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function send(body: object) {
  return POST(
    new Request("http://localhost/api/workshop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

it("rejects a concurrent stale capture without losing the winning item", async () => {
  const { hash } = await (await GET()).json();
  const results = await Promise.all(
    ["First", "Second"].map((title) =>
      send({ hash, command: { operation: "add", kind: "idea", title } }),
    ),
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const saved = await (await GET()).json();
  expect(saved.snapshot.items).toHaveLength(1);
  expect(saved.snapshot.items[0].status).toBe("Saved");
  expect(saved.snapshot.orders.idea).toEqual([saved.snapshot.items[0].id]);
});

it("rejects an invalid replacement without creating a recovery copy", async () => {
  const { hash, snapshot } = await (await GET()).json();
  const bad = {
    ...snapshot,
    orders: { ...snapshot.orders, current: [crypto.randomUUID()] },
  };
  const result = await send({
    hash,
    command: { operation: "restore", snapshot: bad },
  });
  expect(result.status).toBe(400);
  expect(await (await GET()).json()).toEqual({ hash, snapshot });
  expect(fs.existsSync(path.join(root, "ui/.workshop/recovery"))).toBe(false);
});

it("keeps the existing snapshot if recovery cannot be saved", async () => {
  const empty = await (await GET()).json();
  const saved = await (
    await send({
      hash: empty.hash,
      command: { operation: "add", kind: "project", title: "Keep me" },
    })
  ).json();
  fs.writeFileSync(path.join(root, "ui/.workshop/recovery"), "not a directory");
  const result = await send({
    hash: saved.hash,
    command: { operation: "restore", snapshot: empty.snapshot },
  });
  expect(result.status).toBe(500);
  expect((await result.json()).error.message).toMatch(/recovery copy/i);
  expect(await (await GET()).json()).toEqual(saved);
});

it("reports a failed atomic write and lets the same change be retried", async () => {
  const empty = await (await GET()).json();
  const saved = await (
    await send({
      hash: empty.hash,
      command: { operation: "add", kind: "project", title: "Original" },
    })
  ).json();
  const blocked = path.join(
    root,
    `ui/.workshop/snapshot.json.tmp-${process.pid}`,
  );
  fs.mkdirSync(blocked);
  const body = {
    hash: saved.hash,
    command: { operation: "add", kind: "idea", title: "Retry me" },
  };
  expect((await send(body)).status).toBe(500);
  expect(await (await GET()).json()).toEqual(saved);
  fs.rmdirSync(blocked);
  expect((await send(body)).status).toBe(200);
  expect(
    (await (await GET()).json()).snapshot.items.map(
      (item: { title: string }) => item.title,
    ),
  ).toEqual(["Original", "Retry me"]);
});

it("promotes an idea with draft edits in a single atomic operation", async () => {
  const { itemDraft } = await import("@/lib/workshop/model");
  const empty = await (await GET()).json();
  const added = await (
    await send({
      hash: empty.hash,
      command: { operation: "add", kind: "idea", title: "Draft idea" },
    })
  ).json();
  const idea = added.snapshot.items[0];
  const promoted = await (
    await send({
      hash: added.hash,
      command: {
        operation: "promote",
        id: idea.id,
        draft: {
          ...itemDraft(idea),
          title: "Promoted project",
          description: "Ready to build.",
        },
      },
    })
  ).json();
  expect(promoted.snapshot.items[0]).toMatchObject({
    id: idea.id,
    kind: "project",
    title: "Promoted project",
    description: "Ready to build.",
  });
  expect(promoted.snapshot.orders.idea).toEqual([]);
  expect(promoted.snapshot.orders.project).toEqual([idea.id]);
});

it("moves ideas across categories and reorders them atomically", async () => {
  let state = await (await GET()).json();
  for (const title of ["First idea", "Second idea"]) {
    state = await (
      await send({
        hash: state.hash,
        command: { operation: "add", kind: "idea", title },
      })
    ).json();
  }
  state = await (
    await send({
      hash: state.hash,
      command: { operation: "saveCategory", name: "Systems" },
    })
  ).json();
  state = await (
    await send({
      hash: state.hash,
      command: { operation: "saveCategory", name: "Agents" },
    })
  ).json();
  // New categories are inserted at the top
  expect(
    state.snapshot.categories.map((entry: { name: string }) => entry.name),
  ).toEqual(["Agents", "Systems"]);

  const [agentsId, systemsId] = state.snapshot.categories.map(
    (entry: { id: string }) => entry.id,
  ) as [string, string];
  state = await (
    await send({
      hash: state.hash,
      command: { operation: "moveCategory", id: systemsId, to: agentsId },
    })
  ).json();
  expect(
    state.snapshot.categories.map((entry: { name: string }) => entry.name),
  ).toEqual(["Systems", "Agents"]);

  const categoryId = systemsId;
  const [secondId, firstId] = state.snapshot.orders.idea as [string, string];

  const categorized = await (
    await send({
      hash: state.hash,
      command: {
        operation: "move",
        list: "idea",
        id: firstId,
        categoryId,
      },
    })
  ).json();
  expect(
    categorized.snapshot.items.find(
      (item: { id: string }) => item.id === firstId,
    ),
  ).toMatchObject({ categoryId });

  const movedAndReordered = await (
    await send({
      hash: categorized.hash,
      command: {
        operation: "move",
        list: "idea",
        id: firstId,
        to: secondId,
        categoryId: null,
      },
    })
  ).json();
  expect(movedAndReordered.snapshot.orders.idea).toEqual([firstId, secondId]);
  expect(
    movedAndReordered.snapshot.items.find(
      (item: { id: string }) => item.id === firstId,
    ),
  ).toMatchObject({ categoryId: null });
});

it("reads and restores version 1 backups with pins in Current", async () => {
  const { newDraft } = await import("@/lib/workshop/model");
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const items = ids.map((id, index) => {
    const { milestones: _milestones, ...draft } = newDraft(
      "project",
      `Project ${index}`,
    );
    // Version 1 used the old stage names and still had notes.
    return {
      ...draft,
      notes: "",
      status: "Planned",
      id,
      kind: "project",
      archived: false,
    };
  });
  const legacy = {
    version: 1,
    categories: [],
    items,
    orders: { idea: [], project: ids, focus: [...ids].reverse() },
  };
  const folder = path.join(root, "ui/.workshop");
  fs.mkdirSync(folder, { recursive: true });
  const legacyText = JSON.stringify(legacy);
  fs.writeFileSync(path.join(folder, "snapshot.json"), legacyText);
  const read = await (await GET()).json();
  expect(read.snapshot).toEqual({
    version: 4,
    categories: [],
    items: items.map(({ notes: _notes, ...item }) => ({
      ...item,
      docs: [],
      milestones: [],
      status: "Active",
      pinned: false,
    })),
    orders: { idea: [], project: ids, current: legacy.orders.focus, next: [] },
  });
  expect(fs.readFileSync(path.join(folder, "snapshot.json"), "utf8")).toBe(
    legacyText,
  );
  const result = await send({
    hash: read.hash,
    command: { operation: "restore", snapshot: legacy },
  });
  expect(result.status).toBe(200);
  expect((await result.json()).snapshot).toEqual(read.snapshot);
  expect(
    JSON.parse(fs.readFileSync(path.join(folder, "snapshot.json"), "utf8"))
      .version,
  ).toBe(4);
  const [recovery] = fs.readdirSync(path.join(folder, "recovery"));
  expect(fs.readFileSync(path.join(folder, "recovery", recovery), "utf8")).toBe(
    legacyText,
  );
});

it("moves the same record exclusively across Focus sections and preserves it through conversion and archive", async () => {
  const { itemDraft } = await import("@/lib/workshop/model");
  let state = await (await GET()).json();
  async function apply(command: object) {
    const response = await send({ hash: state.hash, command });
    expect(response.status).toBe(200);
    state = await response.json();
  }
  await apply({ operation: "add", kind: "idea", title: "Test idea" });
  const [item] = state.snapshot.items;
  const id = item.id;
  const task = {
    id: crypto.randomUUID(),
    title: "Check prototype",
    done: false,
  };
  await apply({
    operation: "edit",
    id,
    draft: { ...itemDraft(item), ideaRating: 8, checklist: [task] },
  });
  await apply({ operation: "place", id, section: "current" });
  await apply({ operation: "place", id, section: "next" });
  expect(state.snapshot.orders).toEqual({
    idea: [id],
    project: [],
    current: [],
    next: [id],
  });
  const invalid = await send({
    hash: state.hash,
    command: {
      operation: "restore",
      snapshot: {
        ...state.snapshot,
        orders: { ...state.snapshot.orders, current: [id] },
      },
    },
  });
  expect(invalid.status).toBe(400);
  await apply({ operation: "promote", id });
  expect(state.snapshot.orders).toEqual({
    idea: [],
    project: [id],
    current: [],
    next: [id],
  });
  expect(state.snapshot.items).toEqual([
    expect.objectContaining({
      id,
      ideaRating: 8,
      checklist: [task],
      status: "Active",
    }),
  ]);
  const staleHash = state.hash;
  await apply({ operation: "place", id, section: "current" });
  const stale = await send({
    hash: staleHash,
    command: { operation: "completeTask", id, taskId: task.id },
  });
  expect(stale.status).toBe(409);
  await apply({ operation: "completeTask", id, taskId: task.id });
  expect(state.snapshot.items[0].checklist).toEqual([{ ...task, done: true }]);
  await apply({ operation: "archive", id });
  expect(state.snapshot.orders.current).toEqual([]);
  await apply({ operation: "unarchive", id });
  expect(state.snapshot.orders).toEqual({
    idea: [],
    project: [id],
    current: [],
    next: [],
  });
});

it("keeps milestones and Next placement through an edit and reports progress", async () => {
  const { itemDraft, milestoneProgress } = await import("@/lib/workshop/model");
  let state = await (await GET()).json();
  async function apply(command: object) {
    const response = await send({ hash: state.hash, command });
    expect(response.status).toBe(200);
    state = await response.json();
  }
  expect(milestoneProgress([])).toEqual({
    total: 0,
    completed: 0,
    current: undefined,
  });
  await apply({ operation: "add", kind: "project", title: "Milestones" });
  const [item] = state.snapshot.items;
  const milestones = [
    { id: crypto.randomUUID(), title: "Prototype", done: true },
    { id: crypto.randomUUID(), title: "Release", done: false },
  ];
  await apply({
    operation: "edit",
    id: item.id,
    draft: { ...itemDraft(item), milestones, description: "Edited" },
  });
  await apply({ operation: "place", id: item.id, section: "next" });
  expect(state.snapshot.orders.next).toEqual([item.id]);
  expect(state.snapshot.items[0]).toMatchObject({
    id: item.id,
    description: "Edited",
    milestones,
  });
  expect(milestoneProgress(state.snapshot.items[0].milestones)).toEqual({
    total: 2,
    completed: 1,
    current: milestones[1],
  });
});

it("ticks, reopens, and adds tasks and changes stage without touching other fields", async () => {
  let state = await (await GET()).json();
  async function apply(command: object) {
    const response = await send({ hash: state.hash, command });
    expect(response.status).toBe(200);
    state = await response.json();
  }
  await apply({ operation: "add", kind: "idea", title: "Task idea" });
  const id = state.snapshot.items[0].id;
  await apply({ operation: "addTask", id, title: "  First step  " });
  await apply({ operation: "addTask", id, title: "Second step" });
  const [first, second] = state.snapshot.items[0].checklist;
  expect(first).toEqual({
    id: expect.any(String),
    title: "First step",
    done: false,
  });
  // Any task can be toggled, not just the first open one, and Focus placement is not required.
  await apply({ operation: "setTask", id, taskId: second.id, done: true });
  await apply({ operation: "setTask", id, taskId: second.id, done: false });
  await apply({ operation: "setTask", id, taskId: first.id, done: true });
  expect(
    state.snapshot.items[0].checklist.map(
      (task: { done: boolean }) => task.done,
    ),
  ).toEqual([true, false]);

  // An idea has a single stage; project stages need a project.
  const projectStage = await send({
    hash: state.hash,
    command: { operation: "setStatus", id, status: "Built" },
  });
  expect(projectStage.status).toBe(400);
  await apply({ operation: "promote", id });
  await apply({ operation: "setStatus", id, status: "Built" });
  expect(state.snapshot.items[0]).toMatchObject({
    kind: "project",
    status: "Built",
  });

  const missing = await send({
    hash: state.hash,
    command: {
      operation: "setTask",
      id,
      taskId: crypto.randomUUID(),
      done: true,
    },
  });
  expect(missing.status).toBe(400);
  const blank = await send({
    hash: state.hash,
    command: { operation: "addTask", id, title: "   " },
  });
  expect(blank.status).toBe(400);
  const staleHash = state.hash;
  await apply({ operation: "archive", id });
  const stale = await send({
    hash: staleHash,
    command: { operation: "addTask", id, title: "Late" },
  });
  expect(stale.status).toBe(409);
  const archived = await send({
    hash: state.hash,
    command: { operation: "addTask", id, title: "Late" },
  });
  expect(archived.status).toBe(400);
});

async function session() {
  let state = await (await GET()).json();
  async function apply(command: object, status = 200) {
    const response = await send({ hash: state.hash, command });
    expect(response.status).toBe(status);
    if (status === 200) state = await response.json();
    return response;
  }
  const items = () =>
    state.snapshot.items as {
      id: string;
      title: string;
      pinned: boolean;
      kind: string;
      status: string;
      checklist: {
        id: string;
        title: string;
        done: boolean;
        details?: string;
      }[];
    }[];
  return { apply, items, state: () => state };
}

it("migrates version 2 stages: ideas Saved, finished projects Built, others Active", async () => {
  const { newDraft } = await import("@/lib/workshop/model");
  const base = (kind: "idea" | "project", status: string, title: string) => {
    const { milestones, ...draft } = newDraft(kind, title);
    return {
      ...draft,
      notes: "",
      milestones,
      status,
      id: crypto.randomUUID(),
      kind,
      archived: false,
    };
  };
  const items = [
    base("idea", "Exploring", "Exploring idea"),
    base("project", "Planned", "Planned project"),
    base("project", "In Progress", "Building project"),
    base("project", "On Hold", "Paused project"),
    base("project", "Completed", "Shipped project"),
  ];
  const folder = path.join(root, "ui/.workshop");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "snapshot.json"),
    JSON.stringify({
      version: 2,
      categories: [],
      items,
      orders: {
        idea: [items[0].id],
        project: items.slice(1).map((item) => item.id),
        current: [],
        next: [],
      },
    }),
  );
  const { snapshot } = await (await GET()).json();
  expect(snapshot.version).toBe(4);
  expect(
    snapshot.items.map((item: { status: string; pinned: boolean }) => [
      item.status,
      item.pinned,
    ]),
  ).toEqual([
    ["Saved", false],
    ["Active", false],
    ["Active", false],
    ["Active", false],
    ["Built", false],
  ]);
});

it("pins an item to the top of its page and keeps Built projects unpinned", async () => {
  const { apply, items } = await session();
  await apply({ operation: "add", kind: "idea", title: "One" });
  await apply({ operation: "add", kind: "idea", title: "Two" });
  await apply({ operation: "add", kind: "idea", title: "Three" });
  const one = items().find((item) => item.title === "One")!;
  // New items go to the top, so One starts last; pinning moves it first.
  await apply({ operation: "pin", id: one.id, pinned: true });
  const state = await (await GET()).json();
  expect(state.snapshot.orders.idea[0]).toBe(one.id);
  expect(
    state.snapshot.items.find((i: { id: string }) => i.id === one.id).pinned,
  ).toBe(true);

  const project = await session();
  await project.apply({ operation: "add", kind: "project", title: "Done" });
  const id = project.items().find((item) => item.title === "Done")!.id;
  await project.apply({ operation: "pin", id, pinned: true });
  await project.apply({ operation: "place", id, section: "current" });
  await project.apply({ operation: "setStatus", id, status: "Built" });
  const built = (await (await GET()).json()).snapshot;
  expect(built.items.find((i: { id: string }) => i.id === id)).toMatchObject({
    status: "Built",
    pinned: false,
  });
  expect(built.orders.current).toEqual([]);
  await project.apply({ operation: "pin", id, pinned: true }, 400);
});

it("converts between idea and project, keeping links and dropping milestones on the way back", async () => {
  const { itemDraft } = await import("@/lib/workshop/model");
  const { apply, items } = await session();
  await apply({ operation: "add", kind: "idea", title: "Switch" });
  const id = items()[0].id;
  await apply({ operation: "setKind", id, kind: "project" });
  let state = (await (await GET()).json()).snapshot;
  expect(state.orders).toMatchObject({ idea: [], project: [id] });
  expect(state.items[0]).toMatchObject({ kind: "project", status: "Active" });
  await apply({
    operation: "edit",
    id,
    draft: {
      ...itemDraft(state.items[0]),
      githubUrl: "https://github.com/user/repo",
      milestones: [{ id: crypto.randomUUID(), title: "Ship", done: false }],
      checklist: [{ id: crypto.randomUUID(), title: "Keep me", done: false }],
    },
  });
  await apply({ operation: "setKind", id, kind: "idea" });
  state = (await (await GET()).json()).snapshot;
  expect(state.orders).toMatchObject({ idea: [id], project: [] });
  expect(state.items[0]).toMatchObject({
    kind: "idea",
    status: "Saved",
    githubUrl: "https://github.com/user/repo",
    milestones: [],
    checklist: [expect.objectContaining({ title: "Keep me" })],
  });
});

it("adds, edits, removes and reorders tasks with details", async () => {
  const { apply, items } = await session();
  await apply({ operation: "add", kind: "project", title: "Tasks" });
  const id = items()[0].id;
  await apply({
    operation: "addTasks",
    id,
    tasks: [
      { title: "  Plan  ", details: "Outline first" },
      { title: "Build" },
      { title: "Ship" },
    ],
  });
  const [a, b, c] = items()[0].checklist;
  expect(a).toMatchObject({
    title: "Plan",
    details: "Outline first",
    done: false,
  });
  expect(b).not.toHaveProperty("details");
  await apply({
    operation: "editTask",
    id,
    taskId: b.id,
    title: "Build it",
    details: "Use Next",
  });
  await apply({
    operation: "editTask",
    id,
    taskId: a.id,
    title: "Plan",
    details: "",
  });
  // Dropping Ship in the first slot takes that slot.
  await apply({ operation: "moveTask", id, taskId: c.id, to: a.id });
  expect(items()[0].checklist.map((task) => task.title)).toEqual([
    "Ship",
    "Plan",
    "Build it",
  ]);
  expect(items()[0].checklist[1]).not.toHaveProperty("details");
  expect(items()[0].checklist[2].details).toBe("Use Next");
  await apply({
    operation: "removeTask",
    id,
    taskId: items()[0].checklist[0].id,
  });
  expect(items()[0].checklist).toHaveLength(2);
  await apply(
    { operation: "removeTask", id, taskId: crypto.randomUUID() },
    400,
  );
  await apply({ operation: "addTasks", id, tasks: [] }, 400);
});

it("places a dropped item beside its neighbour in a page section or Focus", async () => {
  const { apply, items } = await session();
  for (const title of ["A", "B", "C", "D"])
    await apply({ operation: "add", kind: "project", title });
  // Order is D, C, B, A (newest first).
  const id = (title: string) =>
    items().find((item) => item.title === title)!.id;
  const order = async () =>
    (await (await GET()).json()).snapshot.orders.project.map(
      (entry: string) => items().find((item) => item.id === entry)!.title,
    );
  expect(await order()).toEqual(["D", "C", "B", "A"]);
  await apply({
    operation: "move",
    list: "project",
    id: id("D"),
    to: id("B"),
    after: true,
  });
  expect(await order()).toEqual(["C", "B", "D", "A"]);
  await apply({
    operation: "move",
    list: "project",
    id: id("A"),
    to: id("C"),
    after: false,
    section: "pinned",
  });
  expect(await order()).toEqual(["A", "C", "B", "D"]);
  expect(items().find((item) => item.title === "A")!.pinned).toBe(true);
  await apply({
    operation: "move",
    list: "project",
    id: id("C"),
    section: "built",
  });
  expect(items().find((item) => item.title === "C")!.status).toBe("Built");

  await apply({ operation: "place", id: id("A"), section: "current" });
  await apply({
    operation: "place",
    id: id("B"),
    section: "current",
    to: id("A"),
    after: false,
  });
  expect(
    (await (await GET()).json()).snapshot.orders.current.map(
      (entry: string) => items().find((item) => item.id === entry)!.title,
    ),
  ).toEqual(["B", "A"]);
  await apply({
    operation: "move",
    list: "project",
    id: id("A"),
    section: "built",
  });
  await apply(
    { operation: "move", list: "idea", id: id("A"), section: "built" },
    400,
  );
});

it("no longer accepts import commands or import previews", async () => {
  const state = await (await GET()).json();
  const imported = await send({
    hash: state.hash,
    command: { operation: "import", entries: [] },
  });
  expect(imported.status).toBe(400);
  const { POST: preview } = await import("@/app/api/workshop/preview/route");
  const response = await preview(
    new Request("http://localhost/api/workshop/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "ideas", text: "1. Idea" }),
    }),
  );
  expect(response.status).toBe(400);
});

it("derives deployed from the Live URL and sorts projects into sections", async () => {
  const { projectSection } = await import("@/lib/workshop/model");
  let state = await (await GET()).json();
  const added = await (
    await send({
      hash: state.hash,
      command: { operation: "add", kind: "project", title: "Site" },
    })
  ).json();
  const item = added.snapshot.items[0];
  expect(projectSection(item)).toBe("local");
  const {
    id: _id,
    kind: _kind,
    archived: _a,
    pinned: _p,
    docs: _docs,
    ...draft
  } = item;
  // The stale `deployed: false` is ignored; the Live URL decides.
  state = await (
    await send({
      hash: added.hash,
      command: {
        operation: "edit",
        id: item.id,
        draft: { ...draft, liveUrl: "https://example.com", deployed: false },
      },
    })
  ).json();
  expect(state.snapshot.items[0].deployed).toBe(true);
  expect(projectSection(state.snapshot.items[0])).toBe("deployed");
  state = await (
    await send({
      hash: state.hash,
      command: { operation: "pin", id: item.id, pinned: true },
    })
  ).json();
  expect(projectSection(state.snapshot.items[0])).toBe("pinned");
});

it("sorts idea categories alphabetically, by best rating, or by average", async () => {
  const { sortIdeaGroups } = await import("@/lib/workshop/model");
  type Item = import("@/lib/workshop/model").Item;
  const idea = (title: string, rating: number | null) =>
    ({ title, ideaRating: rating }) as unknown as Item;
  const groups = [
    { name: "Uncategorized", categoryId: null, items: [idea("u", 4)] },
    { name: "Web", categoryId: "w", items: [idea("a", 9), idea("b", 1)] },
    { name: "Art", categoryId: "a", items: [idea("c", 7), idea("d", 6)] },
    { name: "Empty", categoryId: "e", items: [idea("e", null)] },
  ];
  const names = (sort: "alphabetical" | "highest" | "average") =>
    sortIdeaGroups(groups, sort).map((group) => group.name);
  // Uncategorized always leads, whatever the sort.
  expect(names("alphabetical")).toEqual([
    "Uncategorized",
    "Art",
    "Empty",
    "Web",
  ]);
  expect(names("highest")).toEqual(["Uncategorized", "Web", "Art", "Empty"]);
  expect(names("average")).toEqual(["Uncategorized", "Art", "Web", "Empty"]);
  const web = sortIdeaGroups(groups, "highest").find((g) => g.name === "Web")!;
  expect(web.items.map((entry) => entry.title)).toEqual(["a", "b"]);
});

it("splits tasks into open and done, and editing a task drops legacy fields", async () => {
  const { taskGroups } = await import("@/lib/workshop/model");
  let state = await (await GET()).json();
  state = await (
    await send({
      hash: state.hash,
      command: { operation: "add", kind: "project", title: "Plan" },
    })
  ).json();
  const id = state.snapshot.items[0].id;
  state = await (
    await send({
      hash: state.hash,
      command: {
        operation: "addTasks",
        id,
        tasks: [{ title: "Step one" }, { title: "Step two" }],
      },
    })
  ).json();
  type Task = { id: string; title: string; done: boolean };
  const tasks: Task[] = state.snapshot.items[0].checklist;
  expect(tasks[0]).toEqual({ id: tasks[0].id, title: "Step one", done: false });
  expect(taskGroups(tasks).open.map((task) => task.title)).toEqual([
    "Step one",
    "Step two",
  ]);

  // Completing a task leaves the rest to renumber; reopening restores it.
  state = await (
    await send({
      hash: state.hash,
      command: { operation: "setTask", id, taskId: tasks[0].id, done: true },
    })
  ).json();
  const grouped = taskGroups<Task>(state.snapshot.items[0].checklist);
  expect(grouped.open.map((task) => task.title)).toEqual(["Step two"]);
  expect(grouped.done).toHaveLength(1);

  // Task priority and numbering are no longer accepted.
  const rejected = await send({
    hash: state.hash,
    command: {
      operation: "addTask",
      id,
      title: "Flagged",
      priority: "High",
    },
  });
  expect(rejected.status).toBe(400);
});

it("no longer accepts a priority and drops one found in older snapshots", async () => {
  let state = await (await GET()).json();
  state = await (
    await send({
      hash: state.hash,
      command: { operation: "add", kind: "project", title: "Prio" },
    })
  ).json();
  const id = state.snapshot.items[0].id;
  expect(state.snapshot.items[0]).not.toHaveProperty("priority");
  const rejected = await send({
    hash: state.hash,
    command: { operation: "setPriority", id, priority: "Low" },
  });
  expect(rejected.status).toBe(400);

  // A snapshot or backup written while priority existed still reads.
  const { snapshotSchema } = await import("@/lib/workshop/model");
  const legacy = {
    ...state.snapshot,
    items: state.snapshot.items.map((item: object) => ({
      ...item,
      priority: "High",
    })),
  };
  const parsed = snapshotSchema.parse(legacy);
  expect(parsed.items[0]).not.toHaveProperty("priority");
});

it("defaults Workshop AI tasks to the fast model at low effort and honors saved choices", async () => {
  const { workshopSelection } = await import("@/lib/workshop/modelSelection");
  const { defaultPreferences } = await import("@/lib/preferences");
  const defaults = defaultPreferences();
  expect(workshopSelection(defaults)).toMatchObject({
    provider: "openai",
    model: "gpt-6-luna",
    effort: "low",
  });
  expect(
    workshopSelection({
      ...defaults,
      provider: "claude",
      workshop: {
        provider: "claude",
        models: { claude: "claude-sonnet-5-5", openai: "gpt-6-luna" },
      },
      operationEfforts: { "workshop-tasks:claude-sonnet-5-5": "high" },
    }),
  ).toMatchObject({
    provider: "claude",
    model: "claude-sonnet-5-5",
    effort: "high",
  });
  // A model that does not belong to the provider falls back to its fast model.
  expect(
    workshopSelection({
      ...defaults,
      provider: "claude",
      workshop: {
        provider: "claude",
        models: { claude: "gpt-6-luna", openai: "gpt-6-luna" },
      },
    }).model,
  ).toBe("claude-haiku-5-5");
});

it("sorts by title but keeps each category together, inline", async () => {
  const { sortByCategoryThenTitle } = await import("@/lib/workshop/model");
  const sorted = sortByCategoryThenTitle([
    { title: "C", categoryId: "x" },
    { title: "B", categoryId: "y" },
    { title: "A", categoryId: "x" },
    { title: "D", categoryId: null },
  ]);
  // A leads category x, so C follows it even though B sorts before C.
  expect(sorted.map((item) => item.title)).toEqual(["A", "C", "B", "D"]);
});

it("migrates version 3 notes away, keeping imported ratings", async () => {
  const { newDraft } = await import("@/lib/workshop/model");
  const idea = (title: string, notes: string, ideaRating?: number | null) => ({
    ...newDraft("idea", title),
    ...(ideaRating !== undefined ? { ideaRating } : {}),
    notes,
    id: crypto.randomUUID(),
    kind: "idea",
    archived: false,
    pinned: false,
  });
  const items = [
    idea("Imported", "Original rating: 7.5/10"),
    idea("Rated already", "Original rating: 2/10", 9),
    idea("Cleared", "Original rating: 4/10", null),
    idea("Free text", "Some thoughts"),
  ];
  const folder = path.join(root, "ui/.workshop");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "snapshot.json"),
    JSON.stringify({
      version: 3,
      categories: [],
      items,
      orders: {
        idea: items.map((item) => item.id),
        project: [],
        current: [],
        next: [],
      },
    }),
  );
  const { snapshot } = await (await GET()).json();
  expect(snapshot.version).toBe(4);
  for (const item of snapshot.items) {
    expect(item).not.toHaveProperty("notes");
    expect(item.docs).toEqual([]);
  }
  expect(
    snapshot.items.map(
      (item: { ideaRating?: number | null }) => item.ideaRating,
    ),
  ).toEqual([7.5, 9, null, undefined]);
});

it("adds, edits, and removes named docs without touching the draft", async () => {
  let state = await (await GET()).json();
  async function apply(command: object, status = 200) {
    const response = await send({ hash: state.hash, command });
    expect(response.status).toBe(status);
    if (status === 200) state = await response.json();
  }
  await apply({ operation: "add", kind: "idea", title: "Spec'd idea" });
  const id = state.snapshot.items[0].id;
  // Bodies keep their exact text, including leading spaces and newlines.
  const body = "  # Spec\n\n- one\n- two\n";
  await apply({ operation: "addDoc", id, title: " Spec ", body });
  expect(state.snapshot.items[0].docs).toEqual([
    { id: expect.any(String), title: "Spec", body },
  ]);
  const docId = state.snapshot.items[0].docs[0].id;
  await apply({
    operation: "editDoc",
    id,
    docId,
    title: "Spec v2",
    body: "Updated",
  });
  expect(state.snapshot.items[0].docs[0]).toEqual({
    id: docId,
    title: "Spec v2",
    body: "Updated",
  });
  // Docs survive conversion to a project and back.
  await apply({ operation: "setKind", id, kind: "project" });
  await apply({ operation: "setKind", id, kind: "idea" });
  expect(state.snapshot.items[0].docs).toHaveLength(1);
  // Empty, oversized, and unknown docs are rejected.
  await apply({ operation: "addDoc", id, title: "Blank", body: "  \n" }, 400);
  await apply(
    { operation: "addDoc", id, title: "Huge", body: "x".repeat(200_001) },
    400,
  );
  await apply({ operation: "addDoc", id, title: "", body: "Text" }, 400);
  await apply({ operation: "removeDoc", id, docId: crypto.randomUUID() }, 404);
  // The editor draft has no docs field, so an edit cannot carry one.
  const { newDraft } = await import("@/lib/workshop/model");
  await apply(
    {
      operation: "edit",
      id,
      draft: { ...newDraft("idea", "Spec'd idea"), docs: [] },
    },
    400,
  );
  await apply({ operation: "removeDoc", id, docId });
  expect(state.snapshot.items[0].docs).toEqual([]);
});

it("caps docs per item", async () => {
  const { maxDocs } = await import("@/lib/workshop/model");
  let state = await (await GET()).json();
  async function apply(command: object) {
    const response = await send({ hash: state.hash, command });
    if (response.status === 200) state = await response.json();
    return response.status;
  }
  await apply({ operation: "add", kind: "project", title: "Docs" });
  const id = state.snapshot.items[0].id;
  for (let index = 0; index < maxDocs; index++)
    expect(
      await apply({
        operation: "addDoc",
        id,
        title: `Doc ${index}`,
        body: "x",
      }),
    ).toBe(200);
  expect(
    await apply({ operation: "addDoc", id, title: "One more", body: "x" }),
  ).toBe(400);
});

it("deletes an active item directly and clears it from every order", async () => {
  let state = await (await GET()).json();
  async function apply(command: object) {
    const response = await send({ hash: state.hash, command });
    expect(response.status).toBe(200);
    state = await response.json();
  }
  await apply({ operation: "add", kind: "project", title: "Doomed" });
  await apply({ operation: "add", kind: "project", title: "Survivor" });
  const doomed = state.snapshot.items.find(
    (item: { title: string }) => item.title === "Doomed",
  ).id;
  await apply({ operation: "place", id: doomed, section: "current" });
  await apply({ operation: "delete", id: doomed });
  expect(
    state.snapshot.items.map((item: { title: string }) => item.title),
  ).toEqual(["Survivor"]);
  expect(state.snapshot.orders.project).toHaveLength(1);
  expect(state.snapshot.orders.current).toEqual([]);
  // A deleted item is gone for good.
  const again = await send({
    hash: state.hash,
    command: { operation: "delete", id: doomed },
  });
  expect(again.status).toBe(404);
});
