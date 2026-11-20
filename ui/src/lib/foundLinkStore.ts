import fs from "node:fs";
import { resolveExpected } from "./paths";
import type { ApplicationRow } from "./types";
import type { StoredLink } from "./foundLink";
import { atomicWrite } from "./fileStore";

const file = () => resolveExpected("records/application-links.json");

export function linkIdentity(row: ApplicationRow, rows: ApplicationRow[]) {
  if (row.recordId)
    return rows.filter((r) => r.recordId === row.recordId).length === 1
      ? `record:${row.recordId}`
      : null;
  return rows.filter((r) => r.key === row.key).length === 1
    ? `row:${row.key}`
    : null;
}

export function readFoundLinks(): Record<string, StoredLink> {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

// The caller holds the application lock, so the row check and companion write
// are serialized with Tracker edits and with other link saves.
export function writeFoundLink(id: string, link?: StoredLink) {
  const links = readFoundLinks();
  if (link) links[id] = link;
  else delete links[id];
  atomicWrite(file(), JSON.stringify(links, null, 2) + "\n");
}

/**
 * A found link saved under the row key would be lost when an edit changes that key, so it moves to the
 * Record ID identity, which survives edits.
 */
export function rekeyFoundLink(oldKey: string, recordId: string) {
  const links = readFoundLinks();
  const old = links[`row:${oldKey}`];
  if (!old) return;
  links[`record:${recordId}`] ??= old;
  delete links[`row:${oldKey}`];
  atomicWrite(file(), JSON.stringify(links, null, 2) + "\n");
}
