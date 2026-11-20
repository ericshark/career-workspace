"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
  type CSSProperties,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

export type BoardContainer = { id: string; itemIds: string[] };
export type BoardDrop = {
  id: string;
  from: string;
  to: string;
  /** Final position of the item inside its destination container. */
  index: number;
  /** The item it now sits beside; null when it is alone in the container. */
  neighbour: { id: string; after: boolean } | null;
};

function containerOf(list: BoardContainer[], id: UniqueIdentifier) {
  if (list.some((container) => container.id === id)) return String(id);
  return list.find((container) => container.itemIds.includes(String(id)))?.id;
}

/**
 * Drag-and-drop for one or more lists. While dragging, the lifted card follows
 * the pointer and the other cards slide aside to show where it will land, even
 * across lists. The caller persists the result in `onDrop`.
 */
export function SortableBoard({
  containers,
  disabled,
  onDrop,
  overlay,
  labelOf,
  children,
}: {
  containers: BoardContainer[];
  /** Readable name for an item id, used in screen-reader announcements. */
  labelOf: (id: string) => string;
  disabled?: boolean;
  onDrop: (drop: BoardDrop) => unknown;
  overlay: (id: string) => ReactNode;
  children: (containers: BoardContainer[], dragging: boolean) => ReactNode;
}) {
  // Local copy of the lists that shows the pending result until the saved
  // data arrives, so a dropped card never flashes back to its old place.
  const [preview, setPreview] = useState<BoardContainer[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // The last drop target under the pointer, kept while the layout shifts beneath it.
  const lastOver = useRef<UniqueIdentifier | null>(null);
  useEffect(() => setMounted(true), []);
  const current = preview ?? containers;
  const sensors = useSensors(
    // A 6px threshold keeps ordinary clicks on a card working.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch drags need a short press so the page can still scroll.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const containerIds = new Set(containers.map((container) => container.id));

  // Prefer the card under the pointer; fall back to the list it is inside.
  // Previewing a card in another list shifts the lists under the pointer, so
  // when nothing is under it the last target is kept instead of cancelling.
  const collision: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    const hits = within.length ? within : rectIntersection(args);
    const cards = hits.filter((hit) => !containerIds.has(String(hit.id)));
    let found = hits.filter((hit) => containerIds.has(String(hit.id)));
    if (cards.length)
      found = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((entry) =>
          cards.some((hit) => hit.id === entry.id),
        ),
      });
    if (found.length) lastOver.current = found[0].id;
    return found.length || lastOver.current === null
      ? found
      : [{ id: lastOver.current }];
  };

  function handleOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setPreview((previous) => {
      const list = previous ?? containers;
      const from = containerOf(list, active.id);
      const to = containerOf(list, over.id);
      if (!from || !to || from === to) return list;
      const target = list.find((container) => container.id === to)!;
      let index = target.itemIds.length;
      if (!containerIds.has(String(over.id))) {
        const rect = active.rect.current.translated;
        const overIndex = target.itemIds.indexOf(String(over.id));
        let after = false;
        if (rect) {
          const dy =
            rect.top + rect.height / 2 - (over.rect.top + over.rect.height / 2);
          const dx =
            rect.left + rect.width / 2 - (over.rect.left + over.rect.width / 2);
          after = Math.abs(dy) > over.rect.height / 4 ? dy > 0 : dx > 0;
        }
        index = overIndex + (after ? 1 : 0);
      }
      const id = String(active.id);
      return list.map((container) => {
        if (container.id === from)
          return {
            ...container,
            itemIds: container.itemIds.filter((entry) => entry !== id),
          };
        if (container.id !== to) return container;
        return {
          ...container,
          itemIds: [
            ...container.itemIds.slice(0, index),
            id,
            ...container.itemIds.slice(index),
          ],
        };
      });
    });
  }

  function handleEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return setPreview(null);
    const id = String(active.id);
    let final = preview ?? containers;
    const from = containerOf(final, active.id);
    const to = containerOf(final, over.id);
    if (
      from &&
      from === to &&
      over.id !== active.id &&
      !containerIds.has(String(over.id))
    ) {
      final = final.map((container) =>
        container.id === from
          ? {
              ...container,
              itemIds: arrayMove(
                container.itemIds,
                container.itemIds.indexOf(id),
                container.itemIds.indexOf(String(over.id)),
              ),
            }
          : container,
      );
    }
    const origin = containerOf(containers, id);
    const destination = containerOf(final, id);
    if (!origin || !destination) return setPreview(null);
    const list = final.find(
      (container) => container.id === destination,
    )!.itemIds;
    const index = list.indexOf(id);
    const before = containers
      .find((container) => container.id === origin)!
      .itemIds.indexOf(id);
    if (origin === destination && before === index) return setPreview(null);
    const neighbour =
      index > 0
        ? { id: list[index - 1], after: true }
        : list.length > 1
          ? { id: list[1], after: false }
          : null;
    setPreview(final);
    void Promise.resolve(
      onDrop({ id, from: origin, to: destination, index, neighbour }),
    ).finally(() => setPreview(null));
  }

  return (
    <DndContext
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Press space to pick up, the arrow keys to move, and space again to drop. Escape cancels.",
        },
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${labelOf(String(active.id))}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${labelOf(String(active.id))} is over ${
                  containerIds.has(String(over.id))
                    ? "another list"
                    : labelOf(String(over.id))
                }.`
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${labelOf(String(active.id))}.`
              : `${labelOf(String(active.id))} returned to its place.`,
          onDragCancel: ({ active }) =>
            `Canceled. ${labelOf(String(active.id))} returned to its place.`,
        },
      }}
      sensors={disabled ? [] : sensors}
      collisionDetection={collision}
      onDragStart={({ active }) => {
        lastOver.current = null;
        setActiveId(String(active.id));
        setPreview(containers);
      }}
      onDragOver={handleOver}
      onDragEnd={handleEnd}
      onDragCancel={() => {
        setActiveId(null);
        setPreview(null);
      }}
    >
      {children(current, activeId !== null)}
      {/* Portaled to the body so a transformed ancestor (a dialog) can't offset it. */}
      {mounted &&
        createPortal(
          <DragOverlay dropAnimation={{ duration: 180 }}>
            {activeId ? overlay(activeId) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

/** One droppable list; also accepts drops while empty. */
export function SortableContainer({
  id,
  itemIds,
  grid,
  label,
  empty,
  className,
  listClassName,
  children,
}: {
  id: string;
  itemIds: string[];
  grid?: boolean;
  label: string;
  empty?: ReactNode;
  className?: string;
  listClassName?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext
      id={id}
      items={itemIds}
      strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        data-over={isOver}
        className={cn(
          "rounded-xl transition-colors data-[over=true]:bg-primary/5",
          className,
        )}
      >
        {itemIds.length ? (
          <ul role="list" aria-label={label} className={listClassName}>
            {children}
          </ul>
        ) : (
          empty
        )}
      </div>
    </SortableContext>
  );
}

/**
 * A draggable list item. The whole item is the drag handle for pointer and
 * keyboard (focus it, then Space); inputs, buttons nested in it and
 * `data-no-drag` areas keep their own behaviour.
 */
export function SortableItem({
  id,
  label,
  disabled,
  className,
  children,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  className?: string;
  children: (parts: { dragging: boolean }) => ReactNode;
}) {
  const {
    // The default role="button" would break the surrounding list semantics.
    attributes: { role: _role, ...attributes },
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  const { onKeyDown, ...pointer } = (listeners ?? {}) as Record<
    string,
    (event: SyntheticEvent) => void
  >;
  const guarded = Object.fromEntries(
    Object.entries(pointer).map(([name, handler]) => [
      name,
      (event: SyntheticEvent) => {
        // Only a blocker inside this item counts; an outer data-no-drag area
        // (a task list inside a card) must not stop the task itself dragging.
        const blocker = (event.target as HTMLElement).closest(
          "input,textarea,select,[data-no-drag]",
        );
        if (blocker && event.currentTarget.contains(blocker)) return;
        handler(event);
      },
    ]),
  );
  const style: CSSProperties = {
    // Translate only: rectSortingStrategy also scales, which squashed cards of
    // different heights while another card was dragged past them.
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
      }}
      style={style}
      aria-label={label}
      {...(disabled ? {} : { ...attributes, ...guarded })}
      onKeyDown={(event) => {
        // Space/Enter lift the item only when the item itself has focus.
        if (disabled || event.target !== event.currentTarget) return;
        onKeyDown?.(event);
      }}
      className={cn(
        "relative min-w-0 rounded-[inherit] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "z-10 opacity-30",
        className,
      )}
    >
      {children({ dragging: isDragging })}
    </li>
  );
}

/** A single reorderable list (tasks, milestones, categories). */
export function SortableList({
  ids,
  label,
  onReorder,
  renderItem,
  itemLabel,
  className,
}: {
  ids: string[];
  label: string;
  /** Called with the dragged id and the index it was dropped at. */
  onReorder: (id: string, index: number) => unknown;
  renderItem: (id: string, parts: { dragging: boolean }) => ReactNode;
  itemLabel: (id: string) => string;
  className?: string;
}) {
  return (
    <SortableBoard
      containers={[{ id: "list", itemIds: ids }]}
      labelOf={itemLabel}
      onDrop={({ id, index }) => onReorder(id, index)}
      overlay={(id) => (
        <div className="rounded-lg shadow-lg ring-1 ring-primary/30">
          {renderItem(id, { dragging: true })}
        </div>
      )}
    >
      {([container]) => (
        <SortableContainer
          id="list"
          itemIds={container.itemIds}
          label={label}
          listClassName={className}
        >
          {container.itemIds.map((id) => (
            <SortableItem key={id} id={id} label={itemLabel(id)}>
              {(parts) => renderItem(id, parts)}
            </SortableItem>
          ))}
        </SortableContainer>
      )}
    </SortableBoard>
  );
}
