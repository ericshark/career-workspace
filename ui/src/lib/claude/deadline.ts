import { AgentError } from "./agent";

/** Local Next servers do not enforce maxDuration. Abort the SDK and await its cleanup. */
export async function withModelDeadline<T>(
  parent: AbortSignal,
  milliseconds: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort(parent.reason);
  if (parent.aborted) forward();
  else parent.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("timeout")),
    milliseconds,
  );
  const check = () => {
    if (controller.signal.aborted)
      throw new AgentError(
        controller.signal.reason?.message === "timeout"
          ? "Agent timed out"
          : "Cancelled",
        controller.signal.reason?.message === "timeout"
          ? "timeout"
          : "cancelled",
      );
  };
  try {
    check();
    const result = await run(controller.signal);
    check();
    return result;
  } catch (error) {
    check();
    throw error;
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", forward);
  }
}
