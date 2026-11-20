// In-memory job registry for tailoring (one at a time) + buffered events so an SSE client that
// reconnects replays everything. Spec: docs/01-architecture.md, docs/05-api.md.
import { randomUUID } from "node:crypto";
import { AgentError } from "./claude/agent";
import type { JobEvent } from "./types";

export interface Job {
  id: string;
  kind: "tailor";
  events: JobEvent[];
  done: boolean;
  abort: AbortController;
  listeners: Set<(e: JobEvent) => void>;
}

// Survive Next dev hot reloads: keep the registry on globalThis.
const g = globalThis as unknown as { __careerJobs?: Map<string, Job> };
const jobs = (g.__careerJobs ??= new Map<string, Job>());

export function startJob(
  kind: Job["kind"],
  run: (emit: (e: JobEvent) => void, signal: AbortSignal) => Promise<void>,
): Job {
  const job: Job = {
    id: randomUUID(),
    kind,
    events: [],
    done: false,
    abort: new AbortController(),
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  let terminal: JobEvent | undefined;
  const publish = (e: JobEvent) => {
    job.events.push(e);
    for (const l of job.listeners) l(e);
  };
  // Hold terminal events until cleanup finishes; a new job must not overlap old subprocesses.
  const emit = (e: JobEvent) => {
    if (e.type === "done" || e.type === "error") {
      terminal ??= e;
      return;
    }
    publish(e);
  };
  run(emit, job.abort.signal)
    .catch((err) => {
      terminal = {
        type: "error",
        kind: err instanceof AgentError ? err.kind : "claude",
        message: err instanceof Error ? err.message : String(err),
      };
    })
    .finally(() => {
      job.done = true;
      if (terminal) publish(terminal);
      else
        publish({
          type: "error",
          kind: "claude",
          message: "Job finished without a result",
        });
    });
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function runningJob(): Job | undefined {
  return [...jobs.values()].find((j) => !j.done);
}

/** Replays buffered events, then streams new ones. Returns an unsubscribe function. */
export function subscribe(
  job: Job,
  onEvent: (e: JobEvent) => void,
): () => void {
  for (const e of job.events) onEvent(e);
  // Replaying a finished job can close its SSE stream before subscribe returns.
  // Such a stream has no future events and must not retain a listener.
  if (!job.done) job.listeners.add(onEvent);
  return () => job.listeners.delete(onEvent);
}
