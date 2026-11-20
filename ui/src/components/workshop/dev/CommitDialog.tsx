"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { devPost, plural } from "./api";

/** Asks for a message, then commits every change in one checkout. */
export function CommitDialog({
  itemId,
  worktree,
  branch,
  files,
  onClose,
  onDone,
}: {
  itemId: string;
  worktree: string;
  branch: string;
  files: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function commit() {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await devPost(itemId, "commit", { worktree, message });
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Commit all changes"
      width={520}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !message.trim()}
            onClick={() => void commit()}
          >
            {busy ? "Committing…" : "Commit"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Commits {plural(files, "changed file")} on{" "}
          <span className="font-mono text-foreground">{branch}</span>, new files
          included. Nothing is pushed.
        </p>
        <Textarea
          autoFocus
          rows={4}
          maxLength={5000}
          value={message}
          disabled={busy}
          aria-label="Commit message"
          placeholder="Commit message"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void commit();
            }
          }}
        />
        {error && (
          <p role="alert" className="text-sm break-words text-destructive">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
