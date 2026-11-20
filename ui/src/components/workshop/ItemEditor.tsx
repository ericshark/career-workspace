"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { StarIcon } from "lucide-react";
import { arrayMove } from "@dnd-kit/sortable";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StyledSelect } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ideaRating,
  itemDraft,
  newDraft,
  type Draft,
  type Item,
  type Kind,
  type Operation,
  type WorkshopData,
} from "@/lib/workshop/model";
import { isWorkshopConflict, Failure, Field } from "./controls";
import {
  DEFAULT_DOC_TITLE,
  DocViewer,
  DocsSection,
  docDraftHasInput,
  type DocDraft,
} from "./docs";
import {
  TaskPanel,
  type NewTask,
  type TaskEntry,
  type TaskHandlers,
  type TaskPatch,
} from "./tasks";

const NEW_CATEGORY = "__new";
// Pill look for the metadata chips; unset optional ones are muted.
const chip =
  "h-7 w-auto rounded-full border-transparent bg-muted px-2.5 pr-2 text-xs font-medium hover:bg-muted/70 dark:bg-muted dark:hover:bg-muted/70";
const mutedChip =
  "border-dashed border-border bg-transparent font-normal text-muted-foreground dark:bg-transparent";

/**
 * Edits an existing item, or creates one when `creating` is given. Creating
 * adds the item and then saves the filled-in form onto it. An existing item
 * has no Save button: Done saves and returns to the view, and leaving any other
 * way (X, Escape, outside click, Back) saves too. If the save is refused the
 * editor stays open with the error and a Discard changes button.
 */
