"use client";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_QUICK } from "@/lib/config";
import { jobKeyFromUrl, normalizeUrl } from "@/lib/duplicates";
import { cn } from "@/lib/utils";
import { splitJobPaste } from "../applyHelpers";
import { MIN_QUICK, type QuickDraft } from "./useQuickDrafts";

export interface ExistingQuickLink {
  link: string;
  label: string;
}

/**
 * Replace the textarea's selection with `text` the way typing would, so the browser's own undo still
 * works and React sees a normal input event. Falls back to a plain value update.
 */
export function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement,
  text: string,
  fallback: (value: string) => void,
) {
  el.focus();
  // execCommand is deprecated but still the only way to keep the native undo stack for a paste.
  if (document.execCommand?.("insertText", false, text)) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  fallback(el.value.slice(0, start) + text + el.value.slice(end));
}

/**
 * One compact card per job: an optional URL and a description that shows two lines until expanded.
 * Each card is sent as its own job, so two descriptions can never merge into one.
 */
export function QuickJobList({
  drafts,
  disabled,
  existingLinks = [],
  onUpdate,
  onAdd,
  onRemove,
  onSubmit,
}: {
  drafts: QuickDraft[];
  disabled?: boolean;
  existingLinks?: ExistingQuickLink[];
  onUpdate: (id: string, patch: Partial<Omit<QuickDraft, "id">>) => void;
  /** Adds an empty card and returns its id (null when the list is full). */
  onAdd: () => string | null;
  onRemove: (id: string) => void;
  onSubmit: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const descriptions = useRef(new Map<string, HTMLTextAreaElement>());
  useEffect(() => {
    if (!focusId) return;
    descriptions.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId, drafts]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const submitOnShortcut = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };
  // A paste leaves the caret (and the visible lines) at the end; show the top, usually the title.
  const showTop = (el: HTMLTextAreaElement) =>
    requestAnimationFrame(() => {
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    });
  const lone = drafts.length === 1;
  const full = drafts.length >= MAX_QUICK;

  return (
    <div className="flex flex-col gap-2.5">
      <ol className="flex flex-col gap-2.5">
        {drafts.map((d, i) => {
          const n = i + 1;
          const open = expanded.has(d.id);
          const chars = d.description.trim().length;
          const short = (chars > 0 || d.url.trim() !== "") && chars < MIN_QUICK;
          const empty = !d.url.trim() && !chars;
          const normUrl = d.url.trim() ? normalizeUrl(d.url) : "";
          const urlKey = d.url.trim() ? jobKeyFromUrl(d.url) : null;
          const matchUrl = (otherLink: string) => {
            if (!otherLink.trim() || (!normUrl && !urlKey)) return false;
            if (normUrl && normalizeUrl(otherLink) === normUrl) return true;
            if (urlKey && jobKeyFromUrl(otherLink) === urlKey) return true;
            return false;
          };
          const earlierIdx = drafts
            .slice(0, i)
            .findIndex((other) => matchUrl(other.url));
          const existingMatch =
            earlierIdx < 0
              ? existingLinks.find((item) => matchUrl(item.link))
              : undefined;
          const duplicateUrlWarning =
            earlierIdx >= 0
              ? `Duplicate URL in this batch (Job ${earlierIdx + 1})`
              : existingMatch
                ? `Possible duplicate · ${existingMatch.label}`
                : null;
          return (
            <li
              key={d.id}
              className="overflow-hidden rounded-xl border bg-muted/25 transition-colors focus-within:border-ring"
            >
              <div className="flex items-center justify-between gap-2 border-b bg-muted/35 px-3 py-1.5">
                <span className="flex items-center gap-2.5 text-xs font-medium">
                  <span
                    aria-hidden
                    className="flex size-6 items-center justify-center rounded-md border bg-card text-[10px] text-muted-foreground"
                  >
                    {String(n).padStart(2, "0")}
                  </span>
                  Job {n}
                </span>
                <div className="flex items-center gap-1">
                  <span
                    className={cn(
                      "mr-2 text-[10px] tabular-nums",
                      short ? "text-warning" : "text-muted-foreground",
                    )}
                    title={
                      short
                        ? `Needs at least ${MIN_QUICK} characters of description`
                        : undefined
                    }
                  >
                    {short
                      ? `${chars}/${MIN_QUICK} characters`
                      : chars
                        ? `${chars} characters`
                        : "Ready for a job post"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => toggle(d.id)}
                    aria-label={`${open ? "Collapse" : "Expand"} Job ${n} description`}
                    aria-expanded={open}
                    title={open ? "Collapse" : "Show more of the description"}
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-3.5 transition-transform",
                        open && "rotate-180",
                      )}
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemove(d.id)}
                    disabled={disabled || (lone && empty)}
                    aria-label={`Remove Job ${n}`}
                    title="Remove this job"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
              {d.url && (
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1 text-xs">
                  <span className="shrink-0 text-muted-foreground">
                    Posting
                  </span>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate underline decoration-border underline-offset-4"
                  >
                    {d.url}
                  </a>
                  {duplicateUrlWarning && (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-warning"
                      role="status"
                    >
                      <TriangleAlertIcon className="size-3 shrink-0" />
                      {duplicateUrlWarning}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove Job ${n} link`}
                    disabled={disabled}
                    onClick={() => onUpdate(d.id, { url: "" })}
                  >
                    <XIcon className="size-3" />
                  </Button>
                </div>
              )}
              <div className="px-3 py-2.5">
                <Textarea
                  ref={(el) => {
                    if (el) descriptions.current.set(d.id, el);
                    else descriptions.current.delete(d.id);
                  }}
                  aria-label={`Job ${n} description`}
                  rows={open ? 12 : 2}
                  className={cn(
                    "min-h-0 w-full field-sizing-fixed border-0 bg-transparent p-0 pl-0.5 text-sm leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent",
                    open
                      ? "resize-y"
                      : "h-[40px] resize-none overflow-hidden pb-0",
                  )}
                  placeholder="Paste the job description here…"
                  value={d.description}
                  disabled={disabled}
                  onChange={(e) =>
                    onUpdate(d.id, { description: e.target.value })
                  }
                  onPaste={(e) => {
                    const raw = e.clipboardData.getData("text");
                    if (!raw) return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const paste = splitJobPaste(raw);
                    const shouldSetUrl =
                      !!paste.link && (!d.url.trim() || !paste.text);
                    if (shouldSetUrl) onUpdate(d.id, { url: paste.link! });
                    if (paste.text)
                      insertAtCursor(el, paste.text, (value) =>
                        onUpdate(d.id, {
                          ...(shouldSetUrl ? { url: paste.link! } : {}),
                          description: value,
                        }),
                      );
                    if (
                      paste.text &&
                      !drafts.some(
                        (other) =>
                          other.id !== d.id && !other.description.trim(),
                      ) &&
                      !full
                    )
                      onAdd();
                    if (!open) showTop(el);
                  }}
                  onBlur={(e) => {
                    if (!open) e.currentTarget.scrollTop = 0;
                  }}
                  onKeyDown={submitOnShortcut}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-dashed bg-transparent"
          onClick={() => {
            const id = onAdd();
            if (id) setFocusId(id);
          }}
          disabled={disabled || full}
          title={full ? `Up to ${MAX_QUICK} jobs per batch` : undefined}
        >
          <PlusIcon data-icon="inline-start" />
          Add job
        </Button>
        <span
          className={cn(
            "text-xs tabular-nums",
            drafts.length > MAX_QUICK
              ? "text-warning"
              : "text-muted-foreground",
          )}
        >
          {drafts.filter((d) => d.description.trim() || d.url.trim()).length}/
          {MAX_QUICK}
          {drafts.filter((d) => d.description.trim() || d.url.trim()).length >=
          MAX_QUICK
            ? " · batch is full"
            : " jobs in this batch"}
        </span>
      </div>
    </div>
  );
}
