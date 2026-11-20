import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NotFoundError, ValidationError } from "@/lib/applications";
import {
  atomicWrite,
  ConflictError,
  sha256,
  withFileLock,
} from "@/lib/fileStore";
import { resolveExpected } from "@/lib/paths";
import {
  focusSections,
  ideaStatuses,
  maxDocs,
  newDraft,
  normalizedName,
  projectStatuses,
  snapshotSchema,
  type Item,
  type Operation,
  type Snapshot,
} from "./model";

const namespace = "ui/.workshop";
const initial: Snapshot = {
  version: 4,
  items: [],
  categories: [],
  orders: { idea: [], project: [], current: [], next: [] },
};
const serialize = (snapshot: Snapshot) =>
  JSON.stringify(snapshot, null, 2) + "\n";
const initialText = serialize(initial);

export function readWorkshop() {
  const file = resolveExpected(`${namespace}/snapshot.json`);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    text = initialText;
  }
  return {
    snapshot: snapshotSchema.parse(JSON.parse(text)),
    hash: sha256(text),
  };
}

function moveToTop(snapshot: Snapshot, item: Item) {
  snapshot.orders[item.kind].unshift(item.id);
}

function clearOrder(
  snapshot: Snapshot,
  list: keyof Snapshot["orders"],
  id: string,
) {
  snapshot.orders[list] = snapshot.orders[list].filter((entry) => entry !== id);
}

// Places `id` directly before or after `to`, wherever the two currently sit.
function insertBeside(order: string[], id: string, to: string, after: boolean) {
  const rest = order.filter((entry) => entry !== id);
  const at = rest.indexOf(to);
  if (at < 0) throw new ValidationError("Both items must be in this list.");
  rest.splice(at + (after ? 1 : 0), 0, id);
  order.splice(0, order.length, ...rest);
}

function promote(snapshot: Snapshot, item: Item) {
  clearOrder(snapshot, "idea", item.id);
  item.kind = "project";
  item.status = "Active";
  if (!item.archived) moveToTop(snapshot, item);
}

// Ideas keep their links; only milestones belong to projects alone.
function demote(snapshot: Snapshot, item: Item) {
  clearOrder(snapshot, "project", item.id);
  item.kind = "idea";
  item.status = "Saved";
  item.milestones = [];
  if (!item.archived) moveToTop(snapshot, item);
}

// A Built project is finished: it leaves Pinned and Focus.
function markBuilt(snapshot: Snapshot, item: Item) {
  item.status = "Built";
  item.pinned = false;
  for (const section of focusSections) clearOrder(snapshot, section, item.id);
}

function applySection(
  snapshot: Snapshot,
  item: Item,
  section: "pinned" | "active" | "built",
) {
  if (section === "built") {
    if (item.kind !== "project")
      throw new ValidationError("Only projects can be marked Built.");
    markBuilt(snapshot, item);
    return;
  }
  if (item.kind === "project" && item.status === "Built")
    item.status = "Active";
  item.pinned = section === "pinned";
}

