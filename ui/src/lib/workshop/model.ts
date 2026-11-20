import { z } from "zod";

export const ideaStatuses = ["Saved"] as const;
export const projectStatuses = ["Active", "Built"] as const;
// Stages used by version 1 and 2 snapshots; migrated on read.
const legacyStatuses = [
  "Saved",
  "Exploring",
  "Planned",
  "In Progress",
  "On Hold",
  "Completed",
] as const;
export const priorities = ["High", "Medium", "Low"] as const;

const kind = z.enum(["idea", "project"]);
const title = z.string().trim().min(1, "Enter a title.").max(200);
const categoryName = z.string().trim().min(1, "Enter a category name.").max(80);
const id = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const status = z.enum([...ideaStatuses, ...projectStatuses]);
const legacyStatus = z.enum(legacyStatuses);
const text = z.string().trim().max(20_000);

export const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!/^https?:\/\//i.test(value)) return false;
    try {
      const url = new URL(value);
      return !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS URL without credentials.");

export function githubIdentity(value: string) {
  const match = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/i.exec(
    value,
  );
  if (!match) return null;
  const repo = match[2].replace(/\.git$/i, "");
  return [match[1], repo].every((part) => part && part !== "." && part !== "..")
    ? `${match[1]}/${repo}`.toLowerCase()
    : null;
}

const githubUrl = httpUrl.refine(
  (value) => githubIdentity(value) !== null,
  "Enter a GitHub repository URL (owner/repository).",
);
const repoFields = {
  githubUrl: githubUrl.or(z.literal("")),
  localFolder: z.string().trim().max(4096),
  liveUrl: httpUrl.or(z.literal("")),
  deployed: z.boolean(),
};
const orderedSteps = (label: string) =>
  z
    .array(
      z.strictObject({
        id,
        title: z
          .string()
          .trim()
          .min(1, "Enter a title for each step.")
          .max(500),
        done: z.boolean(),
        // Optional second line shown under the task title.
        details: z.string().trim().max(1000).optional(),
        // Legacy fields from before tasks were always numbered with no priority:
        // still accepted when reading old data, ignored, and dropped on edit.
        numbered: z.boolean().optional(),
        priority: z.enum(priorities).optional(),
      }),
    )
    .max(200)
    .refine(
      (steps) => new Set(steps.map((step) => step.id)).size === steps.length,
      `${label} IDs must be unique.`,
    );

function validCollectionFields(item: {
  kind: Kind;
  status: Status;
  githubUrl: string;
  localFolder: string;
  liveUrl: string;
  deployed: boolean;
}) {
  return item.kind === "project"
    ? projectStatuses.some((status) => status === item.status)
    : // Ideas may hold the same links as projects; only the status differs.
      ideaStatuses.some((status) => status === item.status);
}

const draftFields = {
  title,
  description: text,
  categoryId: id.nullable(),
  ideaRating: z.number().min(0).max(10).nullable().optional(),
  links: z.array(httpUrl).max(100),
  checklist: orderedSteps("Task"),
  status,
  ...repoFields,
};
const milestones = orderedSteps("Milestone");
const draftSchema = z.strictObject({ ...draftFields, milestones });

/**
 * Named documents pasted onto an item (a spec, research, grill notes). Bodies
 * keep their exact text so Copy returns what was pasted. They live outside the
 * editor draft and change only through the doc operations, so saving the
 * editor never resends large bodies.
 */
export const docTitle = z
  .string()
  .trim()
  .min(1, "Enter a document title.")
  .max(120);
export const docBody = z
  .string()
  .max(200_000, "Documents can be at most 200,000 characters.")
  .refine((value) => value.trim().length > 0, "Paste the document text.");
export const maxDocs = 20;
const docs = z
  .array(z.strictObject({ id, title: docTitle, body: docBody }))
  .max(maxDocs)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.id)).size === entries.length,
    "Document IDs must be unique.",
  );

