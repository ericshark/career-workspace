import { workshopRequest } from "../controls";
import type { BranchCompare, BranchInfo, BranchList } from "@/lib/dev/types";

/** One Dev request for a Workshop project; the server picks the folder from the item id. */
export async function devGet<T>(
  itemId: string,
  action: string,
  query: Record<string, string | number | null | undefined> = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== null && value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return workshopRequest<T>(
    `/api/workshop/dev/${itemId}/${action}${text ? `?${text}` : ""}`,
  );
}

export function devPost<T = { ok: true }>(
  itemId: string,
  action: string,
  body: object = {},
): Promise<T> {
  return workshopRequest<T>(`/api/workshop/dev/${itemId}/${action}`, body);
}

export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function timeAgo(ms: number | null): string {
  if (!ms) return "";
  const steps: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.35, "w"],
    [12, "mo"],
    [Infinity, "y"],
  ];
  let value = Math.max(0, (Date.now() - ms) / 1000);
  for (const [size, unit] of steps) {
    if (value < size)
      return unit === "s" ? "just now" : `${Math.floor(value)}${unit} ago`;
    value /= size;
  }
  return "";
}

export const fullDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

/** Relative time, with the date and time added once a commit is more than two days old. */
export function commitTime(ms: number, now = Date.now()) {
  const relative = timeAgo(ms);
  return now - ms > 2 * 24 * 60 * 60 * 1000
    ? `${relative} · ${fullDate(ms)}`
    : relative;
}

/** Local branch a remote branch is switched through: `origin/feat/x` → `feat/x`. */
export const localNameOf = (branch: BranchInfo) =>
  branch.remote ? branch.name.slice(branch.name.indexOf("/") + 1) : branch.name;

export type BranchState =
  | { kind: "current" }
  | { kind: "elsewhere"; path: string; dirty: number | null }
  | { kind: "available" };

/** What switching `worktree` to `branch` would do. A remote branch counts as its local counterpart. */
export function branchState(
  branch: BranchInfo,
  list: BranchList,
  worktree: string,
): BranchState {
  const name = localNameOf(branch);
  const local = list.branches.find((b) => !b.remote && b.name === name);
  if (!local?.checkedOutIn) return { kind: "available" };
  if (local.checkedOutIn === worktree) return { kind: "current" };
  return { kind: "elsewhere", path: local.checkedOutIn, dirty: local.dirty };
}

/**
 * Plain-words position against another branch: "In sync with main", or the
 * commits ahead and behind. `compare.against` names the branch compared with.
 */
export function compareText(
  compare: BranchCompare | null,
  against = compare?.against ?? "",
): string | null {
  if (!compare) return null;
  if (!compare.ahead && !compare.behind) return `In sync with ${against}`;
  const parts = [
    compare.ahead ? `${compare.ahead} ahead of ${against}` : "",
    compare.behind ? `${compare.behind} behind ${against}` : "",
  ].filter(Boolean);
  return parts.join(", ");
}
