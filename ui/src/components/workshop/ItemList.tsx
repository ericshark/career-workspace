"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ideaRating,
  projectSection,
  sortByCategoryThenTitle,
  sortIdeaGroups,
  type FocusSection,
  type IdeaSort,
  type ProjectSection,
  type Item,
  type Snapshot,
} from "@/lib/workshop/model";
import { CompactRow, WorkingOnRow, type CardActions } from "./focus";
import { ConfirmInline } from "./ConfirmInline";
import {
  SortableBoard,
  SortableContainer,
  SortableItem,
  type BoardContainer,
  type BoardDrop,
} from "./Sortable";

export type ProjectSort = "manual" | "alphabetical" | "category";
export type WorkshopView = "focus" | "idea" | "project" | "archive";

function placementFor(snapshot: Snapshot, id: string): FocusSection | null {
  if (snapshot.orders.current.includes(id)) return "current";
  return snapshot.orders.next.includes(id) ? "next" : null;
}

function categoryName(snapshot: Snapshot, item: Item) {
  return (
    snapshot.categories.find(({ id }) => id === item.categoryId)?.name ??
    "Uncategorized"
  );
}

const dropHint = (text: string) => (
  <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
    {text}
  </p>
);

export function FocusBoard({
  snapshot,
  current,
  next,
  onDrop,
  ...actions
}: CardActions & {
  snapshot: Snapshot;
  current: Item[];
  next: Item[];
  onDrop: (drop: BoardDrop) => unknown;
}) {
  // Up next is open by default; the choice is remembered in this browser.
  const [upNextOpen, setUpNextOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("workshop:upNextOpen") === "0")
        setUpNextOpen(false);
    } catch {}
  }, []);
  function toggleUpNext() {
    const next = !upNextOpen;
    setUpNextOpen(next);
    try {
      localStorage.setItem("workshop:upNextOpen", next ? "1" : "0");
    } catch {}
  }
  const byId = new Map([...current, ...next].map((item) => [item.id, item]));
  const containers: BoardContainer[] = [
    { id: "current", itemIds: current.map((item) => item.id) },
    { id: "next", itemIds: next.map((item) => item.id) },
  ];
  return (
    <SortableBoard
      containers={containers}
      labelOf={(id) => byId.get(id)?.title ?? "item"}
      disabled={actions.busy}
      onDrop={onDrop}
      overlay={(id) => {
        const item = byId.get(id)!;
        return snapshot.orders.current.includes(id) ? (
          <div className="rounded-xl shadow-xl ring-1 ring-primary/30">
            <WorkingOnRow
              item={item}
              category={categoryName(snapshot, item)}
              {...actions}
            />
          </div>
        ) : (
          <div className="rounded-xl shadow-xl ring-1 ring-primary/30">
            <CompactRow
              item={item}
              placement="next"
              category={categoryName(snapshot, item)}
              start
              showKind
              {...actions}
            />
          </div>
        );
      }}
    >
      {(lists, dragging) => {
        const ids = (id: string) =>
          lists.find((list) => list.id === id)?.itemIds ?? [];
        return (
          <div className="space-y-8">
            <section aria-labelledby="workshop-current" className="space-y-3">
              <div className="flex items-center gap-2">
                <h2
                  id="workshop-current"
                  className="text-lg font-semibold tracking-tight"
                >
                  Working on
                </h2>
                <CountBadge
                  count={ids("current").length}
                  label="Working on count"
                />
              </div>
              <SortableContainer
                id="current"
                itemIds={ids("current")}
                label="Working on items"
                listClassName="space-y-3"
                empty={
                  <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    {dragging ? (
                      "Drop here to start working on it."
                    ) : (
                      <>
                        Nothing in progress. Press <strong>Start</strong> on an
                        Up next item, or pin an idea or project and send it
                        here.
                      </>
                    )}
                  </p>
                }
              >
                {ids("current").map((id) => {
                  const item = byId.get(id)!;
                  return (
                    <SortableItem key={id} id={id} label={item.title}>
                      {() => (
                        <WorkingOnRow
                          item={item}
                          category={categoryName(snapshot, item)}
                          {...actions}
                        />
                      )}
                    </SortableItem>
                  );
                })}
              </SortableContainer>
            </section>
            <section aria-labelledby="workshop-next" className="space-y-3">
              <button
                type="button"
                aria-expanded={upNextOpen}
                aria-controls="workshop-next-list"
                onClick={toggleUpNext}
                className="flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    !upNextOpen && "-rotate-90",
                  )}
                />
                <h2
                  id="workshop-next"
                  className="text-lg font-semibold tracking-tight"
                >
                  Up next
                </h2>
                <CountBadge count={ids("next").length} label="Up next count" />
              </button>
              {/* Collapsed lists still accept a drop, so they open while dragging. */}
              {(upNextOpen || dragging) && (
                <div id="workshop-next-list">
                  <SortableContainer
                    id="next"
                    itemIds={ids("next")}
                    label="Up next items"
                    listClassName="space-y-2"
                    empty={dropHint(
                      dragging
                        ? "Drop here to queue it."
                        : "Queue ideas or projects here with Move to Up next in their ⋯ menu.",
                    )}
                  >
                    {ids("next").map((id) => {
                      const item = byId.get(id)!;
                      return (
                        <SortableItem key={id} id={id} label={item.title}>
                          {() => (
                            <CompactRow
                              item={item}
                              placement="next"
                              category={categoryName(snapshot, item)}
                              start
                              showKind
                              {...actions}
                            />
                          )}
                        </SortableItem>
                      );
                    })}
                  </SortableContainer>
                </div>
              )}
            </section>
          </div>
        );
      }}
    </SortableBoard>
  );
}