function apply(
  snapshot: Snapshot,
  command: Exclude<Operation, { operation: "restore" }>,
) {
  if (command.operation === "add") {
    const item: Item = {
      id: randomUUID(),
      kind: command.kind,
      archived: false,
      pinned: false,
      ...newDraft(command.kind, command.title),
      docs: [],
    };
    snapshot.items.push(item);
    moveToTop(snapshot, item);
    return;
  }
  if (command.operation === "saveCategory") {
    const name = normalizedName(command.name);
    if (
      name === "uncategorized" ||
      snapshot.categories.some(
        (category) =>
          category.id !== command.id && normalizedName(category.name) === name,
      )
    )
      throw new ValidationError("Choose a different category name.");
    if (command.id) {
      const category = snapshot.categories.find(
        (category) => category.id === command.id,
      );
      if (!category) throw new NotFoundError("Category no longer exists.");
      category.name = command.name;
    } else {
      snapshot.categories.unshift({ id: randomUUID(), name: command.name });
    }
    return;
  }
  if (command.operation === "moveCategory") {
    const from = snapshot.categories.findIndex(
      (category) => category.id === command.id,
    );
    const to = snapshot.categories.findIndex(
      (category) => category.id === command.to,
    );
    if (from < 0 || to < 0)
      throw new ValidationError("Both categories must exist.");
    if (from !== to) {
      const [moved] = snapshot.categories.splice(from, 1);
      snapshot.categories.splice(to, 0, moved);
    }
    return;
  }
  if (command.operation === "deleteCategory") {
    if (!snapshot.categories.some((category) => category.id === command.id))
      throw new NotFoundError("Category no longer exists.");
    snapshot.categories = snapshot.categories.filter(
      (category) => category.id !== command.id,
    );
    for (const item of snapshot.items) {
      if (item.categoryId === command.id) item.categoryId = null;
    }
    return;
  }
  if (command.operation === "move") {
    if (
      command.to === undefined &&
      command.categoryId === undefined &&
      command.section === undefined
    )
      throw new ValidationError("Choose a destination item or category.");
    const order = snapshot.orders[command.list];
    const from = order.indexOf(command.id);
    if (from < 0) throw new ValidationError("Both items must be in this list.");
    const item = snapshot.items.find((entry) => entry.id === command.id);
    if (!item) throw new NotFoundError("Item no longer exists.");
    if (command.categoryId !== undefined) {
      if (command.list !== "idea" && command.list !== "project")
        throw new ValidationError(
          "Move items to categories from Ideas or Projects.",
        );
      if (
        command.categoryId !== null &&
        !snapshot.categories.some(
          (category) => category.id === command.categoryId,
        )
      )
        throw new NotFoundError("Category no longer exists.");
      item.categoryId = command.categoryId;
    }
    if (command.section !== undefined) {
      if (command.list !== "idea" && command.list !== "project")
        throw new ValidationError("Sections apply to Ideas and Projects.");
      applySection(snapshot, item, command.section);
    }
    if (command.to !== undefined && command.after !== undefined) {
      if (command.to !== command.id)
        insertBeside(order, command.id, command.to, command.after);
    } else if (command.to !== undefined && command.to !== command.id) {
      const to = order.indexOf(command.to);
      if (to < 0) throw new ValidationError("Both items must be in this list.");
      order.splice(from, 1);
      order.splice(to, 0, command.id);
    }
    return;
  }
  const item = snapshot.items.find((item) => item.id === command.id);
  if (!item) throw new NotFoundError("Item no longer exists.");
  switch (command.operation) {
    case "edit":
      Object.assign(item, command.draft);
      // A Live URL is what makes a project deployed.
      item.deployed = Boolean(item.liveUrl);
      if (item.kind === "project" && item.status === "Built")
        markBuilt(snapshot, item);
      break;
    case "place":
      if (item.archived)
        throw new ValidationError(
          "Restore the item before adding it to Focus.",
        );
      for (const section of focusSections) {
        if (section !== command.section) clearOrder(snapshot, section, item.id);
      }
      if (
        command.section &&
        !snapshot.orders[command.section].includes(item.id)
      )
        snapshot.orders[command.section].push(item.id);
      if (command.section && command.to && command.to !== item.id)
        insertBeside(
          snapshot.orders[command.section],
          item.id,
          command.to,
          command.after ?? false,
        );
      break;
    case "completeTask": {
      const next = item.checklist.find((task) => !task.done);
      if (
        item.archived ||
        !snapshot.orders.current.includes(item.id) ||
        next?.id !== command.taskId
      )
        throw new ValidationError(
          "Reload Workshop to see the current next action.",
        );
      next.done = true;
      break;
    }
    case "setTask": {
      const task = item.checklist.find((entry) => entry.id === command.taskId);
      if (item.archived || !task)
        throw new ValidationError("Reload Workshop to see the current tasks.");
      task.done = command.done;
      break;
    }
    case "addTask":
    case "addTasks": {
      if (item.archived)
        throw new ValidationError("Restore the item before adding tasks.");
      const added =
        command.operation === "addTask"
          ? [
              {
                title: command.title,
                details: command.details,
              },
            ]
          : command.tasks;
      if (item.checklist.length + added.length > 200)
        throw new ValidationError("An item can have at most 200 tasks.");
      for (const task of added)
        item.checklist.push({
          id: randomUUID(),
          title: task.title,
          done: false,
          ...(task.details ? { details: task.details } : {}),
        });
      break;
    }
    case "editTask": {
      const task = item.checklist.find((entry) => entry.id === command.taskId);
      if (item.archived || !task)
        throw new ValidationError("Reload Workshop to see the current tasks.");
      task.title = command.title;
      if (command.details) task.details = command.details;
      else delete task.details;
      // Drop legacy fields from before tasks were always numbered.
      delete task.priority;
      delete task.numbered;
      break;
    }
    case "removeTask":
      if (!item.checklist.some((entry) => entry.id === command.taskId))
        throw new ValidationError("Reload Workshop to see the current tasks.");
      item.checklist = item.checklist.filter(
        (entry) => entry.id !== command.taskId,
      );
      break;
    case "moveTask": {
      const from = item.checklist.findIndex(
        (entry) => entry.id === command.taskId,
      );
      const to = item.checklist.findIndex((entry) => entry.id === command.to);
      if (from < 0 || to < 0)
        throw new ValidationError("Reload Workshop to see the current tasks.");
      const [task] = item.checklist.splice(from, 1);
      item.checklist.splice(to, 0, task);
      break;
    }
    case "addDoc":
      if (item.docs.length >= maxDocs)
        throw new ValidationError(
          `An item can have at most ${maxDocs} documents.`,
        );
      item.docs.push({
        id: randomUUID(),
        title: command.title,
        body: command.body,
      });
      break;
    case "editDoc": {
      const doc = item.docs.find((entry) => entry.id === command.docId);
      if (!doc) throw new NotFoundError("Document no longer exists.");
      doc.title = command.title;
      doc.body = command.body;
      break;
    }
    case "removeDoc":
      if (!item.docs.some((entry) => entry.id === command.docId))
        throw new NotFoundError("Document no longer exists.");
      item.docs = item.docs.filter((entry) => entry.id !== command.docId);
      break;
    case "pin":
      if (item.archived || (item.kind === "project" && item.status === "Built"))
        throw new ValidationError("Only active items can be pinned.");
      if (item.pinned !== command.pinned) {
        item.pinned = command.pinned;
        // Newly pinned items lead the Pinned section.
        if (command.pinned) {
          clearOrder(snapshot, item.kind, item.id);
          moveToTop(snapshot, item);
        }
      }
      break;
    case "setKind":
      if (item.archived)
        throw new ValidationError("Restore the item before converting it.");
      if (item.kind !== command.kind) {
        if (command.kind === "project") promote(snapshot, item);
        else demote(snapshot, item);
      }
      break;
    case "setStatus": {
      const allowed: readonly string[] =
        item.kind === "idea" ? ideaStatuses : projectStatuses;
      if (item.archived || !allowed.includes(command.status))
        throw new ValidationError(
          item.kind === "idea"
            ? "Convert the idea to a project to use that stage."
            : "Select a project stage.",
        );
      if (command.status === "Built") markBuilt(snapshot, item);
      else item.status = command.status;
      break;
    }
    case "promote":
      if (item.archived || item.kind !== "idea")
        throw new ValidationError("Select an active idea to promote.");
      if (command.draft) Object.assign(item, command.draft);
      promote(snapshot, item);
      break;
    case "archive":
      item.archived = true;
      clearOrder(snapshot, item.kind, item.id);
      for (const section of focusSections)
        clearOrder(snapshot, section, item.id);
      break;
    case "unarchive":
      if (item.archived) {
        item.archived = false;
        moveToTop(snapshot, item);
      }
      break;
    case "delete":
      // Archived items are in no order; active ones leave their list and Focus.
      clearOrder(snapshot, item.kind, item.id);
      for (const section of focusSections)
        clearOrder(snapshot, section, item.id);
      snapshot.items = snapshot.items.filter((entry) => entry.id !== item.id);
      break;
  }
}

