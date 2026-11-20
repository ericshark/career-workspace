"use client";

import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/ui/button";
import type {
  FocusSection,
  Item,
  Operation,
  WorkshopData,
} from "@/lib/workshop/model";
import { cn } from "@/lib/utils";
import { DevPanel } from "./dev/DevPanel";
import { ChipLink, hostLabel } from "./HeaderLinks";
import { ConfirmInline } from "./ConfirmInline";
import { DocViewer, DocsSection, type DocDraft } from "./docs";
import { ItemEditor } from "./ItemEditor";
import {
  convertKind,
  hasLinks,
  LinkChips,
  MetaChips,
  PlacementPill,
  ProgressBar,
  itemActions,
  type CardActions,
} from "./focus";
import { TaskPanel } from "./tasks";

const pill =
  "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap";

/**
 * The popup an item opens into: everything about it, read-only. Tasks and docs
 * stay live (they save as you use them) and the footer holds the item actions.
 * The pencil switches the same popup to the editor, and Done comes back here.
 */
export function ItemView({
  item,
  category,
  placement,
  data,
  actions,
  save,
  reload,
  onRestore,
  onClose,
  initialTab = "overview",
}: {
  item: Item;
  category: string;
  placement: FocusSection | null;
  data: WorkshopData;
  actions: CardActions;
  save: (command: Operation, hash?: string) => Promise<WorkshopData>;
  reload: () => Promise<WorkshopData>;
  /** Restores an archived item. */
  onRestore: (item: Item) => void;
  onClose: () => void;
  initialTab?: "overview" | "dev";
}) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"overview" | "dev">(initialTab);
  const [viewingDoc, setViewingDoc] = useState<string | null>(null);
  const [docDraft, setDocDraft] = useState<DocDraft | null>(null);
  const [docError, setDocError] = useState("");
  const { busy, onNotify } = actions;
  // Only a project linked to a local folder has Dev details.
  const hasDev = Boolean(item.localFolder) && !item.archived;
  const showDev = hasDev && tab === "dev";
  // Archived items are read-only until restored.
  const locked = busy || item.archived;

  if (editing)
    return (
      <ItemEditor
        key={item.id}
        item={item}
        data={data}
        save={(command, hash) => save(command, hash)}
        reload={reload}
        notify={onNotify}
        onDone={() => setEditing(false)}
        onClose={onClose}
      />
    );

  async function docCommand(command: Operation, message: string) {
    setDocError("");
    try {
      await save(command);
      onNotify(message);
      return true;
    } catch (error) {
      setDocError((error as Error).message);
      return false;
    }
  }

  const openDoc = item.docs.find((doc) => doc.id === viewingDoc) ?? null;
  const itemOps = itemActions(item, placement, actions);
  const built = item.kind === "project" && item.status === "Built";
  const tasks = item.checklist;

  return (
    <Modal
      open
      onClose={onClose}
      title={item.title}
      width={720}
      titleClassName="max-w-full flex-none text-left text-2xl wrap-anywhere"
      headerTop={
        hasDev && (
          <SegmentedControl
            ariaLabel="Project view"
            stretch
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              { value: "dev", label: "Dev" },
            ]}
          />
        )
      }
      headerAction={
        item.archived ? null : (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Edit ${item.title}`}
            title="Edit"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
        )
      }
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {item.archived ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onRestore(item)}
            >
              Restore
            </Button>
          ) : (
            itemOps
              .filter((action) => !action.destructive)
              .map((action) => (
                <Button
                  key={action.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={action.run}
                >
                  {action.label}
                </Button>
              ))
          )}
          <div className="ml-auto flex gap-2">
            {itemOps
              .filter(
                (action) =>
                  action.destructive &&
                  !(item.archived && action.key === "archive"),
              )
              .map((action) =>
                action.key === "delete" ? (
                  <ConfirmInline
                    key={action.key}
                    label={action.label}
                    disabled={busy}
                    onConfirm={action.run}
                  />
                ) : (
                  <Button
                    key={action.key}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      action.run();
                      // The item leaves this popup's list once archived.
                      onClose();
                    }}
                  >
                    {action.label}
                  </Button>
                ),
              )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <MetaChips
              item={item}
              category={category}
              onSetKind={
                item.archived
                  ? undefined
                  : (kind) => convertKind(item, kind, actions.onSetKind)
              }
            />
            {built && (
              <span
                className={cn(
                  pill,
                  "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
                )}
              >
                Built
              </span>
            )}
            {!built && !item.archived && placement && (
              <PlacementPill placement={placement} />
            )}
            {item.archived && (
              <span className={cn(pill, "bg-muted text-muted-foreground")}>
                Archived
              </span>
            )}
          </div>
          {hasLinks(item) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Links
              </span>
              <LinkChips item={item} />
              {item.links.map((href) => (
                <ChipLink
                  key={href}
                  href={href}
                  kind="other"
                  label={hostLabel(href)}
                />
              ))}
            </div>
          )}
        </div>
        {showDev && <DevPanel item={item} notify={onNotify} />}
        <div hidden={showDev} className="space-y-5">
          {item.description && (
            <section
              aria-label="Description"
              className="rounded-lg bg-muted/50 p-4"
            >
              <h3 className="mb-2 text-sm font-semibold">Description</h3>
              <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-line text-foreground/90">
                {item.description}
              </p>
            </section>
          )}

          <section
            aria-label="Tasks"
            className="space-y-3 rounded-lg border p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Tasks</h3>
              <ProgressBar item={item} size="xs" />
            </div>
            <TaskPanel
              title={item.title}
              description={item.description}
              tasks={tasks}
              busy={locked}
              handlers={actions.taskHandlers(item)}
            />
          </section>

          <DocsSection
            docs={item.docs}
            draft={docDraft}
            onDraftChange={setDocDraft}
            error={docError}
            saved
            busy={locked}
            onOpen={(doc) => setViewingDoc(doc.id)}
            onAdd={(title, body) =>
              docCommand(
                { operation: "addDoc", id: item.id, title, body },
                "Doc added.",
              )
            }
            onRemove={(doc) =>
              void docCommand(
                { operation: "removeDoc", id: item.id, docId: doc.id },
                "Doc deleted.",
              )
            }
          />
        </div>
      </div>
      {openDoc && (
        <DocViewer
          doc={openDoc}
          onClose={() => setViewingDoc(null)}
          onSave={(title, body) =>
            docCommand(
              {
                operation: "editDoc",
                id: item.id,
                docId: openDoc.id,
                title,
                body,
              },
              "Doc saved.",
            )
          }
        />
      )}
    </Modal>
  );
}
