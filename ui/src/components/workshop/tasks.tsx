"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRightIcon,
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  PlusIcon,
  SendHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { taskGroups } from "@/lib/workshop/model";
import { cn } from "@/lib/utils";
import { workshopRequest } from "./controls";
import { SortableList } from "./Sortable";

export type TaskEntry = {
  id: string;
  title: string;
  done: boolean;
  details?: string;
};
export type NewTask = {
  title: string;
  details?: string;
};
export type TaskPatch = {
  title: string;
  details: string;
};

/** Everything a task list can do; the card and the editor supply different implementations. */
export type TaskHandlers = {
  onToggle: (task: TaskEntry, done: boolean) => void;
  onEdit: (task: TaskEntry, patch: TaskPatch) => void;
  onRemove: (task: TaskEntry) => void;
  /** Move the task to `index` in the full task list. */
  onMove: (taskId: string, index: number) => void;
  onAdd: (task: NewTask) => void;
  onAddMany: (tasks: NewTask[]) => void;
};

/**
 * Completing takes two clicks: the first turns the circle into two choices (a
 * green check to complete, a gray X to cancel). They stay until one is picked,
 * the user clicks elsewhere, or presses Escape. Reopening a finished task is a
 * single click.
 */
function CompleteButton({
  done,
  disabled,
  label,
  onChange,
}: {
  done: boolean;
  disabled?: boolean;
  label: string;
  onChange: (done: boolean) => void;
}) {
  const [armed, setArmed] = useState(false);
  const pair = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!armed) return;
    const away = (event: PointerEvent) => {
      if (!pair.current?.contains(event.target as Node)) setArmed(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArmed(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [armed]);
  if (armed && !done)
    return (
      <span ref={pair} className="mt-0.5 flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          autoFocus
          aria-label={`Confirm complete ${label}`}
          onClick={() => {
            setArmed(false);
            onChange(true);
          }}
          className="grid size-5 place-items-center rounded-full bg-emerald-500 text-white transition-colors hover:bg-emerald-600 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        >
          <CheckIcon className="size-3" />
        </button>
        <button
          type="button"
          aria-label={`Cancel complete ${label}`}
          onClick={() => setArmed(false)}
          className="grid size-5 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <XIcon className="size-3" />
        </button>
      </span>
    );
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={done ? `Reopen ${label}` : `Complete ${label}`}
      aria-pressed={done}
      onClick={() => (done ? onChange(false) : setArmed(true))}
      className={cn(
        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50",
        done
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-muted-foreground/40 hover:border-muted-foreground",
      )}
    >
      <CheckIcon
        className={cn(
          "size-3 transition-transform duration-150",
          done ? "scale-100" : "scale-0",
        )}
      />
    </button>
  );
}

