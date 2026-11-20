import { afterEach, expect, it, vi } from "vitest";
import { withModelDeadline } from "@/lib/claude/deadline";

afterEach(() => vi.useRealTimers());

it("aborts a stalled SDK and waits for cleanup before reporting timeout", async () => {
  vi.useFakeTimers();
  let cleaned = false;
  const pending = withModelDeadline(
    new AbortController().signal,
    100,
    (signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          setTimeout(() => {
            cleaned = true;
            resolve();
          }, 20);
        });
      }),
  );
  const check = expect(pending).rejects.toMatchObject({ kind: "timeout" });
  await vi.advanceTimersByTimeAsync(100);
  expect(cleaned).toBe(false);
  await vi.advanceTimersByTimeAsync(20);
  await check;
  expect(cleaned).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not start work for an already cancelled request", async () => {
  const parent = new AbortController();
  parent.abort();
  const run = vi.fn();
  await expect(
    withModelDeadline(parent.signal, 100, run),
  ).rejects.toMatchObject({ kind: "cancelled" });
  expect(run).not.toHaveBeenCalled();
});

it("forwards disconnects and removes its timer after success or failure", async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const pending = withModelDeadline(
    parent.signal,
    100,
    (signal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve(null)),
      ),
  );
  const check = expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  parent.abort();
  await check;
  expect(
    await withModelDeadline(
      new AbortController().signal,
      100,
      async () => "ok",
    ),
  ).toBe("ok");
  await expect(
    withModelDeadline(new AbortController().signal, 100, async () => {
      throw new Error("SDK failed");
    }),
  ).rejects.toThrow("SDK failed");
  expect(vi.getTimerCount()).toBe(0);
});
