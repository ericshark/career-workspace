"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowUpDownIcon,
  LightbulbIcon,
  MoreHorizontalIcon,
  PinIcon,
  PlusIcon,
  TagsIcon,
  WrenchIcon,
} from "lucide-react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CategoryDialog } from "@/components/workshop/CategoryDialog";
import { ItemEditor } from "@/components/workshop/ItemEditor";
import { ItemView } from "@/components/workshop/ItemView";
import { DocViewer } from "@/components/workshop/docs";
import { type CardActions } from "@/components/workshop/focus";
import { type BoardDrop } from "@/components/workshop/Sortable";
import { type TaskHandlers } from "@/components/workshop/tasks";
import {
  FocusBoard,
  ItemList,
  type ProjectSort,
  type WorkshopView,
} from "@/components/workshop/ItemList";
import { Failure, workshopRequest } from "@/components/workshop/controls";
import {
  type FocusSection,
  type IdeaSort,
  type Item,
  type Kind,
  type Operation,
  type WorkshopData,
} from "@/lib/workshop/model";

const lists = [
  { value: "focus", label: "Focus", icon: PinIcon },
  { value: "project", label: "Projects", icon: WrenchIcon },
  { value: "idea", label: "Ideas", icon: LightbulbIcon },
] as const;

const listCopy = {
  idea: { empty: "Capture an idea to get started." },
  project: { empty: "Add a project to get started." },
  archive: {
    empty: "Archived items will appear here.",
  },
};

type Dialog = "categories";

