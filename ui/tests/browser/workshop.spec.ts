import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tab = (page: Page, name: string) =>
  page.getByRole("radio", { name: new RegExp(`^${name}\\b`) });
const row = (page: Page, title: string) =>
  page.getByRole("listitem", { name: title, exact: true });
/** Working on cards keep tasks hidden until the right-hand progress button is pressed. */
const showTasks = (card: Locator, title: string) =>
  card
    .getByRole("button", {
      name: new RegExp(`^(Show|Add) tasks for ${title}$`),
    })
    .click();
const titles = (page: Page, list: string) =>
  page.getByRole("list", { name: list }).getByRole("heading", { level: 3 });

test.beforeEach(() => {
  const root = process.env.PLAYWRIGHT_CAREER_ROOT!;
  fs.rmSync(path.join(root, "ui/.workshop"), { recursive: true, force: true });
});

type Command = Record<string, unknown>;
type Seeded = {
  hash: string;
  snapshot: {
    items: { id: string; title: string }[];
    categories: { id: string; name: string }[];
  };
};

/** Applies commands through the API, chaining the hash, and returns the final state. */
async function seed(request: APIRequestContext, ...commands: Command[]) {
  let state = (await (await request.get("/api/workshop")).json()) as Seeded;
  for (const command of commands) {
    const response = await request.post("/api/workshop", {
      data: { hash: state.hash, command },
    });
    expect(response.ok()).toBe(true);
    state = await response.json();
  }
  return state;
}
const idOf = (state: Seeded, title: string) =>
  state.snapshot.items.find((item) => item.title === title)!.id;

