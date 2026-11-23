// Demo replacement for the model runner: no model is called. It returns bundled answers for the
// bundled example posts and refuses anything else.
import { preparedAnswer } from "@demo/examples";
import type { AgentMetrics, JobErrorKind } from "../types";

export interface AgentRunOptions {
  operation?: string;
  prompt: string;
  signal?: AbortSignal;
  onStep?: (text: string) => void;
  decide?: (
    tool: string,
    input: Record<string, unknown>,
  ) => { allow: boolean; reason?: string };
  [key: string]: unknown;
}
export interface AgentRunResult {
  subtype: string;
  metrics: AgentMetrics;
  structuredOutput?: unknown;
  costUsdEstimate?: number;
  durationMs: number;
  sessionId?: string;
  denied: string[];
}
export class AgentError extends Error {
  constructor(
    message: string,
    public kind: JobErrorKind,
  ) {
    super(message);
  }
}
export async function runAgent(
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  // Long enough to see the app's own progress states.
  await new Promise((resolve) => setTimeout(resolve, 1600));
  if (options.signal?.aborted) throw new AgentError("Cancelled.", "cancelled");
  const structuredOutput = preparedAnswer(options.operation, options.prompt);
  if (!structuredOutput)
    throw new AgentError(
      "The demo only has prepared results for its example posts. Choose Load example, or run the local edition to use your own.",
      "claude",
    );
  return {
    subtype: "success",
    metrics: {},
    structuredOutput,
    durationMs: 1600,
    denied: [],
  };
}
