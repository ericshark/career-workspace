"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { CopyPath } from "@/components/CopyPath";
import { Markdown } from "@/components/Markdown";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { maxDocs, type Doc } from "@/lib/workshop/model";
import { Field } from "./controls";

/** Saves a document; resolves false when the save failed and the form should stay open. */
export type SaveDoc = (title: string, body: string) => Promise<boolean>;

/** Title given to a doc when none is typed. */
export const DEFAULT_DOC_TITLE = "Spec";

/** What has been typed into the Add doc form so far. */
export type DocDraft = { title: string; body: string };

/**
 * Whether the Add doc form holds anything worth saving. The untouched default
 * title does not count; any pasted text or a changed title does.
 */
export function docDraftHasInput(draft: DocDraft | null) {
  if (!draft) return false;
  const title = draft.title.trim();
  return (
    draft.body.trim() !== "" || (title !== "" && title !== DEFAULT_DOC_TITLE)
  );
}

/** Icon button that copies a doc's exact text and confirms with a check. */
function CopyIconButton({ text, title }: { text: string; title: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={`Copy ${title}`}
      className={done ? "text-emerald-600" : "text-muted-foreground"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable (non-secure context); ignore */
        }
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/** Title plus a large paste box, shared by Add doc and the viewer's Edit. */
function DocForm({
  doc,
  initial,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  doc?: Doc;
  /** Starting values for a new doc; the editor keeps them to save with the item. */
  initial?: DocDraft;
  busy?: boolean;
  onChange?: (draft: DocDraft) => void;
  onSave: SaveDoc;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(
    doc?.title ?? initial?.title ?? DEFAULT_DOC_TITLE,
  );
  const [body, setBody] = useState(doc?.body ?? initial?.body ?? "");
  // A new doc's title starts as the default until the user types in it.
  const [titleEdited, setTitleEdited] = useState(
    Boolean(doc) ||
      (initial !== undefined && initial.title !== DEFAULT_DOC_TITLE),
  );
  const update = (next: DocDraft) => {
    setTitle(next.title);
    setBody(next.body);
    onChange?.(next);
  };
  // Only the text is required; an empty title falls back to the default.
  const ready = body.trim();
  return (
    // A div, not a form: the editor already wraps this in its own form.
    <div data-handles-escape className="space-y-3">
      <Field label="Document title">
        <Input
          autoFocus
          maxLength={120}
          value={title}
          placeholder={DEFAULT_DOC_TITLE}
          // The default is selected on entry until the title is edited.
          onFocus={(event) => {
            if (!doc && !titleEdited) event.target.select();
          }}
          // Pressing in keeps the whole default selected (the browser would
          // otherwise drop the caret in the middle), so typing replaces it.
          onMouseDown={(event) => {
            if (doc || titleEdited) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setTitleEdited(true);
            update({ title: event.target.value, body });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
            if (event.key === "Escape") onCancel();
          }}
        />
      </Field>
      <Field label="Document text">
        <Textarea
          rows={12}
          maxLength={200_000}
          value={body}
          placeholder="Paste the spec, research, or notes here. Markdown is rendered."
          className="max-h-[50vh] font-mono text-xs"
          onChange={(event) => update({ title, body: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || !ready}
          onClick={() => void onSave(title.trim() || DEFAULT_DOC_TITLE, body)}
        >
          {doc ? "Save doc" : "Add doc"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Reads a document: rendered markdown or the raw text, Copy for the exact
 * pasted text, and Edit in place.
 */
export function DocViewer({
  doc,
  onClose,
  onSave,
}: {
  doc: Doc;
  onClose: () => void;
  onSave: SaveDoc;
}) {
  const [mode, setMode] = useState<"rendered" | "raw" | "edit">("rendered");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      width={860}
      title={
        <span className="flex items-center gap-2">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 wrap-anywhere">{doc.title}</span>
        </span>
      }
      headerAction={
        mode !== "edit" && (
          <div className="flex shrink-0 items-center gap-1">
            <CopyPath path={doc.body} label="Copy" />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-pressed={mode === "raw"}
              onClick={() => setMode(mode === "raw" ? "rendered" : "raw")}
            >
              {mode === "raw" ? "Rendered" : "Raw"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setMode("edit")}
            >
              <PencilIcon data-icon="inline-start" /> Edit
            </Button>
          </div>
        )
      }
    >
      {mode === "edit" ? (
        <DocForm
          doc={doc}
          busy={busy}
          onCancel={() => setMode("rendered")}
          onSave={async (title, body) => {
            setBusy(true);
            const saved = await onSave(title, body);
            setBusy(false);
            if (saved) setMode("rendered");
            return saved;
          }}
        />
      ) : mode === "raw" ? (
        <pre className="text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere">
          {doc.body}
        </pre>
      ) : (
        <Markdown externalOnly className="text-sm">
          {doc.body}
        </Markdown>
      )}
    </Modal>
  );
}

/**
 * The editor's Docs list. Docs save immediately through their own operations,
 * so they need an item that already exists.
 */
export function DocsSection({
  docs,
  saved,
  busy,
  onOpen,
  onAdd,
  onRemove,
  error,
  draft,
  onDraftChange,
}: {
  docs: Doc[];
  /** False while creating a new item: docs attach after the first save. */
  saved: boolean;
  busy: boolean;
  onOpen: (doc: Doc) => void;
  onAdd: SaveDoc;
  onRemove: (doc: Doc) => void;
  /** Last save problem, shown here because the form can sit below the fold. */
  error?: string;
  /** The Add doc form's contents, or null while it is closed. Kept by the editor. */
  draft: DocDraft | null;
  onDraftChange: (draft: DocDraft | null) => void;
}) {
  const adding = draft !== null;
  // The doc just added is highlighted and scrolled into view for a moment.
  const [fresh, setFresh] = useState<string | null>(null);
  const known = useRef(new Set(docs.map((doc) => doc.id)));
  const freshRow = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const added = docs.find((doc) => !known.current.has(doc.id));
    known.current = new Set(docs.map((doc) => doc.id));
    if (!added) return;
    setFresh(added.id);
    const timer = setTimeout(() => setFresh(null), 4000);
    return () => clearTimeout(timer);
  }, [docs]);
  useEffect(() => {
    if (fresh) freshRow.current?.scrollIntoView({ block: "nearest" });
  }, [fresh]);
  return (
    <section aria-label="Docs" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Docs</h3>
        {saved && !adding && docs.length < maxDocs && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              onDraftChange({ title: DEFAULT_DOC_TITLE, body: "" })
            }
          >
            <PlusIcon /> Add doc
          </Button>
        )}
      </div>
      {!saved && (
        <p className="text-xs text-muted-foreground">
          Save the item first, then paste specs or other long text here.
        </p>
      )}
      {docs.length > 0 && (
        <ul aria-label="Documents" className="divide-y rounded-lg border">
          {docs.map((doc) => (
            <li
              key={doc.id}
              ref={doc.id === fresh ? freshRow : undefined}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 transition-colors",
                doc.id === fresh && "bg-emerald-50 dark:bg-emerald-500/10",
              )}
            >
              <button
                type="button"
                onClick={() => onOpen(doc)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline"
              >
                <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{doc.title}</span>
              </button>
              {doc.id === fresh && (
                <span
                  role="status"
                  className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                >
                  Added
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {doc.body.length.toLocaleString()} chars
              </span>
              <CopyIconButton text={doc.body} title={doc.title} />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Delete ${doc.title}`}
                className="text-muted-foreground"
                onClick={() => {
                  if (window.confirm(`Delete “${doc.title}”?`)) onRemove(doc);
                }}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {draft && (
        <DocForm
          initial={draft}
          busy={busy}
          onChange={onDraftChange}
          onCancel={() => onDraftChange(null)}
          onSave={async (title, body) => {
            const saved = await onAdd(title, body);
            if (saved) onDraftChange(null);
            return saved;
          }}
        />
      )}
    </section>
  );
}