async function itemMenu(page: Page, title: string, action: string) {
  await page
    .getByRole("button", { name: `More actions for ${title}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
/** Opens an item's popup from its row, then switches it to the editor with the pencil. */
async function editItem(page: Page, title: string) {
  await row(page, title).getByText(title).first().click();
  await page
    .getByRole("dialog", { name: title, exact: true })
    .getByRole("button", { name: `Edit ${title}` })
    .click();
  return page.getByRole("dialog", { name: "Editing" });
}
async function workshopMenu(page: Page, action: string) {
  await page.getByRole("button", { name: "Workshop menu" }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

/** Lifts `from` with the mouse and returns a function that moves/drops it. */
async function lift(page: Page, from: Locator) {
  const start = (await from.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12, { steps: 4 });
  return {
    async over(target: Locator, edge: "top" | "bottom" | "middle" = "middle") {
      const box = (await target.boundingBox())!;
      const targetY =
        edge === "top"
          ? box.y + 3
          : edge === "bottom"
            ? box.y + box.height - 3
            : box.y + box.height / 2;
      await page.mouse.move(box.x + box.width / 2, targetY, { steps: 20 });
    },
    // The list shows the new order at once, but drags are ignored until the
    // save finishes; the status line reports when it has.
    async drop(waitForSave = true) {
      await page.mouse.up();
      // Not role=status alone: dnd-kit has its own live region.
      if (waitForSave)
        await expect(page.locator('p[role="status"]')).toContainText(/\S/);
    },
  };
}

test("pin an idea, send it to Focus, and convert another to a project", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(
    request,
    { operation: "add", kind: "idea", title: "Alpha" },
    { operation: "add", kind: "idea", title: "Beta" },
  );
  await page.goto("/workshop");
  await tab(page, "Ideas").click();
  // Nothing is pinned, so there is no Pinned section at all.
  await expect(page.getByRole("region", { name: "Pinned ideas" })).toHaveCount(
    0,
  );

  // First click pins; the idea moves to the Pinned section.
  await page.getByRole("button", { name: "Pin Alpha" }).click();
  await expect(titles(page, "Pinned ideas")).toHaveText(["Alpha"]);
  await expect(titles(page, "Uncategorized ideas")).toHaveText(["Beta"]);

  // Pinned again: Unpin or send straight to Focus.
  await page.getByRole("button", { name: "Pinned: Alpha" }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Unpin",
    "Move to Working on",
    "Move to Up next",
  ]);
  await page.getByRole("menuitem", { name: "Move to Working on" }).click();
  await expect(
    row(page, "Alpha").getByText("Working on", { exact: true }),
  ).toBeVisible();
  await tab(page, "Focus").click();
  await expect(titles(page, "Working on items")).toHaveText(["Alpha"]);

  await tab(page, "Ideas").click();
  await page.getByRole("button", { name: "Pinned: Alpha" }).click();
  await page.getByRole("menuitem", { name: "Unpin" }).click();
  await expect(page.getByRole("region", { name: "Pinned ideas" })).toHaveCount(
    0,
  );

  // Conversion remains available in the detail popup.
  await expect(
    row(page, "Beta").getByText("Idea", { exact: true }),
  ).toHaveCount(0);
  await row(page, "Beta").getByText("Beta", { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Type: Idea. Change" })
    .click();
  await page.getByRole("menuitem", { name: "Project", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Beta")).toHaveCount(0);
  await tab(page, "Projects").click();
  await expect(titles(page, "Local project list")).toHaveText(["Beta"]);
  expect(errors).toEqual([]);
});

test("clicking anywhere on a card opens its details", async ({
  page,
  request,
}) => {
  const state = await seed(request, {
    operation: "add",
    kind: "idea",
    title: "Roomy idea",
  });
  await seed(
    request,
    {
      operation: "edit",
      id: idOf(state, "Roomy idea"),
      draft: {
        title: "Roomy idea",
        description: "Click the description, not the title.",
        categoryId: null,
        links: [],
        checklist: [],
        status: "Saved",
        githubUrl: "",
        localFolder: "",
        liveUrl: "",
        deployed: false,
        milestones: [],
      },
    },
    { operation: "place", id: idOf(state, "Roomy idea"), section: "next" },
  );
  await page.goto("/workshop");
  await row(page, "Roomy idea")
    .getByText(/Click the description/)
    .click();
  await expect(
    page.getByRole("dialog", { name: "Roomy idea", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // Controls inside the card do not open it.
  await page
    .getByRole("button", { name: "More actions for Roomy idea" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("drag projects between Pinned, Local and Built and reorder inside a section", async ({
  page,
  request,
}) => {
  await seed(
    request,
    ...["A", "B", "C"].map((title) => ({
      operation: "add",
      kind: "project",
      title,
    })),
  );
  await page.goto("/workshop");
  await tab(page, "Projects").click();
  // Newest first.
  await expect(titles(page, "Local project list")).toHaveText(["C", "B", "A"]);

  // Drag A above C: the others make room and the order persists.
  let drag = await lift(page, row(page, "A"));
  await drag.over(row(page, "C"), "top");
  await drag.drop();
  await expect(titles(page, "Local project list")).toHaveText(["A", "C", "B"]);
  await page.reload();
  await tab(page, "Projects").click();
  await expect(titles(page, "Local project list")).toHaveText(["A", "C", "B"]);

  // Drag B onto the Pinned section.
  drag = await lift(page, row(page, "B"));
  await drag.over(page.getByText("Drop here to pin it."));
  await drag.drop();
  await expect(titles(page, "Pinned project list")).toHaveText(["B"]);
  await expect(page.getByRole("button", { name: "Pinned: B" })).toBeVisible();

  // Drag C to Built; like the other sections it can be folded away.
  drag = await lift(page, row(page, "C"));
  await drag.over(page.getByText("Drop here to mark it built."));
  await drag.drop();
  await expect(
    page.getByRole("button", { name: "Collapse Built" }),
  ).toBeVisible();
  await expect(titles(page, "Built project list")).toHaveText(["C"]);
  // Built projects cannot be pinned.
  await expect(page.getByRole("button", { name: "Pin C" })).toHaveCount(0);
  await itemMenu(page, "C", "Reopen project");
  await expect(titles(page, "Local project list")).toContainText(["C"]);
});

test("keyboard users reorder by focusing the row", async ({
  page,
  request,
}) => {
  await seed(
    request,
    ...["One", "Two", "Three"].map((title) => ({
      operation: "add",
      kind: "project",
      title,
    })),
  );
  await page.goto("/workshop");
  await tab(page, "Projects").click();
  await expect(titles(page, "Local project list")).toHaveText([
    "Three",
    "Two",
    "One",
  ]);
  await row(page, "One").focus();
  // dnd-kit measures the other cards after the lift; keys sent before that are ignored.
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await expect(titles(page, "Local project list")).toHaveText([
    "One",
    "Three",
    "Two",
  ]);
});

test("Working on cards: inline task input, AI preview, done tasks and Mark built", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Dashboard",
  });
  await seed(request, {
    operation: "place",
    id: idOf(state, "Dashboard"),
    section: "current",
  });
  await page.goto("/workshop");
  const card = row(page, "Dashboard");
  const input = card.getByLabel("Add a task", { exact: true });

  // Tasks are hidden until the right-hand progress button opens them.
  await expect(
    card.getByRole("button", { name: "Add task", exact: true }),
  ).toHaveCount(0);
  await showTasks(card, "Dashboard");

  // Empty cards open the add box immediately; Enter adds a task.
  await expect(input).toBeFocused();
  await input.fill("Write the schema");
  await input.press("Enter");
  await expect(card.getByText("Write the schema")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );

  // Edit inline, adding details.
  await card
    .getByRole("button", { name: "Edit task Write the schema" })
    .click();
  await card
    .getByLabel("Task title", { exact: true })
    .fill("Write the data schema");
  await card.getByLabel("Task details").fill("Use Zod");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByText("Write the data schema")).toBeVisible();
  await expect(card.getByText("Use Zod")).toBeVisible();

  // The mode button names the mode (Tidy tasks by default) and switches to
  // Expand; Send runs it and previews inline. Untick one, add the rest.
  await input.fill("Ship the dashboard");
  await expect(
    card.getByRole("button", { name: /^AI mode: Tidy tasks/ }),
  ).toBeVisible();
  await card.getByRole("button", { name: /^AI mode: Tidy tasks/ }).click();
  await expect(
    card.getByRole("button", { name: /^AI mode: Expand/ }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Send to AI" }).click();
  await expect(card.getByLabel("Suggested task 1")).toHaveValue(
    "Outline the goal",
  );
  await card.getByLabel("Keep Test and polish").uncheck();
  await card.getByRole("button", { name: "Add 2 tasks" }).click();
  await expect(card.getByText("Build the first version")).toBeVisible();
  await expect(card.getByText("Test and polish")).toHaveCount(0);
  await expect(card.getByRole("progressbar")).toHaveAttribute(
    "aria-valuemax",
    "3",
  );

  // Completing takes two clicks (the first only asks to confirm); finished
  // tasks move to a collapsed Completed list and there is no banner.
  for (const name of ["Write the data schema", "Outline the goal"]) {
    const check = card.getByRole("button", { name: `Complete ${name}` });
    await check.click();
    // The circle becomes a green check and a gray X; nothing is timed.
    await expect(
      card.getByRole("button", { name: `Cancel complete ${name}` }),
    ).toBeVisible();
    await expect(card.getByText(name)).toBeVisible();
    await card
      .getByRole("button", { name: `Confirm complete ${name}` })
      .click();
  }
  await expect(card.getByText("Write the data schema")).toHaveCount(0);
  await card.getByRole("button", { name: /^View completed \(2\)/ }).click();
  await expect(
    card.getByRole("list", { name: /Done tasks/ }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(card.getByText("All tasks done")).toHaveCount(0);

  // The ⋯ menu has no Open details; it marks the project built.
  await card
    .getByRole("button", { name: "More actions for Dashboard" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Open details" }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Mark Built" }).click();
  await expect(row(page, "Dashboard")).toHaveCount(0);
  await tab(page, "Projects").click();
  await expect(titles(page, "Built project list")).toHaveText(["Dashboard"]);
  expect(errors).toEqual([]);
});

test("editor: Type dropdown converts, tasks add inline, and an idea cannot be built", async ({
  page,
  request,
}) => {
  await seed(request, { operation: "add", kind: "idea", title: "Convertible" });
  await page.goto("/workshop");
  await tab(page, "Ideas").click();
  const editor = await editItem(page, "Convertible");
  await expect(editor.getByLabel("Status")).toHaveCount(0);
  // Notes and priority are gone.
  await expect(editor.getByRole("textbox", { name: "Notes" })).toHaveCount(0);
  await expect(editor.getByLabel("Priority", { exact: true })).toHaveCount(0);
  const input = editor.getByLabel("Add a task", { exact: true });
  await editor.getByRole("button", { name: "Add task", exact: true }).click();
  await input.fill("First");
  await input.press("Enter");
  // Enter in the task input must not submit the editor.
  await expect(editor).toBeVisible();
  await input.fill("Second");
  await input.press("Enter");
  await expect(
    editor.getByRole("list", { name: /Open tasks/ }).getByRole("listitem"),
  ).toHaveCount(2);
  // The old "Make it a project" button is gone; Type does the job.
  await expect(
    editor.getByRole("button", { name: /Make it an? (project|idea)/ }),
  ).toHaveCount(0);
  await editor.getByLabel("Type").click();
  await page.getByRole("option", { name: "Project" }).click();
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toHaveCount(0);
  // Done returns to the view popup.
  await expect(
    page.getByRole("dialog", { name: "Convertible", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await tab(page, "Projects").click();
  await expect(titles(page, "Local project list")).toHaveText(["Convertible"]);
  const project = await editItem(page, "Convertible");
  await expect(project.getByLabel("Status")).toBeVisible();
  await expect(project.getByText("First")).toBeVisible();
});

test("Add project: new category inline, Links make it Deployed, and the links icon opens them", async ({
  page,
  request,
}) => {
  await seed(request, {
    operation: "add",
    kind: "project",
    title: "Local one",
  });
  await page.goto("/workshop");
  await tab(page, "Projects").click();
  // No creation bar or category filter any more.
  await expect(page.getByLabel("Filter by category")).toHaveCount(0);
  await expect(page.getByLabel("New project title")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Deployed projects" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill("Live site");
  await dialog.getByLabel("Category").click();
  await page.getByRole("option", { name: "+ New category…" }).click();
  await dialog.getByLabel("New category name").fill("Web");
  await dialog.getByRole("button", { name: "Add category" }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Category" }),
  ).toContainText("Web");
  await dialog.getByLabel("Live URL").fill("https://example.com");
  await expect(dialog.getByText("Live (deployed)")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add project" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(titles(page, "Deployed project list")).toHaveText(["Live site"]);
  await expect(titles(page, "Local project list")).toHaveText(["Local one"]);
  await expect(row(page, "Live site").getByText("Web")).toBeVisible();
  // Only items with links show the icon.
  await expect(
    page.getByRole("button", { name: /^Links for Local one/ }),
  ).toHaveCount(0);
  await expect(
    row(page, "Live site").getByRole("link", {
      name: "Live site",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://example.com");
});

test("tasks are always numbered, renumber on completion, and carry no priority flags", async ({
  page,
  request,
}) => {
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Roadmap",
  });
  const id = idOf(state, "Roadmap");
  await seed(
    request,
    {
      operation: "addTasks",
      id,
      tasks: [{ title: "Design" }, { title: "Build" }, { title: "Buy domain" }],
    },
    { operation: "place", id, section: "current" },
  );
  await page.goto("/workshop");
  const card = row(page, "Roadmap");
  await expect(card.getByRole("progressbar")).toHaveAttribute(
    "aria-valuemax",
    "3",
  );
  await showTasks(card, "Roadmap");
  await expect(card.getByRole("heading", { name: "Steps" })).toHaveCount(0);
  await expect(card.getByRole("img", { name: /priority/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Bullet to-do/ })).toHaveCount(
    0,
  );
  const open = card.getByRole("list", { name: "Open tasks for Roadmap" });
  await expect(open.getByText(/^\d\.$/)).toHaveText(["1.", "2.", "3."]);

  // Completing task 1 closes the numbering up: Build becomes 1.
  const check = card.getByRole("button", { name: "Complete Design" });
  await check.click();
  await card.getByRole("button", { name: "Confirm complete Design" }).click();
  await expect(open.getByText(/^\d\.$/)).toHaveText(["1.", "2."]);
  await expect(open.getByText("Build")).toBeVisible();

  // Reopening from Completed puts it back in place.
  await card.getByRole("button", { name: /^View completed/ }).click();
  await card.getByRole("button", { name: "Reopen Design" }).click();
  await expect(open.getByText(/^\d\.$/)).toHaveText(["1.", "2.", "3."]);
});

test("Working on: left side opens the editor, right side expands tasks", async ({
  page,
  request,
}) => {
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Slim card",
  });
  const id = idOf(state, "Slim card");
  await seed(
    request,
    { operation: "addTasks", id, tasks: [{ title: "First" }] },
    { operation: "place", id, section: "current" },
  );
  await page.goto("/workshop");
  const card = row(page, "Slim card");
  // Tabs show how many items each section holds.
  await expect(tab(page, "Focus")).toContainText("1");
  await expect(tab(page, "Projects")).toContainText("1");
  await expect(tab(page, "Ideas")).toContainText("0");
  const toggle = card.getByRole("button", { name: "Show tasks for Slim card" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(card.getByText("First")).toHaveCount(0);

  await toggle.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByText("First")).toBeVisible();
  await card.getByRole("button", { name: "Hide tasks for Slim card" }).click();
  await expect(card.getByText("First")).toHaveCount(0);

  await card.getByRole("heading", { name: "Slim card" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("links menu copies a cd command; project sort and category grouping", async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let state = await seed(
    request,
    { operation: "saveCategory", name: "Web" },
    { operation: "add", kind: "project", title: "Zed app" },
    { operation: "add", kind: "project", title: "Alpha tool" },
    { operation: "add", kind: "project", title: "Mid thing" },
  );
  const web = state.snapshot.categories[0].id;
  const draft = (title: string, extra: object) => ({
    title,
    description: "",
    categoryId: null,
    links: [],
    checklist: [],
    status: "Active",
    githubUrl: "",
    localFolder: "",
    liveUrl: "",
    deployed: false,
    milestones: [],
    ...extra,
  });
  state = await seed(
    request,
    {
      operation: "edit",
      id: idOf(state, "Zed app"),
      draft: draft("Zed app", { categoryId: web }),
    },
    {
      operation: "edit",
      id: idOf(state, "Alpha tool"),
      draft: draft("Alpha tool", { localFolder: "/home/me/code/alpha" }),
    },
  );
  await page.goto("/workshop");
  await tab(page, "Projects").click();
  // The folder is a Path chip on the card and in the popup's Links line.
  await expect(
    row(page, "Alpha tool").getByRole("button", { name: "Path", exact: true }),
  ).toBeVisible();
  await row(page, "Alpha tool").getByText("Alpha tool").click();
  const alphaDialog = page.getByRole("dialog", {
    name: "Alpha tool",
    exact: true,
  });
  await alphaDialog.getByRole("button", { name: "Path", exact: true }).click();
  await expect(alphaDialog.getByText("Copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "/home/me/code/alpha",
  );
  await expect(alphaDialog.getByRole("heading", { name: "Links" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");

  // Alphabetical sorts inside the section.
  await page.getByLabel("Sort projects").click();
  await page
    .getByRole("menuitemradio", { name: "Alphabetical", exact: true })
    .click();
  await expect(titles(page, "Local project list")).toHaveText([
    "Alpha tool",
    "Mid thing",
    "Zed app",
  ]);

  // "Alphabetical by category" keeps each category together, inline: Zed app
  // and Alpha tool (different categories) stay put, ordered by first title.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByLabel("Sort projects").click();
  await page
    .getByRole("menuitemradio", { name: "Alphabetical by category" })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(titles(page, "Local project list")).toHaveText([
    "Alpha tool",
    "Mid thing",
    "Zed app",
  ]);
  await page.getByLabel("Sort projects").click();
  await page
    .getByRole("menuitemradio", { name: "Alphabetical", exact: true })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Grouping adds a category subheading under Local: Uncategorized, then Web.
  await page.getByLabel("Sort projects").click();
  await page
    .getByRole("menuitemcheckbox", { name: "Group by category" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Uncategorized", level: 2 }),
  ).toBeVisible();
  await expect(titles(page, "Local Uncategorized projects")).toHaveText([
    "Alpha tool",
    "Mid thing",
  ]);
  await expect(titles(page, "Local Web projects")).toHaveText(["Zed app"]);
});

test("project sections fold away like idea categories", async ({
  page,
  request,
}) => {
  await seed(request, { operation: "add", kind: "project", title: "Folded" });
  await page.goto("/workshop");
  await tab(page, "Projects").click();
  await expect(titles(page, "Local project list")).toHaveText(["Folded"]);
  await page.getByRole("button", { name: "Collapse Local" }).click();
  await expect(row(page, "Folded")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand Local" }).click();
  await expect(row(page, "Folded")).toBeVisible();
});

test("Focus shows read-only chips and the editor has no priority", async ({
  page,
  request,
}) => {
  const state = await seed(
    request,
    { operation: "add", kind: "project", title: "Ship it" },
    { operation: "add", kind: "idea", title: "Maybe later" },
  );
  await seed(
    request,
    { operation: "place", id: idOf(state, "Ship it"), section: "current" },
    { operation: "place", id: idOf(state, "Maybe later"), section: "next" },
  );
  await page.goto("/workshop");
  // Static chips (not buttons) on Focus.
  await expect(
    row(page, "Ship it").getByText("Project", { exact: true }),
  ).toBeVisible();
  await expect(
    row(page, "Maybe later").getByText("Idea", { exact: true }),
  ).toBeVisible();
  await expect(row(page, "Ship it").getByText(/priority/i)).toHaveCount(0);

  const editor = await editItem(page, "Ship it");
  await expect(editor.getByLabel("Priority", { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel("Category")).toBeVisible();
});

test("docs: add from the editor, open from Focus, raw, copy, edit and delete", async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Specced",
  });
  await seed(request, {
    operation: "place",
    id: idOf(state, "Specced"),
    section: "current",
  });
  await page.goto("/workshop");
  const editor = await editItem(page, "Specced");
  await editor.getByRole("button", { name: "Add doc" }).click();
  await editor.getByLabel("Document title").fill("Spec");
  const body = "# Plan\n\n- **First** step\n- [guide](../guide/x.md)\n";
  await editor.getByLabel("Document text").fill(body);
  await editor.getByRole("button", { name: "Add doc" }).click();
  const list = editor.getByRole("list", { name: "Documents" });
  await expect(
    list.getByRole("button", { name: "Spec", exact: true }),
  ).toBeVisible();
  // Finishing afterwards does not conflict with the doc's own save.
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The doc sits in the row's links and opens rendered.
  await row(page, "Specced")
    .getByRole("button", { name: "Open doc Spec" })
    .click();
  const viewer = page.getByRole("dialog", { name: "Spec" });
  await expect(viewer.getByRole("heading", { name: "Plan" })).toBeVisible();
  // Pasted relative links stay plain text.
  await expect(viewer.getByRole("link", { name: "guide" })).toHaveCount(0);
  await viewer.getByRole("button", { name: "Raw" }).click();
  await expect(viewer.getByText("# Plan")).toBeVisible();
  await viewer.getByRole("button", { name: "Copy" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body);

  await viewer.getByRole("button", { name: "Edit" }).click();
  await viewer.getByLabel("Document title").fill("Spec v2");
  await viewer.getByLabel("Document text").fill("Short now");
  await viewer.getByRole("button", { name: "Save doc" }).click();
  const renamed = page.getByRole("dialog", { name: "Spec v2" });
  await expect(renamed.getByText("Short now")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await row(page, "Specced").getByText("Specced").click();
  const view = page.getByRole("dialog", { name: "Specced", exact: true });
  page.once("dialog", (dialog) => void dialog.accept());
  await view.getByRole("button", { name: "Delete Spec v2" }).click();
  await expect(view.getByRole("list", { name: "Documents" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("AI task model settings choose provider, model and effort and persist", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/preferences")).json();
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Settings host",
  });
  await seed(request, {
    operation: "place",
    id: idOf(state, "Settings host"),
    section: "current",
  });
  await page.goto("/workshop");
  const card = row(page, "Settings host");
  // Model settings live in global Settings, not in the task box.
  await showTasks(card, "Settings host");
  await expect(card.getByLabel("Add a task", { exact: true })).toBeFocused();
  await expect(
    card.getByRole("button", { name: "Model settings for AI tasks" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "AI models" }).click();
  await dialog
    .getByRole("radiogroup", { name: "Provider", exact: true })
    .getByRole("radio", { name: "Claude", exact: true })
    .click();
  await dialog
    .getByRole("radiogroup", { name: "Workshop tasks model" })
    .getByRole("radio", { name: "Sonnet 5.5" })
    .click();
  await dialog.getByLabel("Workshop tasks effort").selectOption("high");
  await expect
    .poll(async () => {
      const prefs = await (await request.get("/api/preferences")).json();
      return [
        prefs.provider,
        prefs.workshop?.models.claude,
        prefs.operationEfforts["workshop-tasks:claude-sonnet-5-5"],
      ];
    })
    .toEqual(["claude", "claude-sonnet-5-5", "high"]);
  // The suggestion button still works (fixture mode) after changing settings.
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "Add task", exact: true }).click();
  await card.getByLabel("Add a task", { exact: true }).fill("Ship the thing");
  await card.getByRole("button", { name: "Send to AI" }).click();
  await expect(card.getByLabel("Suggested task 1")).toBeVisible();
  // Leave shared preferences as found.
  await request.put("/api/preferences", { data: before });
});

test("ideas sort by rating or name inside each category and drag between categories", async ({
  page,
  request,
}) => {
  let state = await seed(
    request,
    { operation: "saveCategory", name: "Web" },
    ...["Strong idea", "Unrated idea", "Another idea"].map((title) => ({
      operation: "add",
      kind: "idea",
      title,
    })),
  );
  const draft = (title: string, rating: number | null) => ({
    title,
    description: "",
    categoryId: null,
    ideaRating: rating,
    links: [],
    checklist: [],
    status: "Saved",
    githubUrl: "",
    localFolder: "",
    liveUrl: "",
    deployed: false,
    milestones: [],
  });
  state = await seed(
    request,
    {
      operation: "edit",
      id: idOf(state, "Strong idea"),
      draft: draft("Strong idea", 9.4),
    },
    {
      operation: "edit",
      id: idOf(state, "Another idea"),
      draft: draft("Another idea", 7.2),
    },
  );
  await page.goto("/workshop");
  await tab(page, "Ideas").click();
  const uncategorized = titles(page, "Uncategorized ideas");
  await expect(uncategorized).toHaveText([
    "Strong idea",
    "Another idea",
    "Unrated idea",
  ]);
  await expect(row(page, "Strong idea").getByText("9.4/10")).toBeVisible();

  await page.getByLabel("Sort ideas").click();
  await page
    .getByRole("menuitemradio", { name: "Alphabetical", exact: true })
    .click();
  await expect(uncategorized).toHaveText([
    "Another idea",
    "Strong idea",
    "Unrated idea",
  ]);
  await page.getByLabel("Sort ideas").click();
  await page.getByRole("menuitemradio", { name: "Highest rated" }).click();

  // Drag into the Web category (an empty category appears while dragging).
  const toWeb = await lift(page, row(page, "Unrated idea"));
  await toWeb.over(page.getByText("Drop here to move it to Web."));
  await toWeb.drop();
  await expect(titles(page, "Web ideas")).toHaveText(["Unrated idea"]);
});

test("stale category deletion refreshes its impact before a retry", async ({
  page,
  request,
}) => {
  await page.goto("/workshop");
  await workshopMenu(page, "Categories");
  const modal = page.getByRole("dialog");
  await modal.getByRole("textbox", { name: "New category" }).fill("Dev Tools");
  await modal.getByRole("button", { name: "Add", exact: true }).click();
  await modal.getByRole("button", { name: "Delete Dev Tools" }).click();
  await expect(modal.getByText(/move 0 items/)).toBeVisible();

  const state = await (await request.get("/api/workshop")).json();
  const category = state.snapshot.categories[0].id;
  const added = await seed(request, {
    operation: "add",
    kind: "idea",
    title: "Concurrent idea",
  });
  await seed(request, {
    operation: "move",
    list: "idea",
    id: idOf(added, "Concurrent idea"),
    categoryId: category,
  });
  await modal
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText("Workshop changed");
  await modal.getByRole("button", { name: "Reload latest" }).click();
  await expect(modal.getByRole("alert")).toHaveCount(0);
  await modal.getByRole("button", { name: "Delete Dev Tools" }).click();
  await expect(modal.getByText(/move 1 item/)).toContainText(
    "(1 active, 0 archived)",
  );
  await modal
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(
    modal.getByRole("button", { name: "Delete Dev Tools" }),
  ).toHaveCount(0);
  const { snapshot } = await (await request.get("/api/workshop")).json();
  expect(snapshot.items[0]).toMatchObject({
    title: "Concurrent idea",
    categoryId: null,
  });
});

test("categories reorder by dragging in the Categories dialog", async ({
  page,
  request,
}) => {
  await seed(
    request,
    { operation: "saveCategory", name: "Third" },
    { operation: "saveCategory", name: "Second" },
    { operation: "saveCategory", name: "First" },
  );
  await page.goto("/workshop");
  await workshopMenu(page, "Categories");
  const modal = page.getByRole("dialog");
  const names = modal
    .getByRole("list", { name: "Categories" })
    .locator("span.font-medium");
  await expect(names).toHaveText(["First", "Second", "Third"]);
  const drag = await lift(page, modal.getByRole("listitem", { name: "Third" }));
  await drag.over(modal.getByRole("listitem", { name: "First" }), "top");
  await drag.drop(false);
  await expect(names).toHaveText(["Third", "First", "Second"]);
});

for (const [width, height, scheme] of [
  [1440, 900, "light"],
  [390, 844, "dark"],
] as const) {
  test(`Workshop fits and has no errors at ${width}px ${scheme}`, async ({
    page,
    request,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height });
    let state = await seed(
      request,
      {
        operation: "add",
        kind: "project",
        title: "Pinned project with a rather long title to test wrapping",
      },
      { operation: "add", kind: "project", title: "Working project" },
      { operation: "add", kind: "idea", title: "Queued idea" },
    );
    state = await seed(
      request,
      {
        operation: "pin",
        id: idOf(
          state,
          "Pinned project with a rather long title to test wrapping",
        ),
        pinned: true,
      },
      {
        operation: "place",
        id: idOf(state, "Working project"),
        section: "current",
      },
      { operation: "place", id: idOf(state, "Queued idea"), section: "next" },
      {
        operation: "addTasks",
        id: idOf(state, "Working project"),
        tasks: [{ title: "Draft", details: "First pass" }, { title: "Review" }],
      },
    );
    for (const view of ["Focus", "Projects", "Ideas"]) {
      await page.goto("/workshop");
      await tab(page, view).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${view} overflows horizontally`).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: path.join(
          process.env.PLAYWRIGHT_SHOTS ?? info.outputDir,
          `workshop-${view.toLowerCase()}-${width}-${scheme}.png`,
        ),
        fullPage: true,
      });
    }
    await page.goto("/workshop");
    await page
      .getByRole("button", { name: "More actions for Working project" })
      .click();
    await page.screenshot({
      path: path.join(
        process.env.PLAYWRIGHT_SHOTS ?? info.outputDir,
        `workshop-menu-${width}-${scheme}.png`,
      ),
    });
    expect(errors).toEqual([]);
  });
}

