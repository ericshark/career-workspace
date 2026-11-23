"use client";

import { useId, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderIcon,
  Link2Icon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  StarIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ideaRating,
  type Doc,
  type FocusSection,
  type Item,
  type Kind,
  type Status,
} from "@/lib/workshop/model";
import { cn } from "@/lib/utils";
import { LinkedFolderIcon } from "./dev/summary";
import { ConfirmButtons } from "./ConfirmInline";
import { ChipLink, PathChip, chipClass, hostLabel } from "./HeaderLinks";
import { TaskPanel, type TaskHandlers } from "./tasks";

/** Callbacks shared by Working on cards, Up next rows, and collection rows. */
export type CardActions = {
  busy: boolean;
  onEdit: (item: Item) => void;
  onPlace: (item: Item, section: FocusSection | null) => void;
  onArchive: (item: Item) => void;
  onDelete: (item: Item) => void;
  onSetStatus: (item: Item, status: Status) => void;
  onSetKind: (item: Item, kind: Kind) => void;
  onNotify: (message: string) => void;
  /** Opens the project's popup on its Dev tab. */
  onOpenDev: (item: Item) => void;
  onPin: (item: Item, pinned: boolean) => void;
  onOpenDoc: (item: Item, doc: Doc) => void;
  taskHandlers: (item: Item) => TaskHandlers;
};

export function taskProgress(item: Item) {
  const total = item.checklist.length;
  const done = item.checklist.filter((task) => task.done).length;
  return { total, done };
}

/**
 * Whole-card click opens the editor. Clicks on controls, and clicks that bubble
 * up from menus rendered in a portal, are ignored.
 */
function openOnClick(event: React.MouseEvent<HTMLElement>, open: () => void) {
  const target = event.target as HTMLElement;
  if (!event.currentTarget.contains(target)) return;
  if (
    target.closest(
      "button,a,input,textarea,select,label,[role=menuitem],[data-no-open]",
    )
  )
    return;
  if (window.getSelection()?.toString()) return;
  open();
}

export function ProgressBar({
  item,
  size = "md",
}: {
  item: Item;
  /** sm stacks the count over the bar (Working on cards); xs and md sit on one line. */
  size?: "xs" | "sm" | "md";
}) {
  const { done, total } = taskProgress(item);
  if (!total) return null;
  const percent = Math.round((done / total) * 100);
  const complete = done === total;
  const track = (
    <div
      role="progressbar"
      aria-label={`Task progress for ${item.title}`}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total} tasks done`}
      className="h-2 w-full overflow-hidden rounded-full bg-muted shadow-inner"
    >
      <div
        className={cn(
          "h-full rounded-full bg-gradient-to-r shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] transition-[width] duration-500 ease-out motion-reduce:transition-none",
          complete
            ? "from-emerald-500 to-emerald-400"
            : "from-emerald-400 to-emerald-500",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
  const count = (
    <span className="text-sm font-semibold tabular-nums">
      {done}/{total}
    </span>
  );
  if (size === "sm")
    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-1">
            {count}
            <span className="text-xs text-muted-foreground">tasks</span>
          </span>
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              complete
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground",
            )}
          >
            {complete ? "All done" : `${percent}%`}
          </span>
        </div>
        {track}
      </div>
    );
  return (
    <div className="flex w-56 max-w-full shrink-0 items-center gap-2.5">
      {track}
      <span className="flex shrink-0 items-baseline gap-1">
        {count}
        <span className="text-xs text-muted-foreground">
          {complete ? "done" : "tasks"}
        </span>
      </span>
    </div>
  );
}

const pillBase =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap";

/** Small tinted pill showing where an item sits in Focus. */
export function PlacementPill({ placement }: { placement: FocusSection }) {
  const current = placement === "current";
  return (
    <span
      className={cn(
        pillBase,
        "h-5 gap-1.5 px-2 text-[11px]",
        current
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          current ? "bg-emerald-500" : "bg-sky-500",
        )}
      />
      {current ? "Working on" : "Up next"}
    </span>
  );
}

/** Converts after confirming when going back to an idea would drop milestones. */
export function convertKind(
  item: Item,
  kind: Kind,
  onSetKind: CardActions["onSetKind"],
) {
  if (kind === item.kind) return;
  const loses = kind === "idea" && item.milestones.length;
  if (
    loses &&
    !window.confirm(
      `Converting “${item.title}” to an idea removes its milestones. Continue?`,
    )
  )
    return;
  onSetKind(item, kind);
}

const chipBase =
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap";

/**
 * Metadata chips: kind, category, and rating when set. With `onSetKind` the
 * kind chip is a menu that switches between Idea and Project.
 */
export function MetaChips({
  item,
  category,
  onSetKind,
}: {
  item: Item;
  category: string;
  onSetKind?: (kind: Kind) => void;
}) {
  const rating = item.kind === "idea" ? ideaRating(item) : null;
  const kindClass = cn(
    chipBase,
    item.kind === "idea"
      ? "bg-blue-100 text-foreground/75 dark:bg-blue-500/15 dark:text-foreground/80"
      : "border text-muted-foreground",
  );
  const kindLabel = item.kind === "idea" ? "Idea" : "Project";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {onSetKind ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Type: ${kindLabel}. Change`}
              className={cn(
                kindClass,
                "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
            >
              {kindLabel}
              <ChevronDownIcon className="size-3 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-32">
            {(["idea", "project"] as const).map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => onSetKind(kind)}>
                {kind === "idea" ? "Idea" : "Project"}
                {kind === item.kind && (
                  <CheckIcon className="ml-auto size-3.5" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className={kindClass}>{kindLabel}</span>
      )}
      <span className="px-1 text-xs text-muted-foreground">{category}</span>
      {rating !== null && (
        <span className={cn(chipBase, "bg-muted text-muted-foreground")}>
          <StarIcon className="size-2.5" aria-hidden="true" />
          {rating}/10
        </span>
      )}
    </div>
  );
}