// Items before version 4 carried free-text notes, since replaced by docs.
const legacyDraftFields = { ...draftFields, notes: text };
// Version 1 and 2 items: the old stage names and no pin.
const legacyItemSchema = z.strictObject({
  id,
  kind,
  archived: z.boolean(),
  ...legacyDraftFields,
  status: legacyStatus,
});
// Version 3 items: current stages and pins, notes instead of docs.
const v3ItemSchema = z.strictObject({
  id,
  kind,
  archived: z.boolean(),
  pinned: z.boolean(),
  ...legacyDraftFields,
  milestones,
});
const category = z.strictObject({ id, name: categoryName });
const itemSchema = z
  .strictObject({
    id,
    kind,
    archived: z.boolean(),
    pinned: z.boolean(),
    ...draftFields,
    milestones,
    docs,
  })
  .refine(
    (item) =>
      validCollectionFields(item) &&
      (item.kind === "project" || !item.milestones.length),
    "Item fields must match its collection.",
  );

export function normalizedName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const currentSnapshotSchema = z
  .strictObject({
    version: z.literal(4),
    categories: z.array(category),
    items: z.array(itemSchema),
    orders: z.strictObject({
      idea: z.array(id),
      project: z.array(id),
      current: z.array(id),
      next: z.array(id),
    }),
  })
  .superRefine((snapshot, ctx) => {
    const { items, categories, orders } = snapshot;
    const byId = new Map(items.map((item) => [item.id, item]));
    const categoryIds = new Set(categories.map((entry) => entry.id));
    const names = new Set(
      categories.map((entry) => normalizedName(entry.name)),
    );
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (byId.size !== items.length || categoryIds.size !== categories.length)
      issue("Item and category IDs must be unique.");
    if (names.size !== categories.length || names.has("uncategorized"))
      issue("Category names must be unique and cannot be Uncategorized.");
    if (
      items.some((item) => item.categoryId && !categoryIds.has(item.categoryId))
    )
      issue("An item references a missing category.");
    const current = new Set(orders.current);
    if (orders.next.some((id) => current.has(id)))
      issue("An item can only be in one Focus section.");
    for (const list of ["idea", "project", "current", "next"] as const) {
      const collection = list === "idea" || list === "project";
      const order = new Set(orders[list]);
      if (
        order.size !== orders[list].length ||
        orders[list].some((id) => {
          const item = byId.get(id);
          return !item || item.archived || (collection && item.kind !== list);
        }) ||
        (collection &&
          items.some(
            (item) =>
              !item.archived && item.kind === list && !order.has(item.id),
          ))
      ) {
        issue(`Invalid ${list} order.`);
      }
    }
  });

type LegacyItem = z.infer<typeof legacyItemSchema> & {
  milestones: z.infer<typeof milestones>;
};
type Orders = {
  idea: string[];
  project: string[];
  current: string[];
  next: string[];
};

type V3Item = z.infer<typeof v3ItemSchema>;
type CurrentItem = z.input<typeof itemSchema>;

/**
 * Version 4 drops notes. Backlog imports kept the original rating there as
 * "Original rating: N/10", so an unset rating is recovered from it first; any
 * other note text is discarded.
 */
function dropNotes({ notes, ...item }: V3Item): CurrentItem {
  if (item.ideaRating === undefined) {
    const match = /^Original rating: (\d+(?:\.\d+)?)\/10\s*$/m.exec(notes);
    const rating = match ? Number(match[1]) : null;
    if (rating !== null && rating <= 10) item.ideaRating = rating;
  }
  return { ...item, docs: [] };
}

// Old stages collapse: ideas are just Saved; finished projects are Built and
// every other project is Active.
function migrateItem(item: LegacyItem): CurrentItem {
  const stage =
    item.kind === "idea"
      ? "Saved"
      : item.status === "Completed"
        ? "Built"
        : "Active";
  return dropNotes({ ...item, status: stage, pinned: false });
}