test("Archive and Delete sit side by side in the menu and the editor; docs show on list rows", async ({
  page,
  request,
}) => {
  const state = await seed(
    request,
    { operation: "add", kind: "idea", title: "Keep me" },
    { operation: "add", kind: "idea", title: "Delete from menu" },
    { operation: "add", kind: "idea", title: "Delete from editor" },
  );
  await seed(request, {
    operation: "addDoc",
    id: idOf(state, "Keep me"),
    title: "Grill notes",
    body: "Some long text",
  });
  await page.goto("/workshop");
  await tab(page, "Ideas").click();
  // A doc is a visible chip on the row, not just a link icon.
  await row(page, "Keep me")
    .getByRole("button", { name: "Open doc Grill notes" })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Grill notes" })
      .getByText("Some long text"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Menu: Archive and Delete are both offered; Delete turns into a red check
  // and a gray X in place (no pop-up).
  await page
    .getByRole("button", { name: "More actions for Delete from menu" })
    .click();
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel delete" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeVisible();
  // Closing the menu cancels: the item is still there, and Delete is back.
  await page.keyboard.press("Escape");
  await expect(row(page, "Delete from menu")).toBeVisible();
  await page
    .getByRole("button", { name: "More actions for Delete from menu" })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(row(page, "Delete from menu")).toHaveCount(0);

  // The item popup's footer: the same two buttons.
  await row(page, "Delete from editor").getByText("Delete from editor").click();
  const editor = page.getByRole("dialog", {
    name: "Delete from editor",
    exact: true,
  });
  await expect(editor.getByRole("button", { name: "Archive" })).toBeVisible();
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await editor.getByRole("button", { name: "Confirm delete" }).click();
  await expect(editor).toHaveCount(0);
  await expect(row(page, "Delete from editor")).toHaveCount(0);
  await expect(row(page, "Keep me")).toBeVisible();
  // Deleted for good: nothing in the archive, so the menu item is grayed out.
  await page.getByRole("button", { name: "Workshop menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("a doc pasted without a title is added as Spec and visible at once", async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = await seed(request, {
    operation: "add",
    kind: "idea",
    title: "Playlist Sync",
  });
  await seed(request, {
    operation: "place",
    id: idOf(state, "Playlist Sync"),
    section: "current",
  });
  await page.goto("/workshop");
  const editor = await editItem(page, "Playlist Sync");
  await editor.getByRole("button", { name: "Add doc" }).click();
  // Nothing typed: the submit button is off. Text alone enables it.
  const submit = editor.getByRole("button", { name: "Add doc" }).last();
  await expect(submit).toBeDisabled();
  const body = "# Playlist Sync spec\n\nKeep two services in step.\n";
  await editor.getByLabel("Document text").fill(body);
  await submit.click();
  const added = editor
    .getByRole("list", { name: "Documents" })
    .getByRole("listitem");
  await expect(
    added.getByRole("button", { name: "Spec", exact: true }),
  ).toBeVisible();
  await expect(added.getByText("Added")).toBeVisible();
  // The row has a copy icon that copies the exact text.
  await added.getByRole("button", { name: "Copy Spec" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body);
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // And the doc is on the Focus row straight away.
  await expect(
    row(page, "Playlist Sync").getByRole("button", {
      name: "Open doc Spec",
    }),
  ).toBeVisible();
});

test("Save also adds the doc being typed; a custom title is kept; a title alone is refused", async ({
  page,
  request,
}) => {
  await seed(request, { operation: "add", kind: "idea", title: "Typed doc" });
  await page.goto("/workshop");
  await tab(page, "Ideas").click();
  const editor = await editItem(page, "Typed doc");
  await editor.getByRole("button", { name: "Add doc" }).click();
  // The title starts as Spec; clicking in selects it so typing replaces it.
  const title = editor.getByLabel("Document title");
  await expect(title).toHaveValue("Spec");
  await title.click();
  await page.keyboard.type("Research");
  await expect(title).toHaveValue("Research");

  // A title with no text cannot be saved, and says why.
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "Paste the document text",
  );
  await expect(editor).toBeVisible();

  // Text pasted but never "added": Save adds it and closes the editor.
  await editor.getByLabel("Document text").fill("Long pasted text");
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    row(page, "Typed doc").getByRole("button", { name: "Open doc Research" }),
  ).toBeVisible();

  // An untouched form (default title, no text) adds nothing.
  const again = await editItem(page, "Typed doc");
  await again.getByRole("button", { name: "Add doc" }).click();
  await again.getByRole("button", { name: "Done" }).click();
  await expect(again).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    row(page, "Typed doc").getByRole("button", { name: /Open doc/ }),
  ).toHaveCount(1);
});

