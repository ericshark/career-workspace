import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  LockedError,
  sha256,
  withFileLock,
} from "@/lib/fileStore";

let dir: string;
let file: string;
let lockPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "filestore-"));
  file = path.join(dir, "data.md");
  lockPath = path.join(dir, "data.lock");
  fs.writeFileSync(file, "start\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("withFileLock", () => {
  it("writes the mutated text and returns its hash", async () => {
    const r = await withFileLock(file, sha256("start\n"), (t) => t + "more\n", {
      lockPath,
    });
    expect(fs.readFileSync(file, "utf8")).toBe("start\nmore\n");
    expect(r).toEqual({ text: "start\nmore\n", hash: sha256("start\nmore\n") });
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("serializes concurrent writes: both applied, in order, no lost update", async () => {
    // Both calls are submitted at once; the second expects the hash the first will produce, so it
    // only succeeds if it really runs after the first has finished writing.
    const p1 = withFileLock(file, sha256("start\n"), (t) => t + "A\n", {
      lockPath,
    });
    const p2 = withFileLock(file, sha256("start\nA\n"), (t) => t + "B\n", {
      lockPath,
    });
    await Promise.all([p1, p2]);
    expect(fs.readFileSync(file, "utf8")).toBe("start\nA\nB\n");
  });

  it("a second writer holding the same stale hash gets a conflict, not a lost update", async () => {
    const h = sha256("start\n");
    const p1 = withFileLock(file, h, (t) => t + "A\n", { lockPath });
    const p2 = withFileLock(file, h, (t) => t + "B\n", { lockPath });
    await expect(p1).resolves.toBeTruthy();
    await expect(p2).rejects.toBeInstanceOf(ConflictError);
    expect(fs.readFileSync(file, "utf8")).toBe("start\nA\n");
  });

  it("rejects a stale hash and leaves the file untouched", async () => {
    await expect(
      withFileLock(file, sha256("something else"), () => "clobbered", {
        lockPath,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(fs.readFileSync(file, "utf8")).toBe("start\n");
    // The lock was released despite the error.
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("keeps the queue working after a failed call", async () => {
    await withFileLock(file, "bad", (t) => t, { lockPath }).catch(() => {});
    await withFileLock(file, sha256("start\n"), (t) => t + "ok\n", {
      lockPath,
    });
    expect(fs.readFileSync(file, "utf8")).toBe("start\nok\n");
  });

  it("returns LOCKED while a fresh lockfile exists", async () => {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 1, ts: Date.now() }));
    await expect(
      withFileLock(file, sha256("start\n"), (t) => t + "x", {
        lockPath,
        waitMs: 100,
      }),
    ).rejects.toBeInstanceOf(LockedError);
    expect(fs.readFileSync(file, "utf8")).toBe("start\n");
    // Someone else's lock is left alone.
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("waits for a lock that another writer releases shortly after", async () => {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 1, ts: Date.now() }));
    setTimeout(() => fs.rmSync(lockPath, { force: true }), 150);
    await withFileLock(file, sha256("start\n"), (t) => t + "x\n", {
      lockPath,
      waitMs: 2_000,
    });
    expect(fs.readFileSync(file, "utf8")).toBe("start\nx\n");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("clears a stale lockfile (older than 30 s)", async () => {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 1, ts: Date.now() - 31_000 }),
    );
    await withFileLock(file, sha256("start\n"), (t) => t + "x\n", { lockPath });
    expect(fs.readFileSync(file, "utf8")).toBe("start\nx\n");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("falls back to the lockfile mtime when it has no timestamp", async () => {
    fs.writeFileSync(lockPath, "garbage");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, old, old);
    await withFileLock(file, sha256("start\n"), (t) => t + "x\n", { lockPath });
    expect(fs.readFileSync(file, "utf8")).toBe("start\nx\n");
  });

  it("leaves no temp file behind and the content is complete", async () => {
    const big = "line\n".repeat(50_000);
    await withFileLock(file, sha256("start\n"), () => big, { lockPath });
    expect(fs.readFileSync(file, "utf8")).toBe(big);
    expect(fs.readdirSync(dir).sort()).toEqual(["data.md"]);
  });
});
