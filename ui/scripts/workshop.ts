// Deterministic CLI for adding and updating Workshop ideas and projects from chat
// (run via scripts/workshop.sh). Every write goes through the same locked, hash-checked
// writeWorkshop the UI uses, so the skill never edits ui/.workshop/snapshot.json by hand.
// Output is JSON. Deleting items stays UI-only.
import fs from "node:fs";
import { parseArgs } from "node:util";
import { ConflictError } from "../src/lib/fileStore";
import {
  itemDraft,
  normalizedName,
  type Item,
  type Operation,
  type Snapshot,
} from "../src/lib/workshop/model";
import { readWorkshop, writeWorkshop } from "../src/lib/workshop/store";

const USAGE = `scripts/workshop.sh <command> [options]   (output is JSON)

  list [--kind idea|project] [--archived]        items, newest first within each kind
  categories                                      existing categories
  find QUERY                                      exact / possible title matches, archived included
  add --kind idea|project --title T [--description D] [--category NAME [--create-category]]
      [--rating 0-10 (ideas)]
      [--github URL --local PATH --live URL (projects)] [--link URL]... [--task TITLE]...
      [--doc-title T --doc-file FILE] [--force]   refuses likely duplicates unless --force
  update REF [--title --description --category NAME|none --rating --github --local --live]
  status REF Active|Built                         project stage
  promote REF                                     idea to project, keeping its ID, docs and tasks
  doc REF --title T --file FILE [--append|--replace]   add a doc, or change one with the same title
  tasks REF --task TITLE...                       add numbered checklist tasks
  pin REF [--off]                                 pin or unpin
  archive REF | unarchive REF
REF is an item id or an exact (case-insensitive) title.`;

const die = (message: string): never => {
  console.error(message);
  process.exit(1);
};
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** Applies one operation, retrying when another writer (the UI) changed the file first. */
async function write(command: Operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await writeWorkshop(readWorkshop().hash, command);
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt >= 3) throw error;
    }
  }
}

const brief = (snapshot: Snapshot, item: Item) => ({
  id: item.id,
  kind: item.kind,
  title: item.title,
  status: item.status,
  archived: item.archived,
  pinned: item.pinned,
  category:
    snapshot.categories.find((c) => c.id === item.categoryId)?.name ?? null,
  docs: item.docs.map((doc) => doc.title),
  tasks: item.checklist.length,
});

const words = (value: string) =>
  new Set(
    normalizedName(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );

/** Title similarity: exact, one title containing the other, or half the words shared. */
function matches(snapshot: Snapshot, query: string) {
  const wanted = normalizedName(query);
  const wantedWords = words(query);
  const found: Array<ReturnType<typeof brief> & { match: string }> = [];
  for (const item of snapshot.items) {
    const title = normalizedName(item.title);
    let match = "";
    if (title === wanted) match = "exact";
    else if (title.includes(wanted) || wanted.includes(title))
      match = "possible";
    else {
      const other = words(item.title);
      const shared = [...wantedWords].filter((w) => other.has(w)).length;
      if (shared / Math.max(wantedWords.size, other.size, 1) >= 0.5)
        match = "possible";
    }
    if (match) found.push({ ...brief(snapshot, item), match });
  }
  return found.sort(
    (a, b) => (a.match === "exact" ? -1 : 0) - (b.match === "exact" ? -1 : 0),
  );
}

function resolve(snapshot: Snapshot, ref: string | undefined) {
  if (!ref) return die("Name the item (id or exact title).");
  const byId = snapshot.items.find((item) => item.id === ref);
  if (byId) return byId;
  const same = snapshot.items.filter(
    (item) => normalizedName(item.title) === normalizedName(ref),
  );
  if (same.length === 1) return same[0];
  return die(
    same.length
      ? `More than one item is titled "${ref}"; use an id: ${same.map((i) => i.id).join(", ")}`
      : `No item matches "${ref}". Try: find "${ref}"`,
  );
}

function categoryId(snapshot: Snapshot, name: string, create: boolean) {
  if (/^(none|uncategorized)$/i.test(name)) return { id: null, create: false };
  const found = snapshot.categories.find(
    (c) => normalizedName(c.name) === normalizedName(name),
  );
  if (found) return { id: found.id, create: false };
  if (!create)
    die(
      `No category "${name}". Existing: ${snapshot.categories.map((c) => c.name).join(", ")}. Ask the workspace owner, then add --create-category.`,
    );
  return { id: null, create: true };
}

const readText = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return die(`Cannot read ${file}.`);
  }
};

const PRIORITY_REMOVED = "Priority was removed from Workshop.";

function ratingOf(value: string | undefined) {
  if (value === undefined) return undefined;
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10)
    die("Rating must be a number from 0 to 10.");
  return rating;
}