export function TaskCard({
  task,
  number,
  busy,
  handlers,
}: {
  task: TaskEntry;
  /** Position among the open tasks. */
  number?: number;
  busy?: boolean;
  handlers: Pick<TaskHandlers, "onToggle" | "onEdit" | "onRemove">;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [details, setDetails] = useState(task.details ?? "");
  function saveEdit() {
    if (!title.trim()) return;
    handlers.onEdit(task, {
      title: title.trim(),
      details: details.trim(),
    });
    setEditing(false);
  }
  if (editing) {
    return (
      // A plain container, not a <form>: tasks are also edited inside the
      // editor's own form, and Enter must not submit that one.
      <div
        role="group"
        aria-label="Edit task"
        className="space-y-2 rounded-lg border border-ring/50 bg-background p-2.5"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setEditing(false);
          } else if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement
          ) {
            event.preventDefault();
            saveEdit();
          }
        }}
      >
        <Input
          autoFocus
          required
          maxLength={500}
          value={title}
          aria-label="Task title"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Input
          maxLength={1000}
          value={details}
          placeholder="Details (optional)"
          aria-label="Task details"
          onChange={(event) => setDetails(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="ml-auto flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!title.trim()}
              onClick={saveEdit}
            >
              Save
            </Button>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "group/task flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/50",
        task.done && "opacity-60",
      )}
    >
      <CompleteButton
        done={task.done}
        disabled={busy}
        label={task.title}
        onChange={(done) => handlers.onToggle(task, done)}
      />
      {number !== undefined && (
        <span
          aria-hidden="true"
          className="mt-0.5 w-4 shrink-0 text-right text-sm text-muted-foreground tabular-nums"
        >
          {number}.
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        aria-label={`Edit task ${task.title}`}
        onClick={() => {
          setTitle(task.title);
          setDetails(task.details ?? "");
          setEditing(true);
        }}
        className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span
          className={cn(
            "block text-sm leading-snug wrap-anywhere",
            task.done && "text-muted-foreground",
          )}
        >
          {task.title}
        </span>
        {task.details && (
          <span className="mt-0.5 block text-xs leading-snug wrap-anywhere text-muted-foreground">
            {task.details}
          </span>
        )}
      </button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={busy}
        aria-label={`Remove task ${task.title}`}
        onClick={() => handlers.onRemove(task)}
        className="-my-0.5 shrink-0 text-muted-foreground opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

type Suggestion = { title: string; details: string; keep: boolean };

/**
 * The add box. It starts as a small "Add task" button; opened, it takes a task
 * (Enter adds, pasting several lines adds one per line). A mode button names
 * the AI mode ("Tidy tasks" rewrites what was typed more succinctly, "Expand"
 * fills in missing steps; click to switch) and Send runs it. AI results
 * preview inline and are added only when kept.
 */
export function TaskInput({
  initiallyOpen = false,
  context,
  disabled,
  noun = "task",
  ai = true,
  onAdd,
  onAddMany,
}: {
  initiallyOpen?: boolean;
  context?: { title: string; description: string; existing: string[] };
  disabled?: boolean;
  noun?: string;
  ai?: boolean;
  onAdd: (task: NewTask) => void;
  onAddMany: (tasks: NewTask[]) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"list" | "plan">("list");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const seed =
    text.trim() ||
    [context?.title, context?.description].filter(Boolean).join(". ");

  function close() {
    setOpen(false);
    setText("");
    setSuggestions(null);
    setError("");
  }
  function submit() {
    if (!text.trim() || disabled) return;
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) onAddMany(lines.map((title) => ({ title })));
    else onAdd({ title: lines[0] });
    setText("");
  }
  async function suggest() {
    if (!context || loading) return;
    setSuggestions(null);
    setLoading(true);
    setError("");
    try {
      const result = await workshopRequest<{
        tasks: { title: string; details: string }[];
      }>("/api/workshop/tasks", { mode, text: seed, ...context });
      setSuggestions(result.tasks.map((task) => ({ ...task, keep: true })));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }
  if (!open)
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
      >
        <PlusIcon className="size-4" /> Add {noun}
      </button>
    );
  // Tidy needs something typed; Expand can work from the project's own text.
  const canSend =
    mode === "list" ? text.trim().length >= 3 : seed.trim().length >= 3;
  const kept = suggestions?.filter((task) => task.keep) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-0.5 rounded-lg border bg-background pr-1 focus-within:ring-2 focus-within:ring-ring/50">
        <input
          autoFocus
          value={text}
          disabled={disabled}
          maxLength={2000}
          placeholder={`Add a ${noun}…`}
          aria-label={`Add a ${noun}`}
          className="h-8 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (!/\r?\n/.test(pasted.trim())) return;
            event.preventDefault();
            setText((value) => (value ? `${value}\n${pasted}` : pasted));
          }}
          onKeyDown={(event) => {
            // The input can sit inside the editor's form; Enter must not submit it.
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        />
        {ai && context && (
          <>
            <button
              type="button"
              disabled={disabled || loading}
              aria-label={`AI mode: ${mode === "list" ? "Tidy tasks" : "Expand"}, click to switch`}
              title={
                mode === "list"
                  ? "Rewrites what you wrote into succinct tasks. Click to switch to Expand."
                  : "Adds the steps that are missing. Click to switch to Tidy tasks."
              }
              onClick={() =>
                setMode((value) => (value === "list" ? "plan" : "list"))
              }
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-muted px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
            >
              <ArrowLeftRightIcon className="size-3 text-muted-foreground" />
              {mode === "list" ? "Tidy tasks" : "Expand"}
            </button>
            {canSend && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={disabled || loading}
                aria-label="Send to AI"
                title="Send to AI"
                onClick={() => void suggest()}
                className="text-primary hover:text-primary"
              >
                {loading ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SendHorizontalIcon />
                )}
              </Button>
            )}
          </>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close add task"
          onClick={close}
          className="text-muted-foreground"
        >
          <XIcon />
        </Button>
      </div>
      {loading && (
        <p
          role="status"
          className="flex items-center gap-2 px-1 text-sm text-muted-foreground"
        >
          <Loader2Icon className="size-4 animate-spin" /> Generating tasks…
        </p>
      )}
      {error && (
        <p role="alert" className="px-1 text-sm text-destructive">
          {error}
        </p>
      )}
      {suggestions && (
        <section
          aria-label="Suggested tasks"
          className="space-y-1.5 rounded-lg border bg-muted/20 p-2"
        >
          <ul className="space-y-1">
            {suggestions.map((task, index) => (
              <li key={index} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-2 size-4 shrink-0 accent-primary"
                  checked={task.keep}
                  aria-label={`Keep ${task.title}`}
                  onChange={(event) =>
                    setSuggestions((list) =>
                      list!.map((entry, at) =>
                        at === index
                          ? { ...entry, keep: event.target.checked }
                          : entry,
                      ),
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <Input
                    value={task.title}
                    maxLength={500}
                    aria-label={`Suggested task ${index + 1}`}
                    className="h-8"
                    onChange={(event) =>
                      setSuggestions((list) =>
                        list!.map((entry, at) =>
                          at === index
                            ? { ...entry, title: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                  {task.details && (
                    <p className="px-1 pt-0.5 text-xs text-muted-foreground">
                      {task.details}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSuggestions(null)}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!kept.length || kept.some((task) => !task.title.trim())}
              onClick={() => {
                onAddMany(
                  kept.map((task) => ({
                    title: task.title.trim(),
                    details: task.details.trim() || undefined,
                  })),
                );
                setSuggestions(null);
                setText("");
              }}
            >
              Add {kept.length} task{kept.length === 1 ? "" : "s"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Open tasks as one numbered, draggable list, a collapsed Completed list, and
 * the add box. Numbers are positions among open tasks, so completing one
 * renumbers the rest and reopening restores it.
 */
export function TaskPanel({
  title,
  description,
  tasks,
  busy,
  handlers,
  showCompleted = false,
  startAdding = false,
}: {
  title: string;
  description: string;
  tasks: TaskEntry[];
  busy?: boolean;
  handlers: TaskHandlers;
  /** Start with the Completed list open (the editor shows everything). */
  showCompleted?: boolean;
  startAdding?: boolean;
}) {
  const [showDone, setShowDone] = useState(showCompleted);
  const { open, done } = taskGroups(tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  // Reordering happens among open tasks; map the drop position to the full list.
  const reorder = (id: string, index: number) => {
    const target = open[index];
    if (target) handlers.onMove(id, tasks.indexOf(target));
  };
  return (
    // Keeps pointer drags on tasks from also lifting the card that holds them.
    <div data-no-drag className="space-y-1.5">
      {open.length > 0 && (
        <SortableList
          ids={open.map((task) => task.id)}
          label={`Open tasks for ${title}`}
          className="space-y-0.5"
          itemLabel={(id) => byId.get(id)?.title ?? "task"}
          onReorder={reorder}
          renderItem={(id) => (
            <TaskCard
              task={byId.get(id)!}
              number={open.findIndex((task) => task.id === id) + 1}
              busy={busy}
              handlers={handlers}
            />
          )}
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-60">
          <TaskInput
            initiallyOpen={startAdding}
            disabled={busy}
            context={{
              title,
              description,
              existing: tasks.map((task) => task.title),
            }}
            onAdd={handlers.onAdd}
            onAddMany={handlers.onAddMany}
          />
        </div>
        {done.length > 0 && (
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => setShowDone((value) => !value)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {showDone ? "Hide completed" : "View completed"} ({done.length})
            <ChevronDownIcon
              className={cn(
                "size-3.5 transition-transform",
                showDone && "rotate-180",
              )}
            />
          </button>
        )}
      </div>
      {showDone && done.length > 0 && (
        <ul aria-label={`Done tasks for ${title}`} className="space-y-0.5">
          {done.map((task) => (
            <li key={task.id}>
              <TaskCard task={task} busy={busy} handlers={handlers} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