const legacyV2SnapshotSchema = z
  .strictObject({
    version: z.literal(2),
    categories: z.array(category),
    items: z.array(z.strictObject({ ...legacyItemSchema.shape, milestones })),
    orders: z.strictObject({
      idea: z.array(id),
      project: z.array(id),
      current: z.array(id),
      next: z.array(id),
    }),
  })
  .transform(
    ({ categories, items, orders }): z.input<typeof currentSnapshotSchema> => ({
      version: 4 as const,
      categories,
      items: items.map(migrateItem),
      orders,
    }),
  );

const legacyV3SnapshotSchema = z
  .strictObject({
    version: z.literal(3),
    categories: z.array(category),
    items: z.array(v3ItemSchema),
    orders: z.strictObject({
      idea: z.array(id),
      project: z.array(id),
      current: z.array(id),
      next: z.array(id),
    }),
  })
  .transform(
    ({ categories, items, orders }): z.input<typeof currentSnapshotSchema> => ({
      version: 4 as const,
      categories,
      items: items.map(dropNotes),
      orders,
    }),
  );

const legacyV1SnapshotSchema = z
  .strictObject({
    version: z.literal(1),
    categories: z.array(category),
    items: z.array(legacyItemSchema),
    orders: z.strictObject({
      idea: z.array(id),
      project: z.array(id),
      focus: z.array(id),
    }),
  })
  .transform(
    ({ categories, items, orders }): z.input<typeof currentSnapshotSchema> => {
      const migrated: Orders = {
        idea: orders.idea,
        project: orders.project,
        current: orders.focus,
        next: [],
      };
      return {
        version: 4 as const,
        categories,
        items: items.map((item) => migrateItem({ ...item, milestones: [] })),
        orders: migrated,
      };
    },
  );

/**
 * Items used to carry an optional High/Medium/Low priority. It was removed, so
 * snapshots and backups that still hold one are read without it; the next write
 * drops it from the file.
 */
function stripPriority(raw: unknown) {
  if (typeof raw !== "object" || raw === null || !("items" in raw)) return raw;
  const { items } = raw as { items: unknown };
  if (!Array.isArray(items)) return raw;
  return {
    ...raw,
    items: items.map((item) => {
      if (typeof item !== "object" || item === null || !("priority" in item))
        return item;
      const { priority: _priority, ...rest } = item as Record<string, unknown>;
      return rest;
    }),
  };
}

export const snapshotSchema = z.preprocess(
  stripPriority,
  z.union([
    legacyV1SnapshotSchema.pipe(currentSnapshotSchema),
    legacyV2SnapshotSchema.pipe(currentSnapshotSchema),
    legacyV3SnapshotSchema.pipe(currentSnapshotSchema),
    currentSnapshotSchema,
  ]),
);

export type Kind = z.infer<typeof kind>;
export type Status = z.infer<typeof status>;
export type Draft = z.infer<typeof draftSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Doc = Item["docs"][number];
export type Snapshot = z.infer<typeof snapshotSchema>;
export const focusSections = ["current", "next"] as const;
export type FocusSection = (typeof focusSections)[number];
export type Order = keyof Snapshot["orders"];

export function statusLabel(status: Status) {
  return status === "Saved" ? "Idea" : status;
}

/** Sections of the Ideas and Projects pages. Ideas only use pinned and active. */
export const collectionSections = ["pinned", "active", "built"] as const;
export type CollectionSection = (typeof collectionSections)[number];

export function sectionOf(item: Item): CollectionSection {
  if (item.kind === "project" && item.status === "Built") return "built";
  return item.pinned ? "pinned" : "active";
}

/** Sections of the Projects page: Built wins, then Pinned, then Live URL decides. */
export type ProjectSection = "pinned" | "deployed" | "local" | "built";

export function projectSection(item: Item): ProjectSection {
  if (item.status === "Built") return "built";
  if (item.pinned) return "pinned";
  return item.liveUrl ? "deployed" : "local";
}

export const ideaSorts = ["alphabetical", "highest", "average"] as const;
export type IdeaSort = (typeof ideaSorts)[number];