/** Count shown right beside a section title. */
function CountBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      aria-label={`${label}: ${count}`}
      className="inline-grid h-6 min-w-6 place-items-center rounded-full bg-muted px-2 text-sm leading-none font-semibold text-foreground/80 tabular-nums"
    >
      {count}
    </span>
  );
}

const sectionTitles: Record<ProjectSection, string> = {
  pinned: "Pinned",
  deployed: "Deployed",
  local: "Local",
  built: "Built",
};

export function ItemList({
  items,
  snapshot,
  list,
  sort,
  projectSort,
  groupProjects,
  onDrop,
  onArchiveAction,
  ...actions
}: CardActions & {
  items: Item[];
  snapshot: Snapshot;
  list: Exclude<WorkshopView, "focus">;
  sort: IdeaSort;
  projectSort: ProjectSort;
  groupProjects: boolean;
  onDrop: (drop: BoardDrop) => unknown;
  onArchiveAction: (item: Item, operation: "unarchive" | "delete") => void;
}) {
  const { busy, onEdit } = actions;
  if (list === "idea")
    return (
      <IdeaGroups
        items={items}
        snapshot={snapshot}
        sort={sort}
        onDrop={onDrop}
        actions={actions}
      />
    );
  if (list === "project")
    return (
      <ProjectSections
        items={items}
        snapshot={snapshot}
        sort={projectSort}
        grouped={groupProjects}
        onDrop={onDrop}
        actions={actions}
      />
    );

  return (
    <ul
      role="list"
      aria-label="Archived items list"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {items.map((item) => {
        const category = snapshot.categories.find(
          (entry) => entry.id === item.categoryId,
        );
        return (
          <li
            key={item.id}
            aria-label={item.title}
            className="rounded-xl border bg-card p-3.5"
          >
            <article className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <h2>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onEdit(item)}
                    className="block max-w-full rounded-sm text-left text-sm font-semibold break-words hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {item.title}
                  </button>
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">
                    {item.kind === "idea" ? "Idea" : "Project"}
                  </Badge>
                  {category && (
                    <Badge
                      variant="outline"
                      className="font-normal text-muted-foreground"
                    >
                      {category.name}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onArchiveAction(item, "unarchive")}
                >
                  Restore
                </Button>
                <ConfirmInline
                  label="Delete permanently"
                  disabled={busy}
                  className="min-w-40"
                  onConfirm={() => onArchiveAction(item, "delete")}
                />
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

function IdeaRatingBadge({ rating }: { rating: number }) {
  const hue = rating <= 5 ? 25 + rating * 15 : 100 + (rating - 5) * 9;
  const color = `oklch(72% 0.15 ${hue})`;
  return (
    <Badge
      variant="outline"
      className="shrink-0 tabular-nums"
      aria-label={`Rating ${rating} out of 10`}
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 24%, var(--card))`,
        borderColor: `color-mix(in oklab, ${color} 55%, var(--card))`,
      }}
    >
      {rating}/10
    </Badge>
  );
}

/** One Ideas/Projects row. */
function CollectionRow({
  item,
  snapshot,
  showCategory,
  actions,
}: {
  item: Item;
  snapshot: Snapshot;
  showCategory?: boolean;
  actions: CardActions;
}) {
  const rating = item.kind === "idea" ? ideaRating(item) : null;
  return (
    <CompactRow
      item={item}
      placement={placementFor(snapshot, item.id)}
      category={showCategory ? categoryName(snapshot, item) : undefined}
      rating={rating !== null && <IdeaRatingBadge rating={rating} />}
      pin
      {...actions}
    />
  );
}

const listClass = "divide-y overflow-hidden rounded-xl border bg-card";

function SectionHeading({
  id,
  title,
  count,
  collapsed,
  onToggle,
  small,
}: {
  id: string;
  title: string;
  count: number;
  collapsed?: boolean;
  onToggle?: () => void;
  /** A category subheading inside a section. */
  small?: boolean;
}) {
  const label = (
    <>
      {onToggle &&
        (collapsed ? (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        ))}
      <h2
        id={id}
        className={
          small
            ? "truncate text-xs font-medium text-muted-foreground"
            : "truncate text-sm font-semibold tracking-tight"
        }
      >
        {title}
      </h2>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </>
  );
  return onToggle ? (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
      onClick={onToggle}
      className="flex min-w-0 items-center gap-1.5 rounded-sm py-0.5 text-left hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {label}
    </button>
  ) : (
    <div className="flex items-center gap-1.5 py-0.5">{label}</div>
  );
}

function IdeaGroups({
  items,
  snapshot,
  sort,
  onDrop,
  actions,
}: {
  items: Item[];
  snapshot: Snapshot;
  sort: IdeaSort;
  onDrop: (drop: BoardDrop) => unknown;
  actions: CardActions;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const byId = new Map(items.map((item) => [item.id, item]));

  // Pinned ideas lead the page; everything else groups by category. The sort
  // orders both the categories and the ideas inside them.
  const unpinned = items.filter((item) => !item.pinned);
  const groups = sortIdeaGroups(
    [
      { name: "Uncategorized", categoryId: null as string | null },
      ...snapshot.categories.map((category) => ({
        name: category.name,
        categoryId: category.id as string | null,
      })),
    ].map((group) => ({
      ...group,
      items: unpinned.filter((item) => item.categoryId === group.categoryId),
    })),
    sort,
  ).map((group) => ({
    ...group,
    id: `cat:${group.categoryId ?? "none"}`,
  }));
  const pinned = items.filter((item) => item.pinned);
  const containers: BoardContainer[] = [
    { id: "pinned", itemIds: pinned.map((item) => item.id) },
    ...groups.map((group) => ({
      id: group.id,
      itemIds: group.items.map((item) => item.id),
    })),
  ];

  return (
    <SortableBoard
      containers={containers}
      labelOf={(id) => byId.get(id)?.title ?? "item"}
      disabled={actions.busy}
      onDrop={onDrop}
      overlay={(id) => (
        <div className="rounded-xl border bg-card shadow-xl ring-1 ring-primary/30">
          <CollectionRow
            item={byId.get(id)!}
            snapshot={snapshot}
            showCategory
            actions={actions}
          />
        </div>
      )}
    >
      {(lists, dragging) => {
        const ids = (id: string) =>
          lists.find((entry) => entry.id === id)?.itemIds ?? [];
        // Sections that start empty stay out of the way, and while dragging
        // wait below the rest, so nothing shifts under the pointer.
        const started = (id: string) =>
          containers.find((entry) => entry.id === id)?.itemIds.length ?? 0;
        const renderRows = (list: string, showCategory: boolean) =>
          ids(list).map((id) => {
            const item = byId.get(id)!;
            return (
              <SortableItem key={id} id={id} label={item.title}>
                {() => (
                  <CollectionRow
                    item={item}
                    snapshot={snapshot}
                    showCategory={showCategory}
                    actions={actions}
                  />
                )}
              </SortableItem>
            );
          });
        return (
          <div className="flex flex-col gap-5">
            {(started("pinned") > 0 || dragging) && (
              <section
                aria-label="Pinned ideas"
                className="space-y-2"
                style={{ order: started("pinned") > 0 ? 0 : 2 }}
              >
                <SectionHeading
                  id="ideas-pinned"
                  title="Pinned"
                  count={ids("pinned").length}
                />
                <SortableContainer
                  id="pinned"
                  itemIds={ids("pinned")}
                  label="Pinned ideas"
                  listClassName={listClass}
                  empty={dropHint("Drop here to pin it.")}
                >
                  {renderRows("pinned", true)}
                </SortableContainer>
              </section>
            )}
            {groups.map((group) => {
              const count = ids(group.id).length;
              if (!started(group.id) && !dragging) return null;
              const isCollapsed = Boolean(collapsed[group.id]) && !dragging;
              return (
                <section
                  key={group.id}
                  aria-label={`${group.name} category`}
                  className="space-y-2"
                  style={{ order: started(group.id) > 0 ? 1 : 2 }}
                >
                  <SectionHeading
                    id={`ideas-${group.id}`}
                    title={group.name}
                    count={count}
                    collapsed={isCollapsed}
                    onToggle={() =>
                      setCollapsed((previous) => ({
                        ...previous,
                        [group.id]: !previous[group.id],
                      }))
                    }
                  />
                  {!isCollapsed && (
                    <SortableContainer
                      id={group.id}
                      itemIds={ids(group.id)}
                      label={`${group.name} ideas`}
                      listClassName={listClass}
                      empty={dropHint(`Drop here to move it to ${group.name}.`)}
                    >
                      {renderRows(group.id, false)}
                    </SortableContainer>
                  )}
                </section>
              );
            })}
          </div>
        );
      }}
    </SortableBoard>
  );
}

function ProjectSections({
  items,
  snapshot,
  sort,
  grouped,
  onDrop,
  actions,
}: {
  items: Item[];
  snapshot: Snapshot;
  sort: ProjectSort;
  grouped: boolean;
  onDrop: (drop: BoardDrop) => unknown;
  actions: CardActions;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const byId = new Map(items.map((item) => [item.id, item]));
  const order = ["pinned", "deployed", "local", "built"] as const;
  // Uncategorized first, then categories in their saved order.
  const groups = [
    { key: "none", name: "Uncategorized", categoryId: null as string | null },
    ...snapshot.categories.map((category) => ({
      key: category.id,
      name: category.name,
      categoryId: category.id as string | null,
    })),
  ];
  const inSection = (section: (typeof order)[number]) => {
    const found = items.filter((item) => projectSection(item) === section);
    // Pinned keeps the order it was pinned in; the others follow the sort.
    if (section === "pinned" || sort === "manual") return found;
    if (sort === "category") return sortByCategoryThenTitle(found);
    return [...found].sort((left, right) =>
      left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      }),
    );
  };
  // Container ids are "<section>", or "<section>:<category key>" when grouped.
  const containers: BoardContainer[] = order.flatMap((section) => {
    const found = inSection(section);
    if (!grouped || section === "pinned")
      return [{ id: section, itemIds: found.map((item) => item.id) }];
    return groups.map((group) => ({
      id: `${section}:${group.key}`,
      itemIds: found
        .filter((item) => item.categoryId === group.categoryId)
        .map((item) => item.id),
    }));
  });
  return (
    <SortableBoard
      containers={containers}
      labelOf={(id) => byId.get(id)?.title ?? "item"}
      disabled={actions.busy}
      onDrop={onDrop}
      overlay={(id) => (
        <div className="rounded-xl border bg-card shadow-xl ring-1 ring-primary/30">
          <CollectionRow
            item={byId.get(id)!}
            snapshot={snapshot}
            showCategory
            actions={actions}
          />
        </div>
      )}
    >
      {(lists, dragging) => {
        const ids = (id: string) =>
          lists.find((entry) => entry.id === id)?.itemIds ?? [];
        const started = (id: string) =>
          containers.find((entry) => entry.id === id)?.itemIds.length ?? 0;
        const containerIds = (section: (typeof order)[number]) =>
          grouped && section !== "pinned"
            ? groups.map((group) => `${section}:${group.key}`)
            : [section];
        const rows = (container: string, showCategory: boolean) =>
          ids(container).map((id) => {
            const item = byId.get(id)!;
            return (
              <SortableItem key={id} id={id} label={item.title}>
                {() => (
                  <CollectionRow
                    item={item}
                    snapshot={snapshot}
                    showCategory={showCategory}
                    actions={actions}
                  />
                )}
              </SortableItem>
            );
          });
        return (
          <div className="flex flex-col gap-5">
            {order.map((section, position) => {
              const members = containerIds(section);
              const count = members.reduce(
                (sum, id) => sum + ids(id).length,
                0,
              );
              const total = members.reduce((sum, id) => sum + started(id), 0);
              // Empty sections disappear, except as drop targets while
              // dragging, when they wait below the rest so nothing shifts.
              if (!total && !dragging) return null;
              // Like idea categories, sections fold away, except while dragging.
              const foldable = section !== "pinned";
              const isCollapsed =
                foldable && Boolean(collapsed[section]) && !dragging;
              return (
                <section
                  key={section}
                  aria-label={`${sectionTitles[section]} projects`}
                  className="space-y-2"
                  style={{ order: total > 0 ? position : order.length }}
                >
                  <SectionHeading
                    id={`projects-${section}`}
                    title={sectionTitles[section]}
                    count={count}
                    collapsed={isCollapsed}
                    onToggle={
                      foldable
                        ? () =>
                            setCollapsed((previous) => ({
                              ...previous,
                              [section]: !previous[section],
                            }))
                        : undefined
                    }
                  />
                  {isCollapsed ? null : grouped && section !== "pinned" ? (
                    <div className="flex flex-col gap-3 pl-2">
                      {groups.map((group, at) => {
                        const id = `${section}:${group.key}`;
                        if (!started(id) && !dragging) return null;
                        return (
                          <div
                            key={id}
                            className="space-y-1.5"
                            style={{
                              order: started(id) > 0 ? at : groups.length,
                            }}
                          >
                            <SectionHeading
                              small
                              id={`projects-${id}`}
                              title={group.name}
                              count={ids(id).length}
                            />
                            <SortableContainer
                              id={id}
                              itemIds={ids(id)}
                              label={`${sectionTitles[section]} ${group.name} projects`}
                              listClassName={listClass}
                              empty={dropHint(
                                `Drop here to move it to ${group.name}.`,
                              )}
                            >
                              {rows(id, false)}
                            </SortableContainer>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <SortableContainer
                      id={section}
                      itemIds={ids(section)}
                      label={`${sectionTitles[section]} project list`}
                      listClassName={listClass}
                      empty={dropHint(
                        {
                          pinned: "Drop here to pin it.",
                          deployed: "Projects with a Live URL appear here.",
                          local: "Projects without a Live URL appear here.",
                          built: "Drop here to mark it built.",
                        }[section],
                      )}
                    >
                      {rows(section, true)}
                    </SortableContainer>
                  )}
                </section>
              );
            })}
          </div>
        );
      }}
    </SortableBoard>
  );
}
