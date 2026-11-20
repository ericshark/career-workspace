"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import type { LibraryDoc } from "@/lib/library";

type Summary = Omit<LibraryDoc, "content">;
const endpoint = "/api/library";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (res.status === 204) return undefined as T;
  const result = await res.json();
  if (!res.ok)
    throw new Error(
      result.error?.message ?? "Could not complete the document action",
    );
  return result;
}

function json(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export default function DocsPage() {
  const [docs, setDocs] = useState<Summary[]>([]);
  const [active, setActive] = useState<LibraryDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const picker = useRef<HTMLInputElement>(null);

  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setDocs(await request<Summary[]>(endpoint));
  }

  useEffect(() => {
    void act(reload);
  }, []);

  function edit(doc: LibraryDoc | null) {
    setActive(doc);
    setTitle(doc?.title ?? "");
    setContent(doc?.content ?? "");
    setEditing(true);
  }

  const pdf =
    active?.kind === "pdf" ? `${endpoint}/pdf?id=${active.id}` : undefined;
  const filtered = docs.filter((doc) =>
    doc.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Docs</h1>
        <div className="flex gap-2">
          <input
            ref={picker}
            type="file"
            accept=".md,.txt,.pdf"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              void act(async () => {
                const body = new FormData();
                body.set("file", file);
                const imported = await request<LibraryDoc>(endpoint, {
                  method: "POST",
                  body,
                });
                setActive(imported);
                setEditing(false);
                await reload();
              });
            }}
          />
          <Button
            variant="outline"
            disabled={busy || editing}
            onClick={() => picker.current?.click()}
          >
            <Upload />
            Import file
          </Button>
          <Button disabled={busy || editing} onClick={() => edit(null)}>
            <Plus />
            New doc
          </Button>
        </div>
      </header>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="rounded-xl border bg-card p-3">
          <Input
            aria-label="Search documents"
            placeholder="Search titles"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <ul
            className="mt-3 max-h-52 space-y-1 overflow-auto md:max-h-[70vh]"
            aria-label="Documents"
          >
            {filtered.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  disabled={busy || editing}
                  aria-current={doc.id === active?.id}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-muted ${doc.id === active?.id ? "bg-muted font-medium" : ""}`}
                  onClick={() =>
                    void act(async () =>
                      setActive(await request(`${endpoint}?id=${doc.id}`)),
                    )
                  }
                >
                  <FileText
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {doc.title}
                  </span>
                  {doc.kind === "pdf" && (
                    <span className="text-xs text-muted-foreground">PDF</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!filtered.length && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {busy
                ? "Loading…"
                : filter
                  ? "No matching titles."
                  : "No documents yet."}
            </p>
          )}
        </aside>
        <section
          className="min-w-0 rounded-xl border bg-card p-5 md:p-7"
          aria-label="Document"
        >
          {editing ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  const saved = await request<LibraryDoc>(
                    endpoint,
                    json(active ? "PATCH" : "POST", {
                      id: active?.id,
                      title,
                      ...(pdf ? {} : { content }),
                    }),
                  );
                  setActive(saved);
                  setEditing(false);
                  await reload();
                });
              }}
            >
              <label className="block space-y-1 text-sm">
                <span>Title</span>
                <Input
                  autoFocus
                  required
                  maxLength={150}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              {!pdf && (
                <label className="block space-y-1 text-sm">
                  <span>{active?.kind === "text" ? "Text" : "Markdown"}</span>
                  <Textarea
                    rows={12}
                    maxLength={1048576}
                    value={content}
                    placeholder="Write or paste your notes here…"
                    onChange={(event) => setContent(event.target.value)}
                  />
                </label>
              )}
              <div className="flex gap-2">
                <Button disabled={busy || !title.trim()} type="submit">
                  Save
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  type="button"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : active ? (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <h2 className="min-w-0 break-words text-xl font-semibold">
                  {active.title}
                </h2>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => edit(active)}
                  >
                    {pdf ? "Rename" : "Edit"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Delete “${active.title}”?`)) return;
                      void act(async () => {
                        await request(
                          endpoint,
                          json("DELETE", { id: active.id }),
                        );
                        setActive(null);
                        await reload();
                      });
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {pdf ? (
                <div className="space-y-3">
                  <div className="flex gap-4 text-sm underline">
                    <a href={pdf} target="_blank" rel="noreferrer">
                      Open PDF
                    </a>
                    <a href={pdf + "&download=1"}>Download PDF</a>
                  </div>
                  <iframe
                    title={active.title}
                    src={pdf}
                    className="h-[65vh] w-full rounded border"
                  />
                </div>
              ) : active.kind === "text" ? (
                <p className="whitespace-pre-wrap break-words">
                  {active.content}
                </p>
              ) : (
                <Markdown
                  externalOnly
                  hideImages
                  className="md-reading break-words"
                >
                  {active.content}
                </Markdown>
              )}
            </>
          ) : (
            <div className="grid min-h-56 place-content-center text-center">
              <p className="font-medium">Keep career notes in one place</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a note or import a Markdown, text, or PDF file.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