type IdeaGroup<T extends Item> = {
  name: string;
  categoryId: string | null;
  items: T[];
};

/**
 * Orders category groups and the ideas inside them. Alphabetical sorts both by
 * name (Uncategorized first); the rating sorts rank groups by their best idea or
 * by the average of their rated ideas, with unrated groups last.
 */
export function sortIdeaGroups<T extends Item>(
  groups: IdeaGroup<T>[],
  sort: IdeaSort,
): IdeaGroup<T>[] {
  const byName = (left: string, right: string) =>
    left.localeCompare(right, undefined, { sensitivity: "base" });
  const rated = (item: Item) => ideaRating(item) ?? -1;
  const score = (group: IdeaGroup<T>) => {
    const ratings = group.items
      .map((item) => ideaRating(item))
      .filter((value): value is number => value !== null);
    if (!ratings.length) return null;
    return sort === "highest"
      ? Math.max(...ratings)
      : ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  };
  const inner = groups.map((group) => ({
    ...group,
    items: [...group.items].sort((left, right) =>
      sort === "alphabetical"
        ? byName(left.title, right.title)
        : rated(right) - rated(left) || byName(left.title, right.title),
    ),
  }));
  return inner.sort((left, right) => {
    // Uncategorized leads every sort: it holds the items still to be sorted.
    if (!left.categoryId !== !right.categoryId) return left.categoryId ? 1 : -1;
    if (sort === "alphabetical") return byName(left.name, right.name);
    const a = score(left);
    const b = score(right);
    if (a === null || b === null)
      return a === b ? byName(left.name, right.name) : a === null ? 1 : -1;
    return b - a || byName(left.name, right.name);
  });
}

/**
 * Orders items by title but keeps each category together: categories take the
 * place of their alphabetically first title, and items inside follow by title.
 * (Titles A, B, C with A and C in one category give A, C, B.)
 */
export function sortByCategoryThenTitle<
  T extends { title: string; categoryId: string | null },
>(items: T[]): T[] {
  const byName = (left: string, right: string) =>
    left.localeCompare(right, undefined, { sensitivity: "base" });
  const first = new Map<string | null, string>();
  for (const item of items) {
    const current = first.get(item.categoryId);
    if (current === undefined || byName(item.title, current) < 0)
      first.set(item.categoryId, item.title);
  }
  return [...items].sort(
    (left, right) =>
      byName(first.get(left.categoryId)!, first.get(right.categoryId)!) ||
      String(left.categoryId).localeCompare(String(right.categoryId)) ||
      byName(left.title, right.title),
  );
}

export function milestoneProgress(milestones: Item["milestones"]) {
  return {
    total: milestones.length,
    completed: milestones.filter((milestone) => milestone.done).length,
    current: milestones.find((milestone) => !milestone.done),
  };
}
export type WorkshopData = { snapshot: Snapshot; hash: string };

export function newDraft(kind: Kind, title = ""): Draft {
  return {
    title,
    status: kind === "idea" ? "Saved" : "Active",
    description: "",
    categoryId: null,
    links: [],
    checklist: [],
    milestones: [],
    githubUrl: "",
    localFolder: "",
    liveUrl: "",
    deployed: false,
  };
}

export function itemDraft({
  id: _id,
  kind: _kind,
  archived: _archived,
  pinned: _pinned,
  docs: _docs,
  ...draft
}: Item): Draft {
  return draft;
}

export function ideaRating(draft: Pick<Draft, "ideaRating">) {
  return draft.ideaRating ?? null;
}

export function indicator(item: Item) {
  if (item.kind === "idea") return "Just an idea";
  if (item.liveUrl) return "Deployed";
  if (item.githubUrl) return "Remote repo";
  if (item.localFolder) return "Local repo";
  return "No repo linked";
}

export const generatedTask = z.strictObject({
  title: z.string().trim().min(1, "Enter a task.").max(500),
  details: z.string().trim().max(1000).optional(),
});

/**
 * Splits tasks for display: open tasks, all numbered by position (numbers close
 * up when one is completed and a reopened task returns to its place), and the
 * completed ones.
 */
