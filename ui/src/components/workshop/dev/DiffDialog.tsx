"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import type { ChangesResult } from "@/lib/dev/types";
import { cn } from "@/lib/utils";
import { devGet } from "./api";

const statusWord = (code: string) =>
  code === "??"
    ? "new"
    : code.includes("D")
      ? "deleted"
      : code.includes("R")
        ? "renamed"
        : code.includes("A")
          ? "added"
          : "modified";

const lineClass = (line: string) =>
  line.startsWith("+++") || line.startsWith("---")
    ? "text-muted-foreground"
    : line.startsWith("+")
      ? "bg-success/10 text-success"
      : line.startsWith("-")
        ? "bg-destructive/10 text-destructive"
        : line.startsWith("@@")
          ? "text-sky-600 dark:text-sky-400"
          : line.startsWith("diff ")
            ? "mt-2 font-semibold"
            : "";

/** What is uncommitted in one checkout: the changed files, then a regular unified diff. */
export function DiffDialog({
  itemId,
  worktree,
  branch,
  onClose,
}: {
  itemId: string;
  worktree: string;
  branch: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<ChangesResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    devGet<ChangesResult>(itemId, "changes", { worktree })
      .then(setResult)
      .catch((failure: Error) => setError(failure.message));
  }, [itemId, worktree]);
  return (
    <Modal
      open
      onClose={onClose}
      width={900}
      title={
        <>
          Changes on <span className="font-mono">{branch}</span>
        </>
      }
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !result ? (
        <p className="text-sm text-muted-foreground">Reading changes…</p>
      ) : result.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Everything is committed.
        </p>
      ) : (
        <div className="space-y-3">
          <ul aria-label="Changed files" className="space-y-0.5 text-xs">
            {result.files.map((file) => (
              <li key={file.path} className="flex gap-2">
                <span className="w-16 shrink-0 text-muted-foreground">
                  {statusWord(file.status)}
                </span>
                <span className="font-mono break-all">{file.path}</span>
              </li>
            ))}
          </ul>
          <pre
            aria-label="Diff"
            className="max-h-[55vh] overflow-auto rounded-lg border bg-muted/30 p-2 font-mono text-xs leading-relaxed"
          >
            {result.diff.split("\n").map((line, index) => (
              <div
                key={index}
                className={cn("px-1 whitespace-pre", lineClass(line))}
              >
                {line || " "}
              </div>
            ))}
          </pre>
          {result.truncated && (
            <p className="text-xs text-warning">
              The diff is long, so only the first part is shown.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
