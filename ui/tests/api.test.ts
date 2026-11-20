import { describe, expect, it } from "vitest";
import { ApiError, errorResponse, localToday } from "@/lib/api";
import {
  NotFoundError,
  ReadOnlyError,
  ValidationError,
} from "@/lib/applications";
import { ConflictError, LockedError } from "@/lib/fileStore";
import { startJob, subscribe, runningJob } from "@/lib/jobs";
import type { JobEvent } from "@/lib/types";

async function body(e: unknown) {
  const res = errorResponse(e);
  return { status: res.status, json: await res.json() };
}

describe("errorResponse maps errors to the documented codes", () => {
  it.each([
    [new ValidationError("bad", [{ path: "x" }]), 400, "VALIDATION"],
    [new NotFoundError("gone"), 404, "NOT_FOUND"],
    [new ConflictError("changed"), 409, "CONFLICT"],
    [new LockedError("held"), 423, "LOCKED"],
    [new ReadOnlyError("header changed"), 423, "LOCKED"],
    [
      new ApiError("CLAUDE_UNAVAILABLE", "auth", 503),
      503,
      "CLAUDE_UNAVAILABLE",
    ],
  ])("%s", async (err, status, code) => {
    const r = await body(err);
    expect(r.status).toBe(status);
    expect(r.json.error.code).toBe(code);
  });

  it("falls back to 500 INTERNAL for unknown errors", async () => {
    const r = await body(new Error("boom"));
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe("INTERNAL");
  });
});

describe("localToday", () => {
  it("formats as YYYY-MM-DD in local time", () => {
    expect(localToday(new Date(2026, 9, 6, 23, 59))).toBe("2026-10-06");
    expect(localToday(new Date("2026-01-05T05:01:00Z"))).toBe("2026-01-04");
  });
});

describe("job registry", () => {
  it("buffers events so a late subscriber replays them, then marks the job done", async () => {
    const job = startJob("tailor", async (emit) => {
      emit({ type: "step", text: "one", at: 1 });
      emit({ type: "error", kind: "cancelled", message: "stop" });
    });
    await new Promise((r) => setTimeout(r, 10));
    const seen: JobEvent[] = [];
    subscribe(job, (e) => seen.push(e));
    expect(seen.map((e) => e.type)).toEqual(["step", "error"]);
    expect(job.done).toBe(true);
    expect(job.listeners.size).toBe(0);
  });
  it("holds the job lock and terminal event until cleanup completes", async () => {
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    const job = startJob("tailor", async (emit) => {
      emit({ type: "error", kind: "cancelled", message: "stop" });
      await cleanup;
    });
    expect(job.done).toBe(false);
    expect(job.events).toEqual([]);
    expect(runningJob()?.id).toBe(job.id);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(job.done).toBe(true);
    expect(job.events.filter((e) => e.type === "error")).toHaveLength(1);
  });
});
