// Thin wrapper over the Agent SDK query(): cwd, model, scrubbed env, abort, hooks, and mapping SDK
// messages to short step/log lines for the UI. ChatGPT models are routed to the Codex runner
// (./codex.ts). Spec: docs/02-claude-integration.md ("Shared wrapper").
import { readPreferences } from "../preferences";
import path from "node:path";
import {
  query,
  type HookCallback,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { modelEffort, providerOf } from "../config";
import { CAREER_ROOT } from "../paths";
import type { AgentMetrics, JobErrorKind, ModelId } from "../types";
import { scrubbedEnv } from "./env";

export interface ToolDecision {
  allow: boolean;
  reason?: string;
}

export interface AgentRunOptions {
  operation?:
    "review" | "tailor" | "extras" | "quick" | "find-link" | "workshop-tasks";
  effort?: "low" | "medium" | "high";
  prompt: string;
  systemPrompt?: string;
  tools?: string[];
  mcpServers?: Options["mcpServers"];
  model: ModelId;
  allowedTools: string[];
  maxTurns: number;
  signal?: AbortSignal;
  outputSchema?: Record<string, unknown>;
  /** Which filesystem settings to load. Omitted = all (CLAUDE.md, skills, settings); [] = none. */
  settingSources?: ("user" | "project" | "local")[];
  /** Called for every tool call before it runs; a deny stops it and tells Claude why. */
  decide?: (tool: string, input: Record<string, unknown>) => ToolDecision;
  onStep?: (text: string) => void;
  onLog?: (text: string) => void;
}

export interface AgentRunResult {
  subtype: string;
  metrics: AgentMetrics;
  structuredOutput?: unknown;
  costUsdEstimate?: number;
  durationMs: number;
  sessionId?: string;
  denied: string[]; // human-readable list of tool calls the guard blocked
}

/** Failure with a UI-facing kind: auth problems vs Claude/SDK problems vs user cancellation. */
export class AgentError extends Error {
  constructor(
    message: string,
    public kind: JobErrorKind,
  ) {
    super(message);
  }
}

/** "Reading profile/career.md", "Writing source/tailored/x/resume.tex", ... for the step list. */
export function describeToolUse(
  name: string,
  input: Record<string, unknown>,
): string {
  const rel = (p: unknown) =>
    typeof p === "string" ? path.relative(CAREER_ROOT, p) || p : "";
  const target = rel(input.file_path ?? input.path);
  switch (name) {
    case "Read":
      return `Reading ${target}`;
    case "Write":
      return `Writing ${target}`;
    case "Edit":
      return `Editing ${target}`;
    case "Glob":
    case "Grep":
      return `Searching ${typeof input.pattern === "string" ? input.pattern : "files"}`;
    case "Bash":
      return /build\.sh/.test(String(input.command))
        ? "Running build + ATS check"
        : "Running a command";
    case "Skill":
      return `Using skill ${String(input.skill ?? "")}`.trim();
    default:
      return name;
  }
}

// Adapts our plain allow/deny decision into the SDK's PreToolUse hook output shape.
function toHook(
  decide: NonNullable<AgentRunOptions["decide"]>,
  denied: string[],
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    const d = decide(input.tool_name, toolInput);
    if (d.allow) return {};
    denied.push(
      `${describeToolUse(input.tool_name, toolInput)}: ${d.reason ?? "denied"}`,
    );
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: d.reason ?? "Not allowed in this run",
      },
    };
  };
}

export function classifyAgentError(message: string): JobErrorKind {
  return /authenticat|oauth|login|log in|credential|api key|unauthori[sz]ed|\b401\b|refresh token/i.test(
    message,
  )
    ? "auth"
    : "claude";
}

/** Runs one operation on the selected model's provider; both return the same result shape. */
export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const preferences = readPreferences();
  opts = {
    ...opts,
    effort:
      opts.effort ??
      preferences.operationEfforts[
        `${opts.operation ?? "review"}:${opts.model}`
      ] ??
      preferences.efforts[opts.model],
  };
  if (providerOf(opts.model) === "openai") {
    // Loaded on demand so Claude-only runs never load the Codex SDK.
    const { runCodexAgent } = await import("./codex");
    return runCodexAgent(opts);
  }
  if (!process.env.ANTHROPIC_API_KEY)
    throw new AgentError(
      "Set ANTHROPIC_API_KEY in ui/.env.local and restart the app.",
      "auth",
    );
  return runClaudeAgent(opts);
}