test("an item opens read-only; the pencil edits and Done returns to the view", async ({
  page,
  request,
}) => {
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Viewed",
  });
  const id = idOf(state, "Viewed");
  await seed(
    request,
    { operation: "addTasks", id, tasks: [{ title: "Open one" }] },
    { operation: "place", id, section: "current" },
  );
  await page.goto("/workshop");
  await row(page, "Viewed").getByText("Viewed").first().click();
  const view = page.getByRole("dialog", { name: "Viewed", exact: true });
  // Read-only: no fields, but tasks and the item actions are there.
  await expect(view.getByRole("textbox", { name: "Title" })).toHaveCount(0);
  await expect(view.getByText("Open one")).toBeVisible();
  for (const name of [
    "Move to Up next",
    "Remove from Focus",
    "Mark Built",
    "Archive",
    "Delete",
  ])
    await expect(view.getByRole("button", { name })).toBeVisible();
  // Idea/Project changes through the kind chip, not a footer button.
  await expect(view.getByRole("button", { name: "Set as idea" })).toHaveCount(
    0,
  );
  await expect(
    view.getByRole("button", { name: "Type: Project. Change" }),
  ).toBeVisible();

  await view.getByRole("button", { name: "Edit Viewed" }).click();
  const editor = page.getByRole("dialog", { name: "Editing" });
  // Everything is open: links, and no Save or Cancel.
  await expect(editor.getByLabel("GitHub URL")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save" })).toHaveCount(0);
  await editor.getByLabel("Description").fill("Now described.");
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toHaveCount(0);
  await expect(view.getByText("Now described.")).toBeVisible();
});