/**
 * Pin toggle. A first click pins the item to the top of its page; once pinned,
 * the button offers Unpin or sending it straight to Focus.
 */
function PinButton({
  item,
  placement,
  busy,
  onPin,
  onPlace,
}: Pick<CardActions, "busy" | "onPin" | "onPlace"> & {
  item: Item;
  placement: FocusSection | null;
}) {
  if (!item.pinned)
    return (
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={busy}
        aria-label={`Pin ${item.title}`}
        aria-pressed={false}
        onClick={() => onPin(item, true)}
        className="text-muted-foreground"
      >
        <PinIcon />
      </Button>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label={`Pinned: ${item.title}`}
          aria-pressed
          className="text-primary"
        >
          <PinIcon className="fill-current" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={() => onPin(item, false)}>
          <PinOffIcon /> Unpin
        </DropdownMenuItem>
        {placement !== "current" && (
          <DropdownMenuItem onSelect={() => onPlace(item, "current")}>
            <PlayIcon /> Move to Working on
          </DropdownMenuItem>
        )}
        {placement !== "next" && (
          <DropdownMenuItem onSelect={() => onPlace(item, "next")}>
            <PlayIcon className="opacity-60" /> Move to Up next
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type ItemAction = {
  key: string;
  label: string;
  destructive?: boolean;
  run: () => void;
};

/**
 * What can be done with an item besides editing it, in menu order: leave Focus,
 * move between Working on and Up next, mark a Working on project Built, then
 * archive or delete. Changing Idea/Project happens through the kind chip. The
 * ⋯ menu and the view popup's footer both list these, so they cannot drift.
 */
export function itemActions(
  item: Item,
  placement: FocusSection | null,
  {
    onPlace,
    onArchive,
    onDelete,
    onSetStatus,
  }: Pick<CardActions, "onPlace" | "onArchive" | "onDelete" | "onSetStatus">,
): ItemAction[] {
  const built = item.kind === "project" && item.status === "Built";
  const actions: ItemAction[] = [];
  if (placement)
    actions.push({
      key: "unplace",
      label: "Remove from Focus",
      run: () => onPlace(item, null),
    });
  if (!built && placement !== "current")
    actions.push({
      key: "current",
      label: "Move to Working on",
      run: () => onPlace(item, "current"),
    });
  if (!built && placement !== "next")
    actions.push({
      key: "next",
      label: "Move to Up next",
      run: () => onPlace(item, "next"),
    });
  // Only a project that is being worked on can be finished; ideas never.
  if (item.kind === "project" && (built || placement === "current"))
    actions.push({
      key: "status",
      label: built ? "Reopen project" : "Mark Built",
      run: () => onSetStatus(item, built ? "Active" : "Built"),
    });
  actions.push(
    {
      key: "archive",
      label: "Archive",
      destructive: true,
      run: () => onArchive(item),
    },
    {
      key: "delete",
      label: "Delete",
      destructive: true,
      run: () => onDelete(item),
    },
  );
  return actions;
}

/** The ⋯ menu: the item actions above. Delete asks for confirmation in place. */
export function ItemMenu({
  item,
  placement,
  busy,
  ...handlers
}: Pick<
  CardActions,
  "busy" | "onPlace" | "onArchive" | "onDelete" | "onSetStatus"
> & {
  item: Item;
  placement: FocusSection | null;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const actions = itemActions(item, placement, handlers);
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setArmed(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label={`More actions for ${item.title}`}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions
          .filter((action) => !action.destructive)
          .map((action) => (
            <DropdownMenuItem key={action.key} onSelect={action.run}>
              {action.label}
            </DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        <div className="grid grid-cols-2 items-center divide-x">
          {actions
            .filter((action) => action.destructive)
            .map((action) =>
              action.key === "delete" && armed ? (
                <ConfirmButtons
                  key={action.key}
                  className="px-1"
                  onConfirm={() => {
                    setOpen(false);
                    setArmed(false);
                    action.run();
                  }}
                  onCancel={() => setArmed(false)}
                />
              ) : (
                <DropdownMenuItem
                  key={action.key}
                  variant={action.key === "delete" ? "destructive" : "default"}
                  className="justify-center before:hidden"
                  onSelect={(event) => {
                    if (action.key === "delete") {
                      // Keep the menu open and swap Delete for the check and X.
                      event.preventDefault();
                      setArmed(true);
                    } else action.run();
                  }}
                >
                  {action.label}
                </DropdownMenuItem>
              ),
            )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function hasLinks(item: Item) {
  return Boolean(
    item.githubUrl || item.liveUrl || item.localFolder || item.links.length,
  );
}

/** Copies a `cd` into the folder; pasting it into a terminal goes straight there. */
function copyFolder(folder: string, onNotify: (message: string) => void) {
  const command = `cd "${folder.replace(/(["\\$`])/g, "\\$1")}"`;
  void navigator.clipboard
    ?.writeText(command)
    .then(() => onNotify("Copied cd command."))
    .catch(() => onNotify(command));
}

/**
 * Docs as one chip: a single doc shows its title and opens it; several show
 * "Docs (n)" and open a menu listing each.
 */
export function DocsChip({
  item,
  onOpenDoc,
}: {
  item: Item;
  onOpenDoc: (item: Item, doc: Doc) => void;
}) {
  if (!item.docs.length) return null;
  if (item.docs.length === 1) {
    const [doc] = item.docs;
    return (
      <button
        type="button"
        aria-label={`Open doc ${doc.title}`}
        onClick={() => onOpenDoc(item, doc)}
        className={chipClass}
      >
        <FileTextIcon />
        <span className="truncate">{doc.title}</span>
      </button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Docs for ${item.title}`}
          className={chipClass}
        >
          <FileTextIcon />
          <span>Docs ({item.docs.length})</span>
          <ChevronDownIcon />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-72 min-w-44">
        {item.docs.map((doc) => (
          <DropdownMenuItem
            key={doc.id}
            aria-label={`Open doc ${doc.title}`}
            onSelect={() => onOpenDoc(item, doc)}
          >
            <FileTextIcon />
            <span className="truncate">{doc.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The saved links in card order: Live site, GitHub, local folder, other links. */
export function LinkChips({ item }: { item: Item }) {
  return (
    <>
      {item.liveUrl && (
        <ChipLink href={item.liveUrl} kind="live" label="Live site" />
      )}
      {item.githubUrl && (
        <ChipLink href={item.githubUrl} kind="github" label="GitHub" />
      )}
      {item.localFolder && <PathChip folder={item.localFolder} />}
    </>
  );
}

/**
 * Everything linked from a card, in one row under the description: Live site,
 * GitHub, the local folder path, the Dev chip, other links, then docs.
 */
export function LinkRow({
  item,
  onOpenDev,
  onOpenDoc,
}: {
  item: Item;
  /** Adds the repo status chip (opens the Dev tab) after the folder. */
  onOpenDev?: (item: Item) => void;
  onOpenDoc?: (item: Item, doc: Doc) => void;
}) {
  if (!hasLinks(item) && !item.docs.length) return null;
  return (
    <div data-no-open className="flex flex-wrap items-center gap-1.5">
      <LinkChips item={item} />
      {onOpenDev && <LinkedFolderIcon item={item} onOpenDev={onOpenDev} />}
      {item.links.map((href) => (
        <ChipLink key={href} href={href} kind="other" label={hostLabel(href)} />
      ))}
      {onOpenDoc && <DocsChip item={item} onOpenDoc={onOpenDoc} />}
    </div>
  );
}

/**
 * Link icon beside an item's name. Only shown when the item has links; green
 * when it has a Live URL (deployed). Opens a menu to the side.
 */
export function LinksButton({
  item,
  onNotify,
}: {
  item: Item;
  onNotify: (message: string) => void;
}) {
  if (!hasLinks(item)) return null;
  const deployed = Boolean(item.liveUrl);
  const entries = [
    item.liveUrl && { label: "Live site", href: item.liveUrl },
    item.githubUrl && { label: "GitHub", href: item.githubUrl },
    ...item.links.map((href) => ({ label: hostLabel(href), href })),
  ].filter((entry): entry is { label: string; href: string } => !!entry);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-no-open
          aria-label={`Links for ${item.title}${deployed ? " (deployed)" : ""}`}
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            deployed
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground",
          )}
        >
          <Link2Icon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        className="max-w-72 min-w-44"
      >
        {entries.map((entry) => (
          <DropdownMenuItem key={entry.href} asChild>
            <a href={entry.href} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon />
              <span className="truncate">{entry.label}</span>
            </a>
          </DropdownMenuItem>
        ))}
        {item.localFolder && (
          <DropdownMenuItem
            onSelect={() => copyFolder(item.localFolder, onNotify)}
          >
            <FolderIcon />
            <span className="truncate" title={item.localFolder}>
              {item.localFolder}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A Working on item: a slim card. The left side (title, chips, description)
 * opens the editor; the right side (task progress) expands the task list below.
 * Pressing and dragging the row (or holding it on touch) reorders it or moves
 * it to Up next; the card surface and title support that.
 */
export function WorkingOnRow({
  item,
  category,
  ...actions
}: CardActions & {
  item: Item;
  category: string;
}) {
  const { busy, onEdit, onNotify, onOpenDoc } = actions;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const { done, total } = taskProgress(item);
  return (
    <article className="group/row rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md">
      <div className="flex items-stretch">
        <div
          onClick={(event) => openOnClick(event, () => onEdit(item))}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-1 py-3 pr-2 pl-3"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                title="Drag to reorder or move to Up next"
                className="min-w-0 cursor-grab text-base leading-snug font-semibold wrap-anywhere active:cursor-grabbing"
              >
                {item.title}
              </h3>
              <MetaChips item={item} category={category} />
            </div>
            {item.description && (
              <p className="line-clamp-2 text-[13px] leading-relaxed wrap-anywhere text-muted-foreground">
                {item.description}
              </p>
            )}
            <LinkRow
              item={item}
              onOpenDev={actions.onOpenDev}
              onOpenDoc={onOpenDoc}
            />
          </div>
          <div className="-mt-1 shrink-0">
            <ItemMenu item={item} placement="current" {...actions} />
          </div>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={
            total
              ? `${expanded ? "Hide" : "Show"} tasks for ${item.title}`
              : `Add tasks for ${item.title}`
          }
          onClick={() => setExpanded((value) => !value)}
          className="flex w-44 shrink-0 items-center justify-end gap-2 rounded-r-xl border-l px-3 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-60"
        >
          {total ? (
            <div className="min-w-0 flex-1 [&>div]:w-full">
              <ProgressBar item={item} size="sm" />
            </div>
          ) : (
            <span className="text-xs">Add tasks</span>
          )}
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 transition-transform motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
          <span className="sr-only">
            {done} of {total} tasks done
          </span>
        </button>
      </div>
      {expanded && (
        <div id={panelId} className="border-t px-4 py-3">
          <TaskPanel
            startAdding={total === 0}
            title={item.title}
            description={item.description}
            tasks={item.checklist}
            busy={busy}
            handlers={actions.taskHandlers(item)}
          />
        </div>
      )}
    </article>
  );
}

/** Row used by Up next and the Ideas/Projects pages. Up next rows are roomier. */
export function CompactRow({
  item,
  placement,
  category,
  rating,
  start,
  pin,
  showKind,
  ...actions
}: CardActions & {
  item: Item;
  placement: FocusSection | null;
  category?: string;
  rating?: React.ReactNode;
  start?: boolean;
  pin?: boolean;
  /** Metadata chips in place of the category label: Focus only. */
  showKind?: boolean;
}) {
  const { busy, onEdit, onPlace, onPin, onNotify, onOpenDoc } = actions;
  const built = item.kind === "project" && item.status === "Built";
  const nextTask = start ? item.checklist.find((task) => !task.done) : null;
  return (
    <article
      onClick={(event) => openOnClick(event, () => onEdit(item))}
      className={cn(
        "flex cursor-pointer items-start gap-3 transition-colors",
        // Up next items are separate cards, matching Working on.
        start
          ? "rounded-xl border bg-card px-4 py-4 shadow-xs max-sm:flex-wrap transition-shadow hover:shadow-md"
          : "px-3 py-2.5 hover:bg-muted/40",
      )}
    >
      {/* On phones the progress and actions wrap below an Up next title. */}
      <div
        className={cn("min-w-0 flex-1 space-y-1", start && "max-sm:basis-full")}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3
            className={cn(
              "min-w-0 font-medium wrap-anywhere",
              start ? "cursor-grab text-base" : "text-sm",
            )}
          >
            {item.title}
          </h3>

          {showKind && category && (
            <MetaChips item={item} category={category} />
          )}
          {placement && !start && <PlacementPill placement={placement} />}
          {category && !showKind && (
            <span className="text-xs text-muted-foreground">{category}</span>
          )}
        </div>

        {item.description && (
          <p
            className={cn(
              "whitespace-pre-line wrap-anywhere text-muted-foreground",
              start ? "text-sm" : "text-xs",
            )}
          >
            {item.description}
          </p>
        )}
        <LinkRow
          item={item}
          onOpenDev={actions.onOpenDev}
          onOpenDoc={onOpenDoc}
        />
        {nextTask && (
          <p className="text-xs wrap-anywhere text-muted-foreground">
            <span className="font-medium text-foreground/70">Next:</span>{" "}
            {nextTask.title}
          </p>
        )}
      </div>
      <div
        className={cn("w-40 self-center", start ? "block" : "hidden sm:block")}
      >
        <ProgressBar item={item} size="sm" />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 self-center">
        {rating}
        {start && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={`Start ${item.title}`}
            onClick={() => onPlace(item, "current")}
          >
            <PlayIcon /> Start
          </Button>
        )}
        {pin && !built && (
          <PinButton
            item={item}
            placement={placement}
            busy={busy}
            onPin={onPin}
            onPlace={onPlace}
          />
        )}
        <ItemMenu item={item} placement={placement} {...actions} />
      </div>
    </article>
  );
}
