"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangleIcon, FolderGit2Icon, GitBranchIcon } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { DevSummary } from "@/lib/dev/types";
import type { Item } from "@/lib/workshop/model";
import { chipClass } from "../HeaderLinks";
import { devGet, plural } from "./api";
import { Chip, Stat } from "./status";

const FRESH_MS = 30_000;
const cache = new Map<string, { at: number; summary: DevSummary }>();

/**
 * The quick facts for a linked project. Loaded when first asked for (a card
 * hover or the Dev tab) and kept for 30 seconds so moving between cards does
 * not run git again each time.
 */
export function useDevSummary(itemId: string, enabled = true) {
  const [summary, setSummary] = useState<DevSummary | null>(
    () => cache.get(itemId)?.summary ?? null,
  );
  const [error, setError] = useState("");
  const load = useCallback(
    async (force = false) => {
      const hit = cache.get(itemId);
      if (hit && !force && Date.now() - hit.at < FRESH_MS) {
        setSummary(hit.summary);
        return;
      }
      try {
        const fresh = await devGet<DevSummary>(itemId, "summary");
        cache.set(itemId, { at: Date.now(), summary: fresh });
        setSummary(fresh);
        setError("");
      } catch (failure) {
        setError((failure as Error).message);
      }
    },
    [itemId],
  );
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  return { summary, error, reload: () => load(true) };
}

/** Forget what was loaded, e.g. after a pull, push or checkout changed it. */
export function forgetDevSummary(itemId: string) {
  cache.delete(itemId);
}