test("closing the editor saves, and a refused save keeps it open", async ({
  page,
  request,
}) => {
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Autosave",
  });
  await seed(request, {
    operation: "place",
    id: idOf(state, "Autosave"),
    section: "current",
  });
  await page.goto("/workshop");
  let editor = await editItem(page, "Autosave");
  await editor.getByLabel("Description").fill("Saved by closing.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Autosave")).toContainText("Saved by closing.");

  // A bad URL cannot save: the editor stays open with the reason.
  editor = await editItem(page, "Autosave");
  await editor.getByLabel("GitHub URL").fill("not a url");
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("alert")).toBeVisible();
  // Discard changes goes back to the last saved version.
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor).toHaveCount(0);
  const view = page.getByRole("dialog", { name: "Autosave", exact: true });
  await expect(view).toBeVisible();
  await expect(view.getByText("not a url")).toHaveCount(0);
});

test("docs are not in the links menu; the Working on row shows them as chips", async ({
  page,
  request,
}) => {
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Linked",
  });
  const id = idOf(state, "Linked");
  await seed(
    request,
    { operation: "place", id, section: "current" },
    { operation: "addDoc", id, title: "Spec", body: "text" },
  );
  await page.goto("/workshop");
  const card = row(page, "Linked");
  await expect(
    card.getByRole("button", { name: "Open doc Spec" }),
  ).toBeVisible();
  // A doc alone does not create a links icon, and no Spec link row exists.
  await expect(card.getByRole("button", { name: /^Links for/ })).toHaveCount(0);
});

/** A throwaway git repo: main with two commits, a feature branch, and one uncommitted file. */
function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-dev-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=t@example.com", ...args],
      { cwd: dir, encoding: "utf8" },
    );
  git("init", "-qb", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "1");
  git("add", "-A");
  git("commit", "-qm", "first commit");
  git("branch", "feature");
  fs.writeFileSync(path.join(dir, "b.txt"), "2");
  git("add", "-A");
  git("commit", "-qm", "second commit");
  fs.writeFileSync(path.join(dir, "dirty.txt"), "x");
  return dir;
}