export default function WorkshopPage() {
  const [data, setData] = useState<WorkshopData | null>(null);
  const [view, setView] = useState<WorkshopView>("focus");
  const [previous, setPrevious] =
    useState<Exclude<WorkshopView, "archive">>("focus");
  const [ideaSort, setIdeaSort] = useState<IdeaSort>("highest");
  const [projectSort, setProjectSort] = useState<ProjectSort>("manual");
  const [groupProjects, setGroupProjects] = useState(false);
  // Item open in the view popup, by id so it follows saves.
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Tab the popup opens on: the linked-folder icon goes straight to Dev.
  const [viewingTab, setViewingTab] = useState<"overview" | "dev">("overview");
  // Kind of the item being created in the editor, when adding a new one.
  const [creating, setCreating] = useState<Kind | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Doc open in the viewer from Focus or a list row, by id so it follows saves.
  const [viewingDoc, setViewingDoc] = useState<{
    itemId: string;
    docId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    const latest = await workshopRequest<WorkshopData>();
    setData(latest);
    setFailure("");
    return latest;
  }, []);
  // Sort and grouping are remembered per browser, read after mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("workshop:projectSort");
      if (saved === "alphabetical" || saved === "category")
        setProjectSort(saved);
      setGroupProjects(localStorage.getItem("workshop:projectGroup") === "1");
    } catch {}
  }, []);
  function rememberProjectView(sort: ProjectSort, group: boolean) {
    setProjectSort(sort);
    setGroupProjects(group);
    try {
      localStorage.setItem("workshop:projectSort", sort);
      localStorage.setItem("workshop:projectGroup", group ? "1" : "0");
    } catch {}
  }
  useEffect(() => {
    void reload().catch((error: Error) => setFailure(error.message));
  }, [reload]);

  async function save(command: Operation, hash = data?.hash) {
    const result = await workshopRequest<WorkshopData & { recovery?: string }>(
      "/api/workshop",
      { hash, command },
    );
    setData(result);
    setFailure("");
    return result;
  }
  async function run(command: Operation, success: string) {
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      await save(command);
      setNotice(success);
      return true;
    } catch (error) {
      setFailure((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function switchView(next: WorkshopView) {
    if (next === "archive" && view !== "archive") setPrevious(view);
    setView(next);
  }

  const snapshot = data?.snapshot;
  const collection = view === "idea" || view === "project" ? view : null;
  const itemsById = new Map(snapshot?.items.map((item) => [item.id, item]));
  const itemsInOrder = (order: keyof NonNullable<typeof snapshot>["orders"]) =>
    snapshot?.orders[order].map((id) => itemsById.get(id)!) ?? [];
  // Tab counts: Focus is Working on plus Up next; the others are their active lists.
  const counts: Record<(typeof lists)[number]["value"], number> = {
    focus: snapshot
      ? snapshot.orders.current.length + snapshot.orders.next.length
      : 0,
    project: snapshot?.orders.project.length ?? 0,
    idea: snapshot?.orders.idea.length ?? 0,
  };
  const hasArchived = Boolean(snapshot?.items.some((item) => item.archived));
  const viewedItem = viewingId ? itemsById.get(viewingId) : undefined;
  const openDoc = viewingDoc
    ? itemsById
        .get(viewingDoc.itemId)
        ?.docs.find((doc) => doc.id === viewingDoc.docId)
    : undefined;
  const visible =
    view === "archive"
      ? (snapshot?.items.filter((item) => item.archived).reverse() ?? [])
      : collection
        ? itemsInOrder(collection)
        : [];
  function place(item: Item, section: FocusSection | null) {
    void run(
      { operation: "place", id: item.id, section },
      section === null
        ? "Removed from Focus."
        : section === "current"
          ? "Moved to Working on."
          : "Moved to Up next.",
    );
  }

  // One command per task action so a stale full draft never overwrites other fields.
  const taskHandlers = (item: Item): TaskHandlers => ({
    onToggle: (task, done) =>
      void run(
        { operation: "setTask", id: item.id, taskId: task.id, done },
        done ? "Task done." : "Task reopened.",
      ),
    onEdit: (task, patch) =>
      void run(
        { operation: "editTask", id: item.id, taskId: task.id, ...patch },
        "Task updated.",
      ),
    onRemove: (task) =>
      void run(
        { operation: "removeTask", id: item.id, taskId: task.id },
        "Task removed.",
      ),
    onMove: (taskId, index) => {
      const target = item.checklist[index];
      if (target && target.id !== taskId)
        void run(
          { operation: "moveTask", id: item.id, taskId, to: target.id },
          "Tasks reordered.",
        );
    },
    onAdd: (task) =>
      void run({ operation: "addTask", id: item.id, ...task }, "Task added."),
    onAddMany: (tasks) =>
      void run(
        { operation: "addTasks", id: item.id, tasks },
        `${tasks.length} task${tasks.length === 1 ? "" : "s"} added.`,
      ),
  });

  // Shared by Working on cards, Up next rows, and Ideas/Projects rows.
  const actions: CardActions = {
    busy,
    onEdit: (item) => {
      setViewingTab("overview");
      setViewingId(item.id);
    },
    onOpenDev: (item) => {
      setViewingTab("dev");
      setViewingId(item.id);
    },
    onNotify: setNotice,
    onPlace: place,
    onArchive: (item) =>
      void run({ operation: "archive", id: item.id }, "Item archived."),
    // Confirmation happens in the UI (the delete button turns into a check and X).
    onDelete: (item) =>
      void run({ operation: "delete", id: item.id }, "Item deleted."),
    onSetStatus: (item, status) =>
      void run(
        { operation: "setStatus", id: item.id, status },
        status === "Built" ? "Marked built." : "Project reopened.",
      ),
    onSetKind: (item, kind: Kind) =>
      void run(
        { operation: "setKind", id: item.id, kind },
        kind === "project" ? "Moved to Projects." : "Moved to Ideas.",
      ),
    onOpenDoc: (item, doc) => setViewingDoc({ itemId: item.id, docId: doc.id }),
    onPin: (item, pinned) =>
      void run(
        { operation: "pin", id: item.id, pinned },
        pinned ? "Pinned." : "Unpinned.",
      ),
    taskHandlers,
  };

  // A drop in Working on or Up next places the item beside its new neighbour.
  function dropInFocus({ id, to, neighbour }: BoardDrop) {
    return run(
      {
        operation: "place",
        id,
        section: to as FocusSection,
        ...(neighbour ? { to: neighbour.id, after: neighbour.after } : {}),
      },
      "Order updated.",
    );
  }
  // Ideas and Projects pages: the destination list decides pin, category or
  // Built; the neighbour decides the position.
  async function dropInCollection({ id, from, to, neighbour }: BoardDrop) {
    if (view !== "idea" && view !== "project") return;
    const position = neighbour
      ? { to: neighbour.id, after: neighbour.after }
      : {};
    if (view === "project") {
      const item = itemsById.get(id);
      const live = item ? Boolean(item.liveUrl) : false;
      // Grouped lists are "<section>:<category key>"; plain ones just "<section>".
      const [target, key] = to.split(":");
      const [origin] = from.split(":");
      if (
        (target === "deployed" || target === "local") &&
        (target === "deployed") !== live
      ) {
        // The Live URL decides Deployed versus Local, so it cannot be dragged.
        setNotice("Add or remove the Live URL in Links to change this.");
        return;
      }
      if (projectSort !== "manual" && from === to) {
        setNotice("Projects are sorted; pick Manual to reorder them.");
        return;
      }
      return run(
        {
          operation: "move",
          list: "project",
          id,
          section:
            target === "deployed" || target === "local"
              ? "active"
              : (target as "pinned" | "built"),
          // Dropping into a category subgroup also sets the category.
          ...(key !== undefined
            ? { categoryId: key === "none" ? null : key }
            : {}),
          ...(projectSort === "manual" || origin !== target ? position : {}),
        },
        "Project moved.",
      );
    }
    if (to === "pinned")
      return run(
        { operation: "move", list: "idea", id, section: "pinned", ...position },
        "Pinned.",
      );
    const categoryId = to === "cat:none" ? null : to.slice("cat:".length);
    // The sort decides the order inside a category; only the category can change.
    if (from === to) {
      setNotice(
        "Ideas are ordered by the sort; pick another sort to change it.",
      );
      return;
    }
    return run(
      { operation: "move", list: "idea", id, section: "active", categoryId },
      "Category updated.",
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <WrenchIcon className="size-5 text-primary" /> Workshop
      </h1>
      <Failure
        message={failure}
        onReload={() =>
          void reload().catch((error: Error) => setFailure(error.message))
        }
      />
      <p
        role="status"
        className={
          notice ? "text-sm break-words text-muted-foreground" : "sr-only"
        }
      >
        {notice}
      </p>
      {snapshot && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {view === "archive" ? (
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Archived items
                </h2>
                <Button
                  variant="secondary"
                  className="font-semibold"
                  onClick={() => switchView(previous)}
                >
                  <ArrowLeftIcon /> Back to{" "}
                  {lists.find((list) => list.value === previous)?.label}
                </Button>
              </div>
            ) : (
              <SegmentedControl
                ariaLabel="Workshop view"
                value={view}
                onChange={switchView}
                options={lists.map(({ value, label, icon: Icon }) => ({
                  value,
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Icon className="hidden size-3.5 sm:block" />
                      {label}
                      <span
                        aria-hidden="true"
                        className="text-xs leading-none font-semibold tabular-nums"
                      >
                        {counts[value]}
                      </span>
                    </span>
                  ),
                }))}
              />
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {collection === "idea" && (
                <SortMenu
                  label="Sort ideas"
                  value={ideaSort}
                  onChange={(value) => setIdeaSort(value as IdeaSort)}
                  options={[
                    { value: "highest", label: "Highest rated" },
                    { value: "average", label: "Highest average" },
                    { value: "alphabetical", label: "Alphabetical" },
                  ]}
                />
              )}
              {collection === "project" && (
                <SortMenu
                  label="Sort projects"
                  value={projectSort}
                  onChange={(value) =>
                    rememberProjectView(value as ProjectSort, groupProjects)
                  }
                  options={[
                    { value: "manual", label: "Manual" },
                    { value: "alphabetical", label: "Alphabetical" },
                    {
                      value: "category",
                      label: "Alphabetical by category",
                    },
                  ]}
                  extra={
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={groupProjects}
                        onCheckedChange={(checked) =>
                          rememberProjectView(projectSort, checked === true)
                        }
                      >
                        Group by category
                      </DropdownMenuCheckboxItem>
                    </>
                  }
                />
              )}
              {collection && (
                <Button disabled={busy} onClick={() => setCreating(collection)}>
                  <PlusIcon />{" "}
                  {collection === "idea" ? "Add idea" : "Add project"}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={busy}
                    aria-label="Workshop menu"
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDialog("categories")}>
                    <TagsIcon /> Categories…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    // Nothing to open while the archive is empty.
                    disabled={view !== "archive" && !hasArchived}
                    onSelect={() =>
                      switchView(view === "archive" ? previous : "archive")
                    }
                  >
                    <ArchiveIcon />{" "}
                    {view === "archive" ? "Close archive" : "Archive"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {view === "focus" ? (
            <FocusBoard
              snapshot={snapshot}
              current={itemsInOrder("current")}
              next={itemsInOrder("next")}
              onDrop={dropInFocus}
              {...actions}
            />
          ) : visible.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              {listCopy[view].empty}
            </p>
          ) : (
            <ItemList
              key={view}
              items={visible}
              list={view}
              snapshot={snapshot}
              sort={ideaSort}
              projectSort={projectSort}
              groupProjects={groupProjects}
              {...actions}
              onDrop={dropInCollection}
              onArchiveAction={(item, operation) => {
                const messages = {
                  unarchive: "Item restored.",
                  delete: "Item deleted.",
                };
                void run({ operation, id: item.id }, messages[operation]);
              }}
            />
          )}
        </div>
      )}
      {!data && !failure && (
        <p className="text-sm text-muted-foreground">Loading Workshop…</p>
      )}
      {data && creating && (
        <ItemEditor
          key="new"
          creating={creating}
          data={data}
          onClose={() => setCreating(null)}
          save={save}
          reload={reload}
          notify={setNotice}
        />
      )}
      {data && viewedItem && (
        <ItemView
          key={viewedItem.id}
          item={viewedItem}
          initialTab={viewingTab}
          category={
            data.snapshot.categories.find(
              (entry) => entry.id === viewedItem.categoryId,
            )?.name ?? "Uncategorized"
          }
          placement={
            data.snapshot.orders.current.includes(viewedItem.id)
              ? "current"
              : data.snapshot.orders.next.includes(viewedItem.id)
                ? "next"
                : null
          }
          data={data}
          actions={actions}
          save={save}
          reload={reload}
          onRestore={(item) =>
            void run({ operation: "unarchive", id: item.id }, "Item restored.")
          }
          onClose={() => setViewingId(null)}
        />
      )}
      {viewingDoc && openDoc && (
        <DocViewer
          doc={openDoc}
          onClose={() => setViewingDoc(null)}
          onSave={(title, body) =>
            run(
              {
                operation: "editDoc",
                id: viewingDoc.itemId,
                docId: viewingDoc.docId,
                title,
                body,
              },
              "Doc saved.",
            )
          }
        />
      )}
      {data && dialog === "categories" && (
        <CategoryDialog
          snapshot={data.snapshot}
          save={save}
          reload={reload}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** Compact Sort button: one click opens the choices (and any extra options). */
function SortMenu({
  label,
  value,
  onChange,
  options,
  extra,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  extra?: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={label}>
          <ArrowUpDownIcon /> Sort
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {extra}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