async function runClaudeAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const abort = new AbortController();
  const onAbort = () => abort.abort(opts.signal?.reason);
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  const denied: string[] = [];
  const started = Date.now();
  let final: Record<string, any> | undefined;
  let toolCalls = 0;

  try {
    const stream = query({
      prompt: opts.prompt,
      options: {
        cwd: CAREER_ROOT,
        ...(opts.systemPrompt !== undefined
          ? { systemPrompt: opts.systemPrompt }
          : {}),
        ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
        ...(opts.mcpServers !== undefined
          ? { mcpServers: opts.mcpServers }
          : {}),
        model: opts.model,
        effort: opts.effort ?? modelEffort(opts.model),
        allowedTools: opts.allowedTools,
        permissionMode: "dontAsk", // anything not explicitly allowed is denied, never prompts
        maxTurns: opts.maxTurns,
        // One-off review/quick-add calls: keep them out of ~/.claude/projects transcripts.
        persistSession: false,
        env: scrubbedEnv(),
        abortController: abort,
        ...(opts.settingSources ? { settingSources: opts.settingSources } : {}),
        ...(opts.outputSchema
          ? {
              outputFormat: {
                type: "json_schema" as const,
                schema: opts.outputSchema,
              },
            }
          : {}),
        ...(opts.decide
          ? {
              hooks: { PreToolUse: [{ hooks: [toHook(opts.decide, denied)] }] },
            }
          : {}),
      },
    }) as AsyncIterable<Record<string, any>>;

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "tool_use") {
            toolCalls++;
            opts.onStep?.(describeToolUse(block.name, block.input ?? {}));
          } else if (block.type === "text" && block.text?.trim())
            opts.onLog?.(block.text.trim());
        }
      } else if (msg.type === "result") {
        final = msg;
      }
    }
  } catch (err) {
    if (abort.signal.aborted)
      throw new AgentError(
        abort.signal.reason?.message === "timeout"
          ? "Agent timed out"
          : "Cancelled",
        abort.signal.reason?.message === "timeout" ? "timeout" : "cancelled",
      );
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentError(message, classifyAgentError(message));
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }

  if (abort.signal.aborted)
    throw new AgentError(
      abort.signal.reason?.message === "timeout"
        ? "Agent timed out"
        : "Cancelled",
      abort.signal.reason?.message === "timeout" ? "timeout" : "cancelled",
    );
  if (!final)
    throw new AgentError("Claude finished without a result", "claude");
  const modelUsage = Object.values(final.modelUsage ?? {}) as Record<
    string,
    unknown
  >[];
  // Prefer SDK totals covering internal query-pipeline calls; fall back to main-loop usage only
  // when the producer doesn't provide model totals. Unavailable values remain undefined.
  const tokens = (field: string, fallback: unknown): number | undefined => {
    if (
      modelUsage.length &&
      modelUsage.every((u) => typeof u[field] === "number")
    )
      return modelUsage.reduce((sum, u) => sum + (u[field] as number), 0);
    return typeof fallback === "number" ? fallback : undefined;
  };
  return {
    subtype: String(final.subtype),
    metrics: {
      effort: opts.effort ?? modelEffort(opts.model),
      sdkDurationMs:
        typeof final.duration_ms === "number" ? final.duration_ms : undefined,
      apiDurationMs:
        typeof final.duration_api_ms === "number"
          ? final.duration_api_ms
          : undefined,
      turns: typeof final.num_turns === "number" ? final.num_turns : undefined,
      inputTokens: tokens("inputTokens", final.usage?.input_tokens),
      outputTokens: tokens("outputTokens", final.usage?.output_tokens),
      cacheReadTokens: tokens(
        "cacheReadInputTokens",
        final.usage?.cache_read_input_tokens,
      ),
      cacheCreationTokens: tokens(
        "cacheCreationInputTokens",
        final.usage?.cache_creation_input_tokens,
      ),
      toolCalls,
      deniedCalls: denied.length,
      totalMs: Date.now() - started,
    },
    structuredOutput: final.structured_output,
    costUsdEstimate:
      typeof final.total_cost_usd === "number"
        ? final.total_cost_usd
        : undefined,
    durationMs:
      typeof final.duration_ms === "number"
        ? final.duration_ms
        : Date.now() - started,
    sessionId:
      typeof final.session_id === "string" ? final.session_id : undefined,
    denied,
  };
}