export function taskGroups<T extends { done: boolean }>(tasks: T[]) {
  return {
    open: tasks.filter((task) => !task.done),
    done: tasks.filter((task) => task.done),
  };
}

const operations = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("add"), kind, title }),
  z.strictObject({ operation: z.literal("edit"), id, draft: draftSchema }),
  z.strictObject({
    operation: z.literal("place"),
    id,
    section: z.enum(focusSections).nullable(),
    // Drop position: next to this item (after it when `after` is true).
    to: id.optional(),
    after: z.boolean().optional(),
  }),
  z.strictObject({ operation: z.literal("completeTask"), id, taskId: id }),
  // Focus card operations: they touch one field, so a quick tick or stage
  // change never overwrites other fields with a stale full draft.
  z.strictObject({
    operation: z.literal("setTask"),
    id,
    taskId: id,
    done: z.boolean(),
  }),
  z.strictObject({
    operation: z.literal("addTask"),
    id,
    title: z.string().trim().min(1, "Enter a task.").max(500),
    details: z.string().trim().max(1000).optional(),
  }),
  z.strictObject({
    operation: z.literal("addTasks"),
    id,
    tasks: z.array(generatedTask).min(1).max(50),
  }),
  z.strictObject({
    operation: z.literal("editTask"),
    id,
    taskId: id,
    title: z.string().trim().min(1, "Enter a task.").max(500),
    details: z.string().trim().max(1000),
  }),
  z.strictObject({ operation: z.literal("removeTask"), id, taskId: id }),
  // Drops the task into the place of another task on the same item.
  z.strictObject({ operation: z.literal("moveTask"), id, taskId: id, to: id }),
  z.strictObject({ operation: z.literal("pin"), id, pinned: z.boolean() }),
  z.strictObject({
    operation: z.literal("addDoc"),
    id,
    title: docTitle,
    body: docBody,
  }),
  z.strictObject({
    operation: z.literal("editDoc"),
    id,
    docId: id,
    title: docTitle,
    body: docBody,
  }),
  z.strictObject({ operation: z.literal("removeDoc"), id, docId: id }),
  z.strictObject({ operation: z.literal("setKind"), id, kind }),
  z.strictObject({ operation: z.literal("setStatus"), id, status }),
  z.strictObject({
    operation: z.literal("promote"),
    id,
    draft: draftSchema.optional(),
  }),
  z.strictObject({
    operation: z.enum(["archive", "unarchive", "delete"]),
    id,
  }),
  z.strictObject({
    operation: z.literal("move"),
    list: z.enum(["idea", "project", ...focusSections]),
    id,
    to: id.optional(),
    // With `after`, `to` is a neighbour to land beside instead of an index to take.
    after: z.boolean().optional(),
    categoryId: id.nullable().optional(),
    // Dropping into a page section pins, unpins, or marks a project Built.
    section: z.enum(collectionSections).optional(),
  }),
  z.strictObject({
    operation: z.literal("moveCategory"),
    id,
    to: id,
  }),
  z.strictObject({
    operation: z.literal("saveCategory"),
    id: id.optional(),
    name: categoryName,
  }),
  z.strictObject({ operation: z.literal("deleteCategory"), id }),
  z.strictObject({ operation: z.literal("restore"), snapshot: snapshotSchema }),
]);
export type Operation = z.infer<typeof operations>;
export const commandSchema = z.strictObject({ hash, command: operations });

// Only backup replacement previews remain; backup restore is API-only.
export const previewSchema = z.strictObject({
  source: z.literal("backup"),
  snapshot: snapshotSchema,
});

export function summarize(snapshot: Snapshot) {
  return {
    ideas: snapshot.orders.idea.length,
    projects: snapshot.orders.project.length,
    archived: snapshot.items.filter((item) => item.archived).length,
    categories: snapshot.categories.length,
    current: snapshot.orders.current.length,
    next: snapshot.orders.next.length,
  };
}