function syncDirectory(directory: string) {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function saveRecovery(current: string) {
  try {
    const folder = resolveExpected(`${namespace}/recovery`);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const name = `before-restore-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`;
    atomicWrite(path.join(folder, name), current);
    // Persist the recovery rename and directory entry before touching the current snapshot.
    syncDirectory(folder);
    syncDirectory(path.dirname(folder));
    syncDirectory(path.dirname(path.dirname(folder)));
    return name;
  } catch (error) {
    throw new Error(
      "Could not save a Workshop recovery copy. Restore was canceled.",
      { cause: error },
    );
  }
}

export async function writeWorkshop(hash: string, command: Operation) {
  const file = resolveExpected(`${namespace}/snapshot.json`);
  const lockPath = resolveExpected(`${namespace}/snapshot.lock`);
  let recovery: string | undefined;
  try {
    const result = await withFileLock(
      file,
      hash,
      (current) => {
        if (command.operation === "restore") {
          const next = serialize(snapshotSchema.parse(command.snapshot));
          recovery = saveRecovery(current);
          return next;
        }
        const snapshot = snapshotSchema.parse(JSON.parse(current));
        apply(snapshot, command);
        return serialize(snapshotSchema.parse(snapshot));
      },
      { initialText, lockPath },
    );
    return {
      snapshot: snapshotSchema.parse(JSON.parse(result.text)),
      hash: result.hash,
      recovery,
    };
  } catch (error) {
    if (error instanceof ConflictError)
      throw new ConflictError(
        "Workshop changed since this view was opened. Reload the latest data and review your changes.",
      );
    throw error;
  }
}