test("a linked project shows a folder icon with a hover summary and a Dev tab", async ({
  page,
  request,
}) => {
  const repo = fixtureRepo();
  try {
    const state = await seed(
      request,
      { operation: "add", kind: "project", title: "Dev app" },
      { operation: "add", kind: "project", title: "Unlinked app" },
      { operation: "add", kind: "project", title: "Lost app" },
      { operation: "add", kind: "idea", title: "Just an idea" },
    );
    const draft = (title: string, localFolder: string) => ({
      title,
      description: "",
      categoryId: null,
      links: [],
      checklist: [],
      status: "Active",
      githubUrl: "",
      localFolder,
      liveUrl: "",
      deployed: false,
      milestones: [],
    });
    await seed(
      request,
      {
        operation: "edit",
        id: idOf(state, "Dev app"),
        draft: draft("Dev app", repo),
      },
      {
        operation: "edit",
        id: idOf(state, "Lost app"),
        draft: draft("Lost app", path.join(repo, "missing")),
      },
    );
    await page.goto("/workshop");
    await tab(page, "Projects").click();

    // Only linked projects carry the icon.
    await expect(
      page.getByRole("button", { name: /^Local folder linked for/ }),
    ).toHaveCount(2);
    await expect(
      row(page, "Unlinked app").getByRole("button", {
        name: /Local folder linked/,
      }),
    ).toHaveCount(0);

    // Dev stays neutral even with uncommitted files, and cards omit Local folder.
    const devChip = row(page, "Dev app").getByRole("button", {
      name: /Local folder linked/,
    });
    await expect(devChip).not.toHaveClass(/text-(warning|destructive|success)/);
    await expect(devChip).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(
      row(page, "Dev app").getByText("Local folder", { exact: true }),
    ).toHaveCount(0);

    // The card chip says only "Dev".
    await expect(devChip).toHaveText("Dev");

    // Hover: the branch, what is uncommitted, and the counts.
    await row(page, "Dev app")
      .getByRole("button", { name: /Local folder linked/ })
      .hover();
    const card = page.locator("[data-slot=hover-card-content]");
    await expect(card.getByText("main", { exact: true })).toBeVisible();
    await expect(
      card.getByText("Main checkout", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("Uncommitted", { exact: true })).toBeVisible();
    await expect(card.getByText(/uncommitted file/)).toHaveCount(0);
    await expect(card.getByText("2 local")).toBeVisible();
    await expect(card.getByText("Needs install")).toHaveCount(0);

    // A folder that is gone is a state, not an error.
    await page.mouse.move(0, 0);
    await row(page, "Lost app")
      .getByRole("button", { name: /Local folder linked/ })
      .hover();
    await expect(card.getByText(/Folder not found/)).toBeVisible();

    // Clicking the icon opens the popup on its Dev tab.
    await row(page, "Dev app")
      .getByRole("button", { name: /Local folder linked/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Dev app", exact: true });
    await expect(dialog.getByRole("radio", { name: "Dev" })).toBeChecked();
    // The popup header repeats the Overview chips, then the Links line.
    await expect(dialog.getByText("Links", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Path", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /^Type: Project/ }),
    ).toBeVisible();
    const checkouts = dialog.getByRole("region", { name: "Checkouts" });
    await expect(checkouts.getByRole("article")).toHaveCount(1);
    const checkout = checkouts.getByRole("article", { name: "Checkout main" });
    await expect(checkout.getByText("main", { exact: true })).toBeVisible();
    await expect(checkout.getByText("Main checkout")).toHaveCount(0);
    await expect(checkout.getByText("second commit")).toBeVisible();
    // The path is one button; pressing it copies.
    await expect(
      checkout.getByRole("button", { name: `Copy path ${repo}` }),
    ).toBeVisible();
    await expect(
      checkout.getByRole("button", { name: "View all commits" }),
    ).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Git" })).toHaveCount(0);
    await expect(
      checkout.getByLabel("Checkout status").getByText("1 file not committed"),
    ).toBeVisible();
    await expect(
      checkout.getByRole("button", { name: "Commit all" }),
    ).toBeVisible();
    // No remote: Push, Pull and Fetch are not offered.
    await expect(checkout.getByRole("button", { name: /^Push/ })).toHaveCount(
      0,
    );
    const overview = dialog.getByRole("region", {
      name: "Repository overview",
    });
    for (const label of [
      "Checkouts",
      "Local branches",
      "Remote branches",
      "Total commits",
    ])
      await expect(overview.getByText(label, { exact: true })).toBeVisible();
    const local = dialog.getByRole("list", { name: "Local branches" });
    await expect(local.getByRole("listitem")).toHaveCount(2);
    await expect(local.getByText("feature", { exact: true })).toBeVisible();
    await expect(local.getByText("1 behind main")).toBeVisible();
    // The default branch comes first, with its working-tree state in words.
    await expect(local.getByRole("listitem").first()).toContainText("main");
    await expect(local.getByRole("listitem").first()).toContainText(
      "1 file uncommitted",
    );
    await expect(
      dialog.getByRole("heading", { name: "Remote branches" }),
    ).toHaveCount(0);

    // View changes shows what is uncommitted; nothing is changed by looking.
    await checkout.getByRole("button", { name: "View changes" }).click();
    const changes = page.getByRole("dialog", { name: /^Changes on/ });
    await expect(
      changes
        .getByRole("list", { name: "Changed files" })
        .getByText("dirty.txt"),
    ).toBeVisible();
    await expect(changes.getByLabel("Diff")).toContainText("+x");
    await page.keyboard.press("Escape");
    await expect(changes).toHaveCount(0);

    await dialog.screenshot({ path: ".cache/workshop-dev-layout.png" });

    // Commits and graph open as their own popups and close back to Dev.
    await dialog.getByRole("button", { name: "View all commits" }).click();
    const commits = page.getByRole("dialog", { name: /^Commits/ });
    await expect(
      commits.getByRole("list", { name: "Commits" }).getByRole("listitem"),
    ).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(commits).toHaveCount(0);
    await dialog.getByRole("button", { name: "View graph" }).click();
    const graph = page.getByRole("dialog", { name: /^Graph/ });
    await expect(
      graph.getByRole("list", { name: "Commit graph" }).getByRole("listitem"),
    ).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(
      dialog.getByRole("region", { name: "Branches" }),
    ).toBeVisible();

    // Back on Overview, and the unlinked project and the idea have no Dev tab.
    await dialog.getByRole("radio", { name: "Overview" }).click();
    await page.keyboard.press("Escape");
    await row(page, "Unlinked app").getByText("Unlinked app").click();
    await expect(
      page
        .getByRole("dialog", { name: "Unlinked app", exact: true })
        .getByRole("radio", { name: "Dev" }),
    ).toHaveCount(0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("the Dev tab runs a project, opens it once it is up, stops it and switches branches", async ({
  page,
  request,
}) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-run-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=t@example.com", ...args],
      { cwd: repo, encoding: "utf8" },
    );
  git("init", "-qb", "main");
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { dev: "node server.js" } }),
  );
  // Prints its own address, as dev servers do; node_modules means nothing to install.
  fs.writeFileSync(
    path.join(repo, "server.js"),
    `const s = require("http").createServer((q, r) => r.end("ok")).listen(0, "127.0.0.1", () => console.log("Local: http://localhost:" + s.address().port + "/"));`,
  );
  fs.mkdirSync(path.join(repo, "node_modules"));
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\n");
  git("add", "-A");
  git("commit", "-qm", "first");
  git("branch", "feature");
  try {
    const state = await seed(request, {
      operation: "add",
      kind: "project",
      title: "Runnable",
    });
    await seed(request, {
      operation: "edit",
      id: idOf(state, "Runnable"),
      draft: {
        title: "Runnable",
        description: "",
        categoryId: null,
        links: [],
        checklist: [],
        status: "Active",
        githubUrl: "",
        localFolder: repo,
        liveUrl: "",
        deployed: false,
        milestones: [],
      },
    });
    await page.goto("/workshop");
    await tab(page, "Projects").click();
    await row(page, "Runnable")
      .getByRole("button", { name: /Local folder linked/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Runnable", exact: true });
    const run = dialog.getByRole("region", { name: "Run" });
    // Nothing is running, so there is nothing to open yet; nothing to install.
    await expect(run.getByRole("link", { name: "Open" })).toHaveCount(0);
    await expect(
      run.getByRole("button", { name: "Install", exact: true }),
    ).toHaveCount(0);
    // No remote, so no Fetch, Pull or Push.
    await expect(dialog.getByRole("button", { name: "Fetch" })).toHaveCount(0);

    await run.getByRole("button", { name: "Run", exact: true }).click();
    // Starting opens the details: the command and the logs sit under one chevron.
    await expect(run.getByText("Command", { exact: true })).toBeVisible();
    const open = run.getByRole("link", { name: "Open" });
    await expect(open).toBeVisible({ timeout: 15_000 });
    await expect(open).toHaveAttribute("href", /^http:\/\/localhost:\d+\/$/);
    await expect(run.getByText("Running", { exact: true })).toBeVisible();
    await expect(run.getByRole("log")).toContainText(
      "Local: http://localhost:",
    );

    // Maintenance actions sit in the options menu, with no standing explanation.
    await expect(run.getByText(/Uninstall removes/)).toHaveCount(0);
    await run.getByRole("button", { name: "Run options" }).click();
    await expect(page.getByRole("menuitem")).toHaveText([
      "Reinstall",
      "Restart",
      "Uninstall",
    ]);
    await page.keyboard.press("Escape");

    // There is no separate Logs button; the chevron folds the details away.
    await expect(
      run.getByRole("button", { name: "Logs", exact: true }),
    ).toHaveCount(0);
    await run.getByRole("button", { name: "Hide run details" }).click();
    await expect(run.getByRole("log")).toHaveCount(0);
    await expect(run.getByText("Running", { exact: true })).toBeVisible();
    await run.getByRole("button", { name: "Show run details" }).click();
    await expect(run.getByRole("log")).toContainText(
      "Local: http://localhost:",
    );

    // Only a clean checkout can switch branches.
    fs.writeFileSync(path.join(repo, "dirty.txt"), "x");
    await dialog.getByRole("radio", { name: "Overview" }).click();
    await dialog.getByRole("radio", { name: "Dev" }).click();
    const feature = dialog
      .getByRole("list", { name: "Local branches" })
      .getByRole("listitem")
      .filter({ hasText: "feature" });
    await expect(
      feature.getByRole("button", { name: "Switch" }),
    ).toBeDisabled();
    fs.rmSync(path.join(repo, "dirty.txt"));
    await dialog.getByRole("radio", { name: "Overview" }).click();
    await dialog.getByRole("radio", { name: "Dev" }).click();
    await feature.getByRole("button", { name: "Switch" }).click();
    await expect(
      dialog
        .getByRole("region", { name: "Checkouts" })
        .getByText("feature", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    expect(git("branch", "--show-current").trim()).toBe("feature");

    await run.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(run.getByRole("link", { name: "Open" })).toHaveCount(0);
    await expect(run.getByText("Stopped", { exact: true })).toBeVisible();
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("redesigned cards add tasks directly and keep metadata and dialog links readable", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Card layout",
  });
  const id = idOf(state, "Card layout");
  await seed(
    request,
    {
      operation: "edit",
      id,
      draft: {
        title: "Card layout",
        description: "A concise project description.",
        categoryId: null,
        links: [],
        checklist: [],
        status: "Active",
        githubUrl: "https://github.com/example/project",
        localFolder: "",
        liveUrl: "https://example.com",
        deployed: false,
        milestones: [],
      },
    },
    { operation: "place", id, section: "current" },
  );
  await page.goto("/workshop");
  const card = row(page, "Card layout");
  await card.getByRole("button", { name: "Add tasks for Card layout" }).click();
  const input = card.getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill("First task");
  await input.press("Enter");
  await expect(card.getByText("First task", { exact: true })).toBeVisible();
  await card
    .getByRole("button", { name: "More actions for Card layout" })
    .click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Remove from Focus",
    "Move to Up next",
    "Mark Built",
    "Archive",
    "Delete",
  ]);
  const positions = await page
    .getByRole("menuitem")
    .filter({ hasText: /^(Archive|Delete)$/ })
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().top),
    );
  expect(Math.abs(positions[0] - positions[1])).toBeLessThan(2);
  await page.keyboard.press("Escape");
  await card.getByRole("heading", { name: "Card layout" }).click();
  const dialog = page.getByRole("dialog", { name: "Card layout", exact: true });
  await expect(
    dialog.getByRole("region", { name: "Description" }),
  ).toContainText("A concise project description.");
  await expect(
    dialog.getByRole("link", { name: "GitHub", exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole("link", { name: "Live site", exact: true }),
  ).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Path" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "More links" })).toHaveCount(
    0,
  );
  await expect(dialog.getByText("Deployed", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Type: Project. Change" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".cache/workshop-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("link", { name: "GitHub", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".cache/workshop-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("multiple services and setup use a persistent collapsible log console", async ({
  page,
  request,
}) => {
  const repo = fixtureRepo();
  let id = "";
  try {
    for (const name of ["web", "api"])
      fs.writeFileSync(
        path.join(repo, `${name}.cjs`),
        `console.log('${name.toUpperCase()} OUTPUT');setInterval(()=>{},1000);`,
      );
    fs.writeFileSync(
      path.join(repo, "setup.cjs"),
      "require('node:fs').mkdirSync('node_modules',{recursive:true});console.log('INSTALL OUTPUT');",
    );
    const state = await seed(request, {
      operation: "add",
      kind: "project",
      title: "Service console",
    });
    id = idOf(state, "Service console");
    await seed(request, {
      operation: "edit",
      id,
      draft: {
        title: "Service console",
        description: "",
        categoryId: null,
        links: [],
        checklist: [],
        status: "Active",
        githubUrl: "",
        localFolder: repo,
        liveUrl: "",
        deployed: false,
        milestones: [],
      },
    });
    const config = path.join(
      process.env.PLAYWRIGHT_CAREER_ROOT!,
      "ui/.workshop/dev.json",
    );
    fs.writeFileSync(
      config,
      JSON.stringify({
        projects: {
          [repo]: {
            services: [
              { name: "web", command: "node web.cjs" },
              { name: "api", command: "node api.cjs" },
            ],
            setup: [
              {
                name: "Dependencies",
                command: "node setup.cjs",
                creates: "node_modules",
              },
            ],
          },
        },
      }),
    );
    await page.goto("/workshop");
    await tab(page, "Projects").click();
    await row(page, "Service console")
      .getByRole("button", { name: /Local folder linked/ })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Service console",
      exact: true,
    });
    const run = dialog.getByRole("region", { name: "Run", exact: true });
    await run
      .getByRole("button", { name: "Install dependencies", exact: true })
      .click();
    await expect(run.getByRole("log")).toContainText("INSTALL OUTPUT");
    await run.getByRole("button", { name: "Run all", exact: true }).click();
    await expect(run.getByRole("tab", { name: /^web/ })).toBeVisible();
    await expect(run.getByRole("tab", { name: /^api/ })).toBeVisible();
    await run.getByRole("tab", { name: /^api/ }).click();
    await expect(run.getByRole("log")).toContainText("API OUTPUT");
    await run.getByRole("tab", { name: /^web/ }).click();
    await expect(run.getByRole("log")).toContainText("WEB OUTPUT");
    await expect(run.getByRole("log")).toHaveCSS(
      "background-color",
      "rgb(0, 0, 0)",
    );
    await run.getByRole("button", { name: "Hide run details" }).click();
    await expect(run.getByRole("log")).toHaveCount(0);
    await expect(run.getByRole("tab")).toHaveCount(0);
    await run.getByRole("button", { name: "Show run details" }).click();
    await expect(
      run
        .getByRole("list", { name: "Services" })
        .getByText("Running", { exact: true }),
    ).toHaveCount(2);
    await expect(run.getByRole("log")).toContainText("WEB OUTPUT");
    await page.screenshot({
      path: ".cache/workshop-dev-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: ".cache/workshop-dev-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    if (id)
      await request.post(`/api/workshop/dev/${id}/stop`, {
        data: { worktree: repo },
      });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Dev handles remotes, multiple checkouts, detached HEAD, More links and mobile view", async ({
  page,
  request,
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-dev-rich-"));
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  const worktree = path.join(root, "wt-evals");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=t@example.com", ...args],
      { cwd, encoding: "utf8" },
    );
  try {
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "init", "-qb", "main", repo);
    fs.writeFileSync(path.join(repo, "README.md"), "init\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "initial commit");
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-qu", "origin", "main");
    git(repo, "remote", "set-head", "origin", "main");

    // Local branch with an unpushed commit on its own upstream.
    git(repo, "switch", "-q", "-c", "tracked");
    fs.writeFileSync(path.join(repo, "t1.txt"), "1");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "tracked base");
    git(repo, "push", "-qu", "origin", "tracked");
    fs.writeFileSync(path.join(repo, "t2.txt"), "2");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "tracked ahead");

    // Back to main, then add a worktree on an unpublished branch ahead of main.
    git(repo, "switch", "-q", "main");
    git(repo, "worktree", "add", "-q", "-b", "evals-platform", worktree);
    fs.writeFileSync(path.join(worktree, "evals.txt"), "e");
    git(worktree, "add", "-A");
    git(worktree, "commit", "-qm", "work on evals");

    const state = await seed(request, {
      operation: "add",
      kind: "project",
      title: "Rich Dev",
    });
    await seed(request, {
      operation: "edit",
      id: idOf(state, "Rich Dev"),
      draft: {
        title: "Rich Dev",
        description: "Multi-checkout project with remote.",
        categoryId: null,
        links: ["https://docs.example.com/guide"],
        checklist: [],
        status: "Active",
        githubUrl: "https://github.com/example/rich-dev",
        localFolder: repo,
        liveUrl: "https://rich-dev.example.com",
        deployed: true,
        milestones: [],
      },
    });

    await page.goto("/workshop");
    await tab(page, "Projects").click();

    const devChip = row(page, "Rich Dev").getByRole("button", {
      name: /Local folder linked/,
    });
    await expect(devChip).toHaveText("Dev");
    await devChip.hover();
    const hover = page.locator("[data-slot=hover-card-content]");
    await expect(
      hover.getByText("Main checkout", { exact: true }),
    ).toBeVisible();
    await expect(
      hover.getByText("All committed", { exact: true }),
    ).toBeVisible();
    await expect(hover.getByText("In sync", { exact: true })).toBeVisible();
    await expect(hover.getByText("On remote", { exact: true })).toBeVisible();
    await expect(hover.getByText(/Also needs attention:/)).toContainText(
      "evals-platform",
    );
    await hover.screenshot({ path: ".cache/workshop-dev-hover.png" });

    await devChip.click();
    const dialog = page.getByRole("dialog", { name: "Rich Dev", exact: true });

    // Shared header: the chips, then one Links line with every saved link.
    await expect(
      dialog.getByRole("link", { name: "GitHub", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "Live site", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Path", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: /docs\.example\.com\/guide/ }),
    ).toBeVisible();

    // One Overview card with the four counts.
    const overview = dialog.getByRole("region", {
      name: "Repository overview",
    });
    for (const label of [
      "Checkouts",
      "Local branches",
      "Remote branches",
      "Total commits",
    ])
      await expect(overview.getByText(label, { exact: true })).toBeVisible();

    // Each checkout is its own card, the main checkout first.
    const checkouts = dialog.getByRole("region", { name: "Checkouts" });
    await expect(checkouts.getByRole("article")).toHaveCount(2);
    const mainCard = checkouts.getByRole("article", { name: "Checkout main" });
    await expect(
      mainCard.getByText("All changes committed", { exact: true }),
    ).toBeVisible();
    await expect(checkouts.getByRole("article").first()).toContainText("main");
    // Nothing to push or pull on main, so those are grayed out; Fetch is not.
    await expect(mainCard.getByRole("button", { name: "Push" })).toBeDisabled();
    await expect(mainCard.getByRole("button", { name: "Pull" })).toBeDisabled();
    await expect(mainCard.getByRole("button", { name: "Fetch" })).toBeEnabled();
    const evalsCard = checkouts.getByRole("article", {
      name: "Checkout evals-platform",
    });
    await expect(
      evalsCard.getByRole("button", { name: "Publish branch" }),
    ).toBeEnabled();

    // Local and remote branches: default branch first in both lists, with plain-text status.
    const local = dialog.getByRole("list", { name: "Local branches" });
    await expect(local.getByRole("listitem").first()).toContainText("main");
    await expect(local.getByRole("listitem").first()).toContainText(
      "All committed",
    );
    await expect(local.getByRole("listitem").first()).toContainText(
      "In sync with origin/main",
    );
    const evalsRow = local
      .getByRole("listitem")
      .filter({ hasText: "evals-platform" });
    await expect(evalsRow.getByText("Not pushed")).toBeVisible();
    await expect(evalsRow.getByText("1 ahead of main")).toBeVisible();

    const trackedRow = local
      .getByRole("listitem")
      .filter({ hasText: /^tracked/ });
    await expect(
      trackedRow.getByText("1 ahead of origin/tracked"),
    ).toBeVisible();

    await expect(
      dialog.getByRole("heading", { name: "Remote branches", exact: true }),
    ).toBeVisible();
    const remote = dialog.getByRole("list", { name: "Remote branches" });
    await expect(remote.getByRole("listitem").first()).toContainText(
      "origin/main",
    );
    await expect(
      remote.getByRole("listitem").first().getByText("In sync with main"),
    ).toBeVisible();

    await dialog.screenshot({ path: ".cache/workshop-dev-rich-desktop.png" });
    await dialog
      .getByRole("region", { name: "Branches" })
      .scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: ".cache/workshop-dev-branches.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.screenshot({ path: ".cache/workshop-dev-rich-mobile.png" });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Go to checkout points Run locally at that worktree.
    await evalsRow.getByRole("button", { name: "Go to checkout" }).click();
    await expect(
      dialog
        .getByRole("region", { name: "Run", exact: true })
        .getByRole("button", { name: "Choose checkout to run" }),
    ).toContainText("evals-platform");

    // Publish evals-platform to origin from its own card.
    await evalsCard.getByRole("button", { name: "Publish branch" }).click();
    await expect(remote.getByText("origin/evals-platform")).toBeVisible();
    await expect(
      evalsCard.getByRole("button", { name: "Publish branch" }),
    ).toHaveCount(0);

    // A detached worktree says so in its card.
    git(worktree, "switch", "--detach", "-q");
    await dialog.getByRole("radio", { name: "Overview" }).click();
    await dialog.getByRole("radio", { name: "Dev" }).click();
    await expect(
      checkouts.getByText("Detached HEAD", { exact: true }),
    ).toBeVisible();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Dev commits all changes with a message and shows the checkout clean", async ({
  page,
  request,
}) => {
  const repo = fixtureRepo();
  try {
    const state = await seed(request, {
      operation: "add",
      kind: "project",
      title: "Committer",
    });
    await seed(request, {
      operation: "edit",
      id: idOf(state, "Committer"),
      draft: {
        title: "Committer",
        description: "",
        categoryId: null,
        links: [],
        checklist: [],
        status: "Active",
        githubUrl: "",
        localFolder: repo,
        liveUrl: "",
        deployed: false,
        milestones: [],
      },
    });
    await page.goto("/workshop");
    await tab(page, "Projects").click();
    await row(page, "Committer")
      .getByRole("button", { name: /Local folder linked/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Committer", exact: true });
    const card = dialog.getByRole("article", { name: "Checkout main" });
    await card.getByRole("button", { name: "Commit all" }).click();
    const commit = page.getByRole("dialog", { name: "Commit all changes" });
    // A message is required.
    await expect(commit.getByRole("button", { name: "Commit" })).toBeDisabled();
    await commit.getByLabel("Commit message").fill("Save the dirty file");
    await commit.getByRole("button", { name: "Commit" }).click();
    await expect(commit).toHaveCount(0);
    await expect(
      card.getByText("All changes committed", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("Save the dirty file")).toBeVisible();
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Up next folds away and remembers it; tab counts and headings show counts", async ({
  page,
  request,
}) => {
  const state = await seed(
    request,
    { operation: "add", kind: "idea", title: "Queued one" },
    { operation: "add", kind: "project", title: "Working one" },
  );
  await seed(
    request,
    { operation: "place", id: idOf(state, "Queued one"), section: "next" },
    { operation: "place", id: idOf(state, "Working one"), section: "current" },
  );
  await page.goto("/workshop");
  await expect(page.getByLabel("Up next count: 1")).toBeVisible();
  await expect(page.getByLabel("Working on count: 1")).toBeVisible();
  const toggle = page.getByRole("button", { name: /^Up next/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, "Queued one")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(row(page, "Queued one")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Up next/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: /^Up next/ }).click();
  await expect(row(page, "Queued one")).toBeVisible();
});

test("ideas can hold links and a doc chip; several docs open from one menu", async ({
  page,
  request,
}) => {
  const state = await seed(request, {
    operation: "add",
    kind: "idea",
    title: "Linked idea",
  });
  const id = idOf(state, "Linked idea");
  await seed(
    request,
    {
      operation: "edit",
      id,
      draft: {
        title: "Linked idea",
        description: "An idea with links.",
        categoryId: null,
        links: ["https://docs.example.com/notes"],
        checklist: [],
        status: "Saved",
        githubUrl: "https://github.com/example/idea",
        localFolder: "",
        liveUrl: "https://idea.example.com",
        deployed: false,
        milestones: [],
      },
    },
    { operation: "addDoc", id, title: "Spec", body: "one" },
    { operation: "addDoc", id, title: "Research", body: "two" },
  );
  await page.goto("/workshop");
  await tab(page, "Ideas").click();
  const card = row(page, "Linked idea");
  // Live site, GitHub, other links, then docs.
  const labels = await card
    .locator("a, button")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.trim() ?? "").filter(Boolean),
    );
  expect(labels.indexOf("Live site")).toBeLessThan(labels.indexOf("GitHub"));
  expect(labels.indexOf("GitHub")).toBeLessThan(
    labels.findIndex((label) => label.includes("docs.example.com")),
  );
  await card.getByRole("button", { name: "Docs for Linked idea" }).click();
  await page.getByRole("menuitem", { name: "Open doc Research" }).click();
  await expect(page.getByRole("dialog", { name: "Research" })).toBeVisible();
});

test("Up next titles keep their width on a phone", async ({
  page,
  request,
}) => {
  const state = await seed(request, {
    operation: "add",
    kind: "project",
    title: "Queued project with a longer title",
  });
  const id = idOf(state, "Queued project with a longer title");
  await seed(
    request,
    { operation: "addTasks", id, tasks: [{ title: "First task" }] },
    { operation: "place", id, section: "next" },
  );
  const item = row(page, "Queued project with a longer title");
  const start = item.getByRole("button", { name: /^Start / });
  const heading = item.getByRole("heading", { level: 3 });
  const shape = async () => ({
    title: (await heading.boundingBox())!,
    start: (await start.boundingBox())!,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workshop");
  await expect(start).toBeVisible();
  const phone = await shape();
  expect(phone.title.width).toBeGreaterThan(200);
  expect(phone.start.y).toBeGreaterThan(phone.title.y + phone.title.height);

  // Desktop keeps one row.
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktop = await shape();
  expect(desktop.start.x).toBeGreaterThan(
    desktop.title.x + desktop.title.width,
  );
});
