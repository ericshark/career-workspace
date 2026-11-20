import { readApiError } from "@/components/applyHelpers";
import { PROGRESS_CHANGED } from "@/components/useFetchJson";
import type { ApplicationRow, ApplicationsPayload } from "@/lib/types";

/**
 * Saves changes to one tracker application and resolves with the row under its new key (company,
 * role, link and date edits change the key; the server moves every saved reference). It reads a fresh
 * file hash itself, so it works from any page. Throws an Error with a readable message on failure.
 */
export async function patchApplication(
  row: Pick<ApplicationRow, "key" | "lineIndex">,
  changes: Record<string, string>,
): Promise<ApplicationRow | undefined> {
  const current = await fetch("/api/applications", { cache: "no-store" });
  if (!current.ok) throw new Error((await readApiError(current)).message);
  const snapshot = (await current.json()) as ApplicationsPayload;
  const fresh =
    snapshot.rows.find(
      (r) => r.key === row.key && r.lineIndex === row.lineIndex,
    ) ??
    (snapshot.rows.filter((r) => r.key === row.key).length === 1
      ? snapshot.rows.find((r) => r.key === row.key)
      : undefined);
  if (!fresh)
    throw new Error("This application changed. Close it and reopen it.");
  const response = await fetch("/api/applications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileHash: snapshot.fileHash,
      key: row.key,
      lineIndex: fresh.lineIndex,
      ...changes,
    }),
  });
  if (!response.ok) throw new Error((await readApiError(response)).message);
  const saved = (await response.json()) as ApplicationsPayload;
  window.dispatchEvent(new Event(PROGRESS_CHANGED));
  return saved.rows.find((r) => r.lineIndex === fresh.lineIndex);
}
