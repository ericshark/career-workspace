"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Operation, Snapshot } from "@/lib/workshop/model";
import { isWorkshopConflict, Failure } from "./controls";
import { SortableList } from "./Sortable";

export function CategoryDialog({
  snapshot,
  save,
  reload,
  onClose,
}: {
  snapshot: Snapshot;
  save: (command: Operation) => Promise<unknown>;
  reload: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);
    try {
      await task();
      setName("");
      setRenaming(undefined);
      setDeleting(undefined);
    } catch (error) {
      setFailure(error as Error);
    } finally {
      setBusy(false);
    }
  }
  const selected = snapshot.categories.find(
    (category) => category.id === deleting,
  );
  const impact = snapshot.items.filter((item) => item.categoryId === deleting);
  const archived = impact.filter((item) => item.archived).length;
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Manage categories"
      footer={
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Categories are shared by Ideas and Projects.
        </p>
        <Failure
          message={failure?.message ?? ""}
          onReload={
            isWorkshopConflict(failure) && !busy
              ? () => void run(reload)
              : undefined
          }
        />
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              save({ operation: "saveCategory", id: renaming, name }),
            );
          }}
        >
          <Input
            autoFocus
            aria-label={renaming ? "Rename category" : "New category"}
            placeholder={renaming ? "Rename category" : "New category"}
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            {renaming ? "Save name" : "Add"}
          </Button>
          {renaming && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setName("");
                setRenaming(undefined);
              }}
            >
              Cancel
            </Button>
          )}
        </form>
        <SortableList
          ids={snapshot.categories.map((category) => category.id)}
          label="Categories"
          className="space-y-1.5"
          itemLabel={(id) =>
            snapshot.categories.find((category) => category.id === id)?.name ??
            "category"
          }
          // Dropping a category onto a position takes that position's place.
          onReorder={(id, index) => {
            const to = snapshot.categories[index];
            if (to && to.id !== id)
              return run(() =>
                save({ operation: "moveCategory", id, to: to.id }),
              );
          }}
          renderItem={(id) => {
            const category = snapshot.categories.find(
              (entry) => entry.id === id,
            )!;
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
                <span className="min-w-0 flex-1 text-sm font-medium break-words">
                  {category.name}
                </span>
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={`Rename ${category.name}`}
                  onClick={() => {
                    setRenaming(category.id);
                    setName(category.name);
                    setDeleting(undefined);
                  }}
                >
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Delete ${category.name}`}
                  onClick={() => setDeleting(category.id)}
                >
                  Delete
                </Button>
              </div>
            );
          }}
        />
        {selected && (
          <div
            className="space-y-2 rounded-lg border border-destructive/30 p-3"
            aria-live="polite"
          >
            <p className="text-sm">
              Delete <strong>{selected.name}</strong> and move {impact.length}{" "}
              {impact.length === 1 ? "item" : "items"} to Uncategorized (
              {impact.length - archived} active, {archived} archived)?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDeleting(undefined)}
              >
                Keep category
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    save({ operation: "deleteCategory", id: selected.id }),
                  )
                }
              >
                Delete category
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
