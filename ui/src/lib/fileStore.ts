// Safe writes: in-process mutex + O_EXCL lockfile + sha256 optimistic check + atomic rename.
// Owner: Agent A. Spec: docs/03-data-layer.md ("Safe writes").
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CAREER_ROOT } from "./paths";

export class ConflictError extends Error {} // → HTTP 409
export class LockedError extends Error {} // → HTTP 423

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const DEFAULT_STALE_MS = 30_000;
// A lock held by another writer is normally released within milliseconds (UI request vs. an
// apps.sh call). Wait for it instead of failing a request that would have succeeded a moment later.
const DEFAULT_WAIT_MS = 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-file promise chain: callers in this process run strictly one after another (two browser tabs
// can't interleave). The lockfile below only has to guard against *other* processes.
const chains = new Map<string, Promise<unknown>>();

/**
 * Lock, re-read `file`, compare its hash with `expectedHash`, call `mutate(currentText)` to get the
 * new text, write it atomically (temp file in the same dir, fsync, rename), unlock.
 * Throws ConflictError on hash mismatch, LockedError if the lock is held (stale after 30 s).
 * A caller that writes companion files inside mutate can restore them before the lock is released.
 */
export function withFileLock(
  file: string,
  expectedHash: string,
  mutate: (current: string) => string,
  opts?: {
    lockPath?: string;
    staleMs?: number;
    /** How long to wait for a lock held by another writer before throwing LockedError. */
    waitMs?: number;
    initialText?: string;
    rollback?: () => void;
  },
): Promise<{ text: string; hash: string }> {
  const lockPath =
    opts?.lockPath ??
    path.join(CAREER_ROOT, "ui", ".cache", "applications.lock");
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const waitMs =
    opts?.waitMs ?? Number(process.env.CAREER_LOCK_WAIT_MS ?? DEFAULT_WAIT_MS);

  const run = () =>
    locked(
      file,
      expectedHash,
      mutate,
      lockPath,
      staleMs,
      waitMs,
      opts?.initialText,
      opts?.rollback,
    );
  const prev = chains.get(file) ?? Promise.resolve();
  // Run after the previous call settles, whether it succeeded or failed.
  const next = prev.then(run, run);
  chains.set(
    file,
    next.catch(() => undefined),
  );
  return next;
}

async function locked(
  file: string,
  expectedHash: string,
  mutate: (current: string) => string,
  lockPath: string,
  staleMs: number,
  waitMs: number,
  initialText?: string,
  rollback?: () => void,
): Promise<{ text: string; hash: string }> {
  const nonce = await acquireLock(lockPath, staleMs, waitMs);
  try {
    // Optimistic concurrency: re-read under the lock and compare with what the client last saw.
    let current: string;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch (e) {
      // New durable stores are initialized under the same lock as their first edit.
      if (
        (e as NodeJS.ErrnoException).code !== "ENOENT" ||
        initialText === undefined
      )
        throw e;
      current = initialText;
    }
    if (sha256(current) !== expectedHash)
      throw new ConflictError("file changed since it was last read");

    try {
      const text = mutate(current);
      if (text !== current) atomicWrite(file, text);
      return { text, hash: sha256(text) };
    } catch (error) {
      rollback?.();
      throw error;
    }
  } finally {
    releaseLock(lockPath, nonce);
  }
}

/** Remove the lockfile only if it is still ours (nonce matches). */
function releaseLock(lockPath: string, nonce: string): void {
  try {
    if (JSON.parse(fs.readFileSync(lockPath, "utf8")).nonce !== nonce) return;
  } catch {
    return; // already gone or taken over
  }
  fs.rmSync(lockPath, { force: true });
}

/**
 * Acquire the lockfile, retrying with jittered backoff (25 ms growing to 250 ms) while another
 * writer holds it. Throws LockedError once `waitMs` has elapsed.
 */
async function acquireLock(
  lockPath: string,
  staleMs: number,
  waitMs: number,
): Promise<string> {
  const deadline = Date.now() + waitMs;
  for (let delay = 25; ; delay = Math.min(delay * 2, 250)) {
    try {
      return tryAcquireLock(lockPath, staleMs);
    } catch (e) {
      if (!(e instanceof LockedError) || Date.now() >= deadline) throw e;
    }
    await sleep(Math.min(delay * (0.5 + Math.random()), deadline - Date.now()));
  }
}

/** One attempt: create the lockfile with O_EXCL (flag "wx"); clear it first if older than `staleMs`. */
function tryAcquireLock(lockPath: string, staleMs: number): string {
  // Random nonce identifies this owner, so a writer that outlives the stale timeout can't delete the
  // lock of whoever took over.
  const nonce = randomBytes(8).toString("hex");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(
        fd,
        JSON.stringify({ pid: process.pid, ts: Date.now(), nonce }),
      );
      fs.closeSync(fd);
      return nonce;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    // Held by someone else. Age comes from the lockfile's own timestamp, else its mtime.
    let age = 0;
    try {
      let ts = NaN;
      try {
        ts = JSON.parse(fs.readFileSync(lockPath, "utf8")).ts;
      } catch {
        /* unreadable or half-written: fall back to mtime */
      }
      if (!Number.isFinite(ts)) ts = fs.statSync(lockPath).mtimeMs;
      age = Date.now() - ts;
    } catch {
      continue; // lock vanished between EEXIST and stat: just retry
    }
    if (age <= staleMs)
      throw new LockedError("file is locked by another writer");
    // Stale (crashed writer): remove and retry. A rare race with another cleaner is acceptable
    // because the sha256 check still protects the data.
    fs.rmSync(lockPath, { force: true });
  }
  throw new LockedError("could not acquire lock");
}

/** Temp file in the same directory + fsync + rename, so readers never see a half-written file. */
export function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}
