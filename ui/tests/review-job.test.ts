import fs from "node:fs";
const root = vi.hoisted(() => `/tmp/career-queue-${crypto.randomUUID()}`);
vi.mock("@/lib/paths", () => ({ CAREER_ROOT: root }));
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetReviewState,
  cancelReview,
  reviewRunning,
  reviewStatus,
  startReview,
} from "@/lib/scoreState";

const tick = () => new Promise((r) => setTimeout(r, 5));
afterEach(async () => {
  _resetReviewState();
  await tick();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("background review job", () => {
  it("runs detached, reports steps, and ends as done", async () => {
    let finish!: () => void;
    startReview("run-1", "Acme   Backend\nEngineer", (_signal, onStep) => {
      onStep("Reading career.md");
      return new Promise<void>((r) => (finish = r));
    });
    expect(reviewStatus()).toMatchObject({
      running: true,
      runId: "run-1",
      status: "running",
      step: "Reading career.md",
      preview: "Acme Backend Engineer",
    });
    finish();
    await tick();
    expect(reviewRunning()).toBe(false);
    expect(reviewStatus()).toMatchObject({
      status: "done",
      runId: "run-1",
      step: null,
      preview: "",
    });
  });

  it("cancel → cancelled; failure → error with the message", async () => {
    startReview(
      "run-3",
      "p",
      (signal) =>
        new Promise<void>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    expect(cancelReview()).toBe(true);
    await tick();
    expect(reviewStatus().status).toBe("cancelled");
    expect(cancelReview()).toBe(false);

    startReview("run-4", "p", async () => {
      throw new Error("Claude is down");
    });
    await tick();
    expect(reviewStatus()).toMatchObject({
      status: "error",
      error: "Claude is down",
    });
  });

  it("times out on the server as an error, not a cancel", async () => {
    startReview(
      "run-5",
      "p",
      (signal) =>
        new Promise<void>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
      10,
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(reviewStatus()).toMatchObject({
      status: "error",
      error: "Review took longer than 2 minutes",
    });
  });
});

it("runs two jobs and starts the third only after a slot is released", async () => {
  const finish: Array<() => void> = [];
  const started: number[] = [];
  for (let n = 0; n < 3; n++)
    startReview(`queue-${n}`, "post", async () => {
      started.push(n);
      await new Promise<void>((r) => finish.push(r));
    });
  expect(started).toEqual([0, 1]);
  finish[0]();
  await tick();
  expect(started).toEqual([0, 1, 2]);
  finish[1]();
  finish[2]();
  await tick();
});
it("recovers running and waiting requests without automatically invoking a model", async () => {
  fs.mkdirSync(`${root}/ui/.cache`, { recursive: true });
  const request = { jobPost: "Original description", resume: "tech" };
  fs.writeFileSync(
    `${root}/ui/.cache/review-queue.json`,
    JSON.stringify([
      {
        runId: "recovery-1",
        status: "running",
        request,
        queuedAt: 1,
        startedAt: 1,
        finishedAt: null,
        step: "Reviewing",
        preview: "first",
      },
      {
        runId: "recovery-2",
        status: "queued",
        request,
        queuedAt: 2,
        startedAt: 2,
        finishedAt: null,
        step: "Waiting",
        preview: "second",
      },
    ]),
  );
  delete (globalThis as Record<string, unknown>).__careerReviewQueue;
  vi.resetModules();
  const recovered = await import("@/lib/scoreState");
  expect(recovered.reviewStatuses().map((j) => j.status)).toEqual([
    "interrupted",
    "paused",
  ]);
  expect(recovered.reviewRunning()).toBe(false);
  recovered._resetReviewState();
});