export function ItemEditor({
  item,
  creating,
  data,
  onClose,
  onDone,
  save,
  reload,
  notify,
}: {
  item?: Item;
  creating?: Kind;
  data: WorkshopData;
  /** Leave for good: close the whole popup. */
  onClose: () => void;
  /** An existing item was finished with Done: go back to its view. */
  onDone?: () => void;
  save: (command: Operation, hash: string) => Promise<WorkshopData>;
  reload: () => Promise<WorkshopData>;
  notify: (message: string) => void;
}) {
  const [base, setBase] = useState(() => ({
    item: item ?? null,
    hash: data.hash,
  }));
  const startKind: Kind = item?.kind ?? creating ?? "idea";
  const [type, setType] = useState<Kind>(startKind);
  const [draft, setDraft] = useState(() =>
    item ? itemDraft(item) : newDraft(startKind),
  );
  const [links, setLinks] = useState(() => (item?.links ?? []).join("\n"));
  const [newCategory, setNewCategory] = useState<string | null>(null);
  // Doc open in the viewer, by id so it follows saves.
  const [viewing, setViewing] = useState<string | null>(null);
  const [docError, setDocError] = useState("");
  // The open Add doc form. Save adds it too, so pasted text is never left behind.
  const [docDraft, setDocDraft] = useState<DocDraft | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const original = base.item ? itemDraft(base.item) : newDraft(startKind);
  const savedKind = base.item?.kind ?? null;
  // Docs save on their own, so read them from the latest data.
  const docs =
    data.snapshot.items.find((entry) => entry.id === base.item?.id)?.docs ?? [];
  const viewingDoc = docs.find((doc) => doc.id === viewing) ?? null;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(original) ||
    links !== original.links.join("\n") ||
    type !== startKind ||
    docDraftHasInput(docDraft);
  const editorKey = `workshop:${item?.id ?? "new"}`;
  // A new item has nothing saved yet, so leaving it asks first. An existing
  // item saves on the way out instead.
  function mayDiscard() {
    return !busy && (!dirty || window.confirm("Discard unsaved changes?"));
  }
  function leaveHistory() {
    if (history.state?.workshopEditor === editorKey) history.back();
  }
  function close() {
    leaveHistory();
    onClose();
  }
  function finish() {
    leaveHistory();
    if (onDone) onDone();
    else onClose();
  }
  // Leaving by X, Escape, an outside click or Back. Resolves true when the
  // editor closed.
  async function leave() {
    if (busy) return false;
    if (!base.item) {
      if (!mayDiscard()) return false;
      close();
      return true;
    }
    if (!dirty) {
      close();
      return true;
    }
    return submit({ thenClose: true });
  }
  const onBack = useEffectEvent(() => {
    if (history.state?.workshopEditor === editorKey) return;
    void leave().then((closed) => {
      // Stay on this page while the editor is still open.
      if (!closed) history.pushState({ workshopEditor: editorKey }, "");
    });
  });
  useEffect(() => {
    // Back first closes the editor. Keep a same-page entry while a draft is open.
    if (history.state?.workshopEditor !== editorKey)
      history.pushState({ workshopEditor: editorKey }, "");
    const back = () => onBack();
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [editorKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }
  // The draft the chosen type allows: ideas hold no repository fields and
  // projects are Active unless an existing project was marked Built.
  function resolvedDraft(): Draft {
    const otherLinks = links
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // Ideas keep the same links as projects; only milestones are project-only.
    if (type === "idea")
      return {
        ...draft,
        links: otherLinks,
        status: "Saved",
        deployed: Boolean(draft.liveUrl),
        milestones: [],
      };
    return {
      ...draft,
      links: otherLinks,
      status:
        savedKind === "project" && draft.status === "Built"
          ? "Built"
          : "Active",
      // A Live URL is what makes a project deployed.
      deployed: Boolean(draft.liveUrl),
    };
  }
  async function submit({ thenClose = false } = {}): Promise<boolean> {
    // A doc with a title but no text cannot be saved; say so instead of dropping it.
    if (docDraft && docDraftHasInput(docDraft) && !docDraft.body.trim()) {
      setDocError(
        "Paste the document text, or clear the title, before saving.",
      );
      return false;
    }
    setDocError("");
    if (
      base.item &&
      type === "idea" &&
      savedKind === "project" &&
      draft.milestones.length &&
      !window.confirm("Converting to an idea removes its milestones. Continue?")
    )
      return false;
    setBusy(true);
    setFailure(null);
    try {
      let hash = base.hash;
      let id = base.item?.id;
      if (!base.item) {
        const known = new Set(data.snapshot.items.map((entry) => entry.id));
        const added = await save(
          { operation: "add", kind: type, title: draft.title.trim() },
          hash,
        );
        hash = added.hash;
        id = added.snapshot.items.find((entry) => !known.has(entry.id))?.id;
      } else if (type !== savedKind) {
        // Convert first so the form is saved against the right kind.
        hash = (
          await save(
            { operation: "setKind", id: base.item.id, kind: type },
            hash,
          )
        ).hash;
      }
      if (!id) throw new Error("Could not find the new item.");
      // Add the doc being typed first, so Save keeps it like the Add doc button.
      if (docDraft && docDraftHasInput(docDraft)) {
        hash = (
          await save(
            {
              operation: "addDoc",
              id,
              title: docDraft.title.trim() || DEFAULT_DOC_TITLE,
              body: docDraft.body,
            },
            hash,
          )
        ).hash;
        setBase((previous) => ({ ...previous, hash }));
        setDocDraft(null);
      }
      await save({ operation: "edit", id, draft: resolvedDraft() }, hash);
      notify(
        !base.item
          ? type === "idea"
            ? "Idea added."
            : "Project added."
          : type !== savedKind
            ? type === "project"
              ? "Moved to Projects."
              : "Moved to Ideas."
            : "Saved changes.",
      );
      if (thenClose || !base.item) close();
      else finish();
      return true;
    } catch (error) {
      setFailure(error as Error);
      return false;
    } finally {
      setBusy(false);
    }
  }
  // Docs save straight away, outside the form draft; the editor keeps the new
  // hash so a later Save does not conflict with its own doc change.
  async function docCommand(command: Operation, message: string) {
    setBusy(true);
    setFailure(null);
    setDocError("");
    try {
      const result = await save(command, base.hash);
      setBase((previous) => ({ ...previous, hash: result.hash }));
      notify(message);
      return true;
    } catch (error) {
      setFailure(error as Error);
      // Also shown beside the docs: the top of the form may be scrolled away.
      setDocError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  // Saved straight away so the new category is available to pick right now.
  async function addCategory() {
    const name = newCategory?.trim();
    if (!name) return;
    setBusy(true);
    setFailure(null);
    try {
      const known = new Set(data.snapshot.categories.map((entry) => entry.id));
      const result = await save({ operation: "saveCategory", name }, base.hash);
      setBase((previous) => ({ ...previous, hash: result.hash }));
      const created = result.snapshot.categories.find(
        (entry) => !known.has(entry.id),
      );
      if (created) change("categoryId", created.id);
      setNewCategory(null);
    } catch (error) {
      setFailure(error as Error);
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (!base.item || !mayDiscard()) return;
    setBusy(true);
    try {
      const latest = await reload();
      const fresh = latest.snapshot.items.find(
        (entry) => entry.id === base.item!.id,
      );
      if (!fresh) {
        close();
        return;
      }
      setBase({ item: fresh, hash: latest.hash });
      setType(fresh.kind);
      setDraft(itemDraft(fresh));
      setLinks(fresh.links.join("\n"));
      setFailure(null);
    } catch (error) {
      setFailure(error as Error);
    } finally {
      setBusy(false);
    }
  }
  // Drops the unsaved edits and returns to the view (or closes a new item).
  async function discard() {
    setDraft(original);
    setLinks(original.links.join("\n"));
    setType(startKind);
    setDocDraft(null);
    setFailure(null);
    if (base.item) finish();
    else close();
  }
  const isProject = type === "project";
  const builtAllowed = savedKind === "project" && isProject;
  return (
    <Modal
      open
      onClose={() => void leave()}
      title={base.item ? "Editing" : `New ${type}`}
      width={680}
      footer={
        base.item ? (
          <>
            {dirty && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="mr-auto"
                onClick={() => void discard()}
              >
                Discard changes
              </Button>
            )}
            <Button
              type="submit"
              form="workshop-item"
              disabled={busy || !draft.title.trim()}
            >
              {busy ? "Saving…" : "Done"}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void leave()}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="workshop-item"
              disabled={busy || !draft.title.trim()}
            >
              {busy ? "Working…" : `Add ${type}`}
            </Button>
          </>
        )
      }
    >
      <form
        id="workshop-item"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Failure
          message={failure?.message ?? ""}
          onReload={
            isWorkshopConflict(failure) ? () => void reset() : undefined
          }
        />
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="space-y-2">
            <label className="block">
              <span className="sr-only">Title</span>
              <Input
                required
                autoFocus={!base.item}
                maxLength={200}
                value={draft.title}
                placeholder={type === "idea" ? "Idea name" : "Project name"}
                className="h-9 border-transparent bg-transparent px-2 text-[15px] font-medium shadow-none hover:bg-muted/40 focus-visible:border-input focus-visible:bg-muted/30 focus-visible:ring-0 dark:bg-transparent"
                onChange={(event) => change("title", event.target.value)}
              />
            </label>
            {/* Metadata is a compact row of chips: each opens a small menu. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <StyledSelect
                aria-label="Type"
                className={chip}
                value={type}
                options={[
                  { value: "idea", label: "Idea" },
                  { value: "project", label: "Project" },
                ]}
                onValueChange={(value) => setType(value as Kind)}
              />
              <StyledSelect
                aria-label="Category"
                className={chip}
                value={
                  newCategory !== null ? NEW_CATEGORY : (draft.categoryId ?? "")
                }
                options={[
                  { value: "", label: "Uncategorized" },
                  ...data.snapshot.categories.map(({ id, name }) => ({
                    value: id,
                    label: name,
                  })),
                  { value: NEW_CATEGORY, label: "+ New category…" },
                ]}
                onValueChange={(value) => {
                  if (value === NEW_CATEGORY) setNewCategory("");
                  else {
                    setNewCategory(null);
                    change("categoryId", value || null);
                  }
                }}
              />
              {/* An idea becomes a project first; only then can it be built. */}
              {builtAllowed && (
                <StyledSelect
                  aria-label="Status"
                  className={chip}
                  value={draft.status === "Built" ? "Built" : "Active"}
                  options={[
                    { value: "Active", label: "Active" },
                    { value: "Built", label: "Built" },
                  ]}
                  onValueChange={(value) =>
                    change("status", value as Draft["status"])
                  }
                />
              )}
              {!isProject && (
                <label
                  className={cn(
                    chip,
                    "inline-flex items-center gap-1 border",
                    ideaRating(draft) === null && mutedChip,
                  )}
                >
                  <StarIcon className="size-3" aria-hidden="true" />
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step="any"
                    aria-label="Rating out of 10"
                    placeholder="Rate"
                    className="w-9 bg-transparent text-xs outline-none [appearance:textfield] placeholder:text-muted-foreground [&::-webkit-inner-spin-button]:appearance-none"
                    value={ideaRating(draft) ?? ""}
                    onChange={(event) =>
                      change(
                        "ideaRating",
                        event.target.value === ""
                          ? null
                          : event.target.valueAsNumber,
                      )
                    }
                  />
                  <span className="text-muted-foreground">/10</span>
                </label>
              )}
            </div>
            {newCategory !== null && (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  maxLength={80}
                  value={newCategory}
                  placeholder="New category name"
                  aria-label="New category name"
                  onChange={(event) => setNewCategory(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter adds the category, not the whole form.
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void addCategory();
                  }}
                />
                <Button
                  type="button"
                  disabled={!newCategory.trim()}
                  onClick={() => void addCategory()}
                >
                  Add category
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setNewCategory(null)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
          <Field label="Description">
            <Textarea
              rows={2}
              maxLength={20000}
              value={draft.description}
              placeholder="A sentence or two about what this is."
              onChange={(event) => change("description", event.target.value)}
            />
          </Field>
          <section aria-label="Tasks" className="space-y-2">
            <h3 className="text-sm font-semibold">Tasks</h3>
            <TaskPanel
              title={draft.title}
              description={draft.description}
              tasks={draft.checklist}
              showCompleted
              handlers={listHandlers(draft.checklist, (entries) =>
                change("checklist", entries),
              )}
            />
          </section>
          <DocsSection
            docs={docs}
            draft={docDraft}
            onDraftChange={setDocDraft}
            error={docError}
            saved={Boolean(base.item)}
            busy={busy}
            onOpen={(doc) => setViewing(doc.id)}
            onAdd={(title, body) =>
              docCommand(
                { operation: "addDoc", id: base.item!.id, title, body },
                "Doc added.",
              )
            }
            onRemove={(doc) =>
              void docCommand(
                { operation: "removeDoc", id: base.item!.id, docId: doc.id },
                "Doc deleted.",
              )
            }
          />
          <section aria-label="Links" className="space-y-2">
            <h3 className="text-sm font-semibold">Links</h3>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="GitHub URL">
                  <Input
                    type="url"
                    value={draft.githubUrl}
                    onChange={(event) =>
                      change("githubUrl", event.target.value)
                    }
                  />
                </Field>
                <Field label="Live URL">
                  <Input
                    type="url"
                    value={draft.liveUrl}
                    onChange={(event) => change("liveUrl", event.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Local folder (optional)">
                    <Input
                      value={draft.localFolder}
                      onChange={(event) =>
                        change("localFolder", event.target.value)
                      }
                    />
                  </Field>
                </div>
              </div>
              <Field label="Other links (one URL per line)">
                <Textarea
                  rows={2}
                  value={links}
                  onChange={(event) => setLinks(event.target.value)}
                />
              </Field>
            </div>
          </section>
        </fieldset>
      </form>
      {viewingDoc && (
        <DocViewer
          doc={viewingDoc}
          onClose={() => setViewing(null)}
          onSave={(title, body) =>
            docCommand(
              {
                operation: "editDoc",
                id: base.item!.id,
                docId: viewingDoc.id,
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

/** Applies the optional details (dropped when empty) and clears legacy task fields. */
const patched = (task: TaskEntry, patch: TaskPatch): TaskEntry => {
  const { details: _d, ...rest } = task;
  return {
    ...rest,
    title: patch.title,
    ...(patch.details ? { details: patch.details } : {}),
  };
};

/** Task handlers that edit an in-memory list; changes are saved with the form. */
function listHandlers(
  entries: TaskEntry[],
  onChange: (entries: TaskEntry[]) => void,
): TaskHandlers {
  const add = (tasks: NewTask[]) =>
    onChange([
      ...entries,
      ...tasks.map((task) =>
        patched(
          { id: crypto.randomUUID(), title: task.title, done: false },
          {
            title: task.title,
            details: task.details ?? "",
          },
        ),
      ),
    ]);
  return {
    onToggle: (task, done) =>
      onChange(
        entries.map((entry) =>
          entry.id === task.id ? { ...entry, done } : entry,
        ),
      ),
    onEdit: (task, patch) =>
      onChange(
        entries.map((entry) =>
          entry.id === task.id ? patched(entry, patch) : entry,
        ),
      ),
    onRemove: (task) =>
      onChange(entries.filter((entry) => entry.id !== task.id)),
    onMove: (id, index) =>
      onChange(
        arrayMove(
          entries,
          entries.findIndex((entry) => entry.id === id),
          index,
        ),
      ),
    onAdd: (task) => add([task]),
    onAddMany: add,
  };
}