const options = {
  kind: { type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  category: { type: "string" },
  "create-category": { type: "boolean" },
  rating: { type: "string" },
  priority: { type: "string" },
  github: { type: "string" },
  local: { type: "string" },
  live: { type: "string" },
  link: { type: "string", multiple: true },
  task: { type: "string", multiple: true },
  "doc-title": { type: "string" },
  "doc-file": { type: "string" },
  file: { type: "string" },
  append: { type: "boolean" },
  replace: { type: "boolean" },
  archived: { type: "boolean" },
  off: { type: "boolean" },
  force: { type: "boolean" },
} as const;

async function main() {
  const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options,
  });
  const [cmd, arg] = positionals;
  const { snapshot } = readWorkshop();

  switch (cmd) {
    case "list": {
      const items = snapshot.items.filter(
        (item) =>
          (!o.kind || item.kind === o.kind) &&
          (o.archived ? item.archived : !item.archived),
      );
      return print(items.map((item) => brief(snapshot, item)));
    }
    case "categories":
      return print(snapshot.categories.map((c) => c.name));
    case "find":
      return print(matches(snapshot, arg ?? die("Give a title to find.")));
    case "add": {
      if (o.kind !== "idea" && o.kind !== "project")
        die("Use --kind idea or --kind project.");
      const kind = o.kind as "idea" | "project";
      const title = (o.title ?? "").trim();
      if (!title) die("Give --title.");
      const dupes = matches(snapshot, title);
      if (dupes.length && !o.force) {
        print({ added: false, reason: "possible duplicate", matches: dupes });
        process.exit(2);
      }
      if (o.priority !== undefined) die(PRIORITY_REMOVED);
      if (kind === "idea" && (o.github || o.local || o.live))
        die("Ideas cannot have repo links; add them to a project.");
      if (kind === "project" && o.rating !== undefined)
        die("Only ideas have a rating.");
      const category = o.category
        ? categoryId(snapshot, o.category, !!o["create-category"])
        : { id: null, create: false };
      const rating = ratingOf(o.rating);
      const doc = o["doc-file"] ? readText(o["doc-file"]) : undefined;
      if (o["doc-file"] && !o["doc-title"])
        die("Give --doc-title with --doc-file.");

      if (category.create)
        await write({ operation: "saveCategory", name: o.category! });
      const before = new Set(snapshot.items.map((item) => item.id));
      const afterAdd = await write({ operation: "add", kind, title });
      const created = afterAdd.snapshot.items.find((i) => !before.has(i.id))!;
      const catId = category.create
        ? afterAdd.snapshot.categories.find(
            (c) => normalizedName(c.name) === normalizedName(o.category!),
          )!.id
        : category.id;
      await write({
        operation: "edit",
        id: created.id,
        draft: {
          ...itemDraft(created),
          description: o.description ?? "",
          categoryId: catId,
          ideaRating: rating ?? null,
          links: o.link ?? [],
          githubUrl: o.github ?? "",
          localFolder: o.local ?? "",
          liveUrl: o.live ?? "",
        },
      });
      if (o.task?.length)
        await write({
          operation: "addTasks",
          id: created.id,
          tasks: o.task.map((t) => ({ title: t })) as never,
        });
      if (doc !== undefined)
        await write({
          operation: "addDoc",
          id: created.id,
          title: o["doc-title"]!,
          body: doc,
        });
      const final = readWorkshop().snapshot;
      return print({
        added: true,
        ...brief(
          final,
          final.items.find((i) => i.id === created.id)!,
        ),
      });
    }
    case "update": {
      const item = resolve(snapshot, arg);
      const draft = itemDraft(item);
      if (o.title !== undefined) draft.title = o.title;
      if (o.description !== undefined) draft.description = o.description;
      if (o.category !== undefined)
        draft.categoryId = categoryId(snapshot, o.category, false).id;
      if (o.rating !== undefined) {
        if (item.kind !== "idea") die("Only ideas have a rating.");
        draft.ideaRating = ratingOf(o.rating);
      }
      if (o.priority !== undefined) die(PRIORITY_REMOVED);
      for (const [flag, field] of [
        ["github", "githubUrl"],
        ["local", "localFolder"],
        ["live", "liveUrl"],
      ] as const) {
        if (o[flag] === undefined) continue;
        if (item.kind !== "project") die("Only projects have repo links.");
        draft[field] = o[flag]!;
      }
      if (o.link) draft.links = [...new Set([...draft.links, ...o.link])];
      await write({ operation: "edit", id: item.id, draft });
      const final = readWorkshop().snapshot;
      return print(
        brief(
          final,
          final.items.find((i) => i.id === item.id)!,
        ),
      );
    }
    case "status": {
      const item = resolve(snapshot, arg);
      const status = positionals[2];
      if (status !== "Active" && status !== "Built")
        die("Status must be Active or Built.");
      await write({
        operation: "setStatus",
        id: item.id,
        status: status as "Active",
      });
      return print({ id: item.id, status });
    }
    case "promote": {
      const item = resolve(snapshot, arg);
      await write({ operation: "promote", id: item.id });
      return print({ id: item.id, kind: "project" });
    }
    case "doc": {
      const item = resolve(snapshot, arg);
      if (!o.title || !o.file) die("Give --title and --file.");
      const body = readText(o.file!);
      const existing = item.docs.find(
        (d) => normalizedName(d.title) === normalizedName(o.title!),
      );
      if (existing && !o.append && !o.replace) {
        print({
          saved: false,
          reason: `A doc titled "${existing.title}" already exists; use --append or --replace.`,
        });
        process.exit(2);
      }
      if (existing)
        await write({
          operation: "editDoc",
          id: item.id,
          docId: existing.id,
          title: existing.title,
          body: o.append ? `${existing.body.trimEnd()}\n\n${body}` : body,
        });
      else
        await write({
          operation: "addDoc",
          id: item.id,
          title: o.title!,
          body,
        });
      return print({ saved: true, id: item.id, doc: o.title });
    }
    case "tasks": {
      const item = resolve(snapshot, arg);
      if (!o.task?.length) die("Give at least one --task.");
      await write({
        operation: "addTasks",
        id: item.id,
        tasks: o.task!.map((title) => ({ title })),
      });
      return print({ id: item.id, added: o.task!.length });
    }
    case "pin": {
      const item = resolve(snapshot, arg);
      await write({ operation: "pin", id: item.id, pinned: !o.off });
      return print({ id: item.id, pinned: !o.off });
    }
    case "archive":
    case "unarchive": {
      const item = resolve(snapshot, arg);
      await write({ operation: cmd, id: item.id });
      return print({ id: item.id, archived: cmd === "archive" });
    }
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