/** The small summary shown when hovering a card's linked-folder icon. */
export function DevSummaryCard({
  summary,
  error,
}: {
  summary: DevSummary | null;
  error: string;
}) {
  if (error) return <p className="p-3 text-xs text-destructive">{error}</p>;
  if (!summary)
    return <p className="p-3 text-xs text-muted-foreground">Reading folder…</p>;
  if (!summary.available)
    return (
      <p className="flex items-start gap-1.5 p-3 text-xs text-muted-foreground">
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
        {summary.problem}
      </p>
    );
  const here = summary.branch;
  // `summary.branch` is always the main checkout (`isMain: true`).
  const mine = summary.attention.filter((entry) => entry.isMain);
  const kind = (name: string) => mine.find((entry) => entry.kind === name);
  const dirtyHere = kind("uncommitted");
  const unpushedHere = kind("unpushed");
  const behindHere = kind("behind");
  const unpublishedHere = kind("unpublished");
  const main = summary.defaultBranch;
  const mainShown = Boolean(
    main && main.name !== here && (main.ahead > 0 || main.behind > 0),
  );
  const others = [
    ...new Set(
      summary.attention
        .filter(
          (entry) =>
            !entry.isMain &&
            !(
              mainShown &&
              entry.branch === main!.name &&
              entry.kind !== "uncommitted"
            ),
        )
        .map((entry) => entry.branch ?? "detached HEAD"),
    ),
  ];
  const onMainInSync =
    main && main.name === here && main.ahead === 0 && main.behind === 0;
  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2.5">
        <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
          {here ?? "Detached HEAD"}
        </span>
        {!here && <Chip tone="warn">Detached HEAD</Chip>}
        <Chip tone="info">Main checkout</Chip>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {dirtyHere ? (
            <Chip
              tone="warn"
              title={plural(dirtyHere.count, "uncommitted file")}
            >
              Uncommitted
            </Chip>
          ) : (
            <Chip tone="good">All committed</Chip>
          )}
          {unpublishedHere && (
            <>
              <Chip
                tone="warn"
                title={plural(unpublishedHere.count, "unpublished commit")}
              >
                Not pushed
              </Chip>
              <Chip tone="neutral">Local only</Chip>
            </>
          )}
          {unpushedHere && (
            <Chip tone="info" title={plural(unpushedHere.count, "commit")}>
              Ahead of {unpushedHere.against}
            </Chip>
          )}
          {behindHere && (
            <Chip tone="warn" title={plural(behindHere.count, "commit")}>
              Behind {behindHere.against}
            </Chip>
          )}
          {onMainInSync && (
            <Chip tone="good" title={`Matches ${main.against}`}>
              In sync
            </Chip>
          )}
          {(unpushedHere || behindHere || onMainInSync) && (
            <Chip tone="neutral">On remote</Chip>
          )}
          {mainShown && main!.ahead > 0 && (
            <Chip tone="neutral" title={plural(main!.ahead, "commit")}>
              {main!.name} ahead of {main!.against}
            </Chip>
          )}
          {mainShown && main!.behind > 0 && (
            <Chip tone="neutral" title={plural(main!.behind, "commit")}>
              {main!.name} behind {main!.against}
            </Chip>
          )}
        </div>
        {others.length > 0 && (
          <p className="flex items-start gap-1.5 text-warning">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Also needs attention:{" "}
              <span className="font-mono">{others.join(", ")}</span>
            </span>
          </p>
        )}
        <div className="grid grid-cols-[1.45fr_1fr_1fr] gap-1.5">
          <Stat
            className="px-2.5"
            label={
              summary.remoteBranches > 0
                ? `Branches · ${summary.remoteBranches} remote`
                : "Branches"
            }
            value={
              <span className="whitespace-nowrap">
                {summary.localBranches}{" "}
                <span className="text-[11px] font-normal text-muted-foreground">
                  local
                </span>
              </span>
            }
          />
          <Stat
            className="px-2.5"
            label="Checkouts"
            value={summary.worktrees}
          />
          <Stat
            className="px-2.5"
            label="Commits"
            value={summary.totalCommits}
          />
        </div>
        {(summary.needsInstall || summary.running.length > 0) && (
          <p className="flex flex-wrap gap-1.5">
            {summary.needsInstall && <Chip tone="warn">Needs install</Chip>}
            {summary.running.map((run) => (
              <Chip key={run.name} tone="good">
                Running
                {run.url ? ` · ${run.url.replace(/^https?:\/\//, "")}` : ""}
              </Chip>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Marks a project card as linked to a local folder. Hovering (or focusing) it
 * shows the summary; clicking opens the project's Dev tab.
 */
export function LinkedFolderIcon({
  item,
  onOpenDev,
}: {
  item: Item;
  onOpenDev: (item: Item) => void;
}) {
  const [open, setOpen] = useState(false);
  // After a click the popup opens under the pointer; the card stays away until
  // the pointer has left the icon, so it never sits on top of the popup.
  const [suppressed, setSuppressed] = useState(false);
  // The card is for hovering. Radix also opens it on focus, which would show it
  // again whenever a closing popup hands focus back to the icon.
  const pointerInside = useRef(false);
  const linked = Boolean(item.localFolder);
  // Loaded up front so hovering opens immediately with cached data.
  const { summary, error } = useDevSummary(item.id, linked);
  if (!linked) return null;
  return (
    <HoverCard
      openDelay={250}
      closeDelay={100}
      open={open && !suppressed}
      onOpenChange={(next) => {
        if (next && !pointerInside.current) return;
        setOpen(next);
      }}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-no-open
          aria-label={`Local folder linked for ${item.title}. Open Dev`}
          onPointerEnter={() => (pointerInside.current = true)}
          onPointerLeave={() => {
            pointerInside.current = false;
            setSuppressed(false);
          }}
          onClick={() => {
            setOpen(false);
            setSuppressed(true);
            onOpenDev(item);
          }}
          className={chipClass}
        >
          <FolderGit2Icon />
          <span>Dev</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent data-no-open className="w-80 overflow-hidden p-0">
        <DevSummaryCard summary={summary} error={error} />
      </HoverCardContent>
    </HoverCard>
  );
}
