import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { Usage, UserInput } from "./responses";
import { modelEffort } from "../config";
import type { AgentMetrics } from "../types";
import {
  AgentError,
  classifyAgentError,
  type AgentRunOptions,
  type AgentRunResult,
} from "./agent";

/**
 * OpenAI structured outputs run in strict mode: every object closes its properties and requires all
 * of them. Our Zod schemas already satisfy that; this drops the draft `$schema` marker and fails
 * loudly if a future schema adds an optional field instead of silently producing invalid output.
 */
export function openAiOutputSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const strip = (node: unknown, at: string): unknown => {
    if (Array.isArray(node)) return node.map((n, i) => strip(n, `${at}[${i}]`));
    if (!node || typeof node !== "object") return node;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object" || obj.properties) {
      const props = Object.keys((obj.properties as object) ?? {});
      const required = (obj.required as string[]) ?? [];
      if (
        obj.additionalProperties !== false ||
        props.some((p) => !required.includes(p))
      )
        throw new Error(
          `Output schema at ${at || "root"} is not strict (all properties required, no extras)`,
        );
    }
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => k !== "$schema")
        .map(([k, v]) => [k, strip(v, `${at}.${k}`)]),
    );
  };
  return strip(schema, "") as Record<string, unknown>;
}

/** Items that mean the model used a tool despite the lockdown. */
const FORBIDDEN_ITEMS: Record<string, string> = {
  command_execution: "Running a command",
  file_change: "Changing files",
  mcp_tool_call: "Calling a tool",
  web_search: "Searching the web",
};

interface TurnOutcome {
  text: string;
  usage?: Usage;
  searched: boolean;
}

/** Shared skeleton: abort wiring, session lifetime, error mapping and metrics. */
async function withSession(
  opts: AgentRunOptions,
  body: (ctx: {
    session: { workDir: string };
    turn: (
      input: string | UserInput[],
      schema?: Record<string, unknown>,
    ) => Promise<TurnOutcome>;
    counters: { toolCalls: number };
  }) => Promise<{ subtype: string; structuredOutput?: unknown }>,
): Promise<AgentRunResult> {
  const abort = new AbortController();
  const onAbort = () => abort.abort(opts.signal?.reason);
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  const denied: string[] = [];
  const started = Date.now();
  const usages: Usage[] = [];
  const counters = { toolCalls: 0 };
  let workDir: string | undefined;
  const aborted = () => {
    const reason = abort.signal.reason;
    if (reason instanceof AgentError) return reason;
    return reason?.message === "timeout"
      ? new AgentError("Agent timed out", "timeout")
      : new AgentError("Cancelled", "cancelled");
  };
  try {
    const { openResponses } = await import("./responses");
    const send = await openResponses(opts, abort.signal);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "career-responses-"));
    const runnerSetupMs = Date.now() - started;
    const outcome = await body({
      session: { workDir },
      counters,
      turn: async (input, schema) => {
        if (abort.signal.aborted) throw aborted();
        const result = await send(input, schema);
        if (result.usage) usages.push(result.usage);
        return result;
      },
    });
    if (abort.signal.aborted) throw aborted();
    const sum = (field: keyof Usage) =>
      usages.length
        ? usages.reduce((n, u) => n + (u[field] ?? 0), 0)
        : undefined;
    const cached = sum("cached_input_tokens");
    const input = sum("input_tokens");
    const metrics: AgentMetrics = {
      runnerSetupMs,
      modelMs: Date.now() - started - runnerSetupMs,
      effort: opts.effort ?? modelEffort(opts.model),
      turns: usages.length,
      // OpenAI's input count includes cached tokens; Claude's excludes cache reads. Report the
      // uncached part so the two providers' metrics mean the same thing.
      inputTokens: input === undefined ? undefined : input - (cached ?? 0),
      outputTokens: sum("output_tokens"),
      cacheReadTokens: cached,
      cacheCreationTokens: sum("cache_write_input_tokens"),
      toolCalls: counters.toolCalls,
      deniedCalls: denied.length,
      totalMs: Date.now() - started,
    };
    return {
      ...outcome,
      metrics,
      durationMs: Date.now() - started,
      denied,
    };
  } catch (err) {
    if (abort.signal.aborted) throw aborted();
    if (err instanceof AgentError) throw err;
    const message =
      err instanceof Error ? err.message : "OpenAI request failed";
    throw new AgentError(message, classifyAgentError(message));
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A single structured-output call (Review, Quick add, Questions, Letter, Follow-up). */
export async function runCodexAgent(
  opts: AgentRunOptions,
): Promise<AgentRunResult> {
  return withSession(opts, async ({ turn }) => {
    const schema = opts.outputSchema && openAiOutputSchema(opts.outputSchema);
    const { text, searched } = await turn(opts.prompt, schema);
    if (opts.operation === "find-link" && !searched)
      return { subtype: "error_no_search" };
    if (!schema) return { subtype: text ? "success" : "error_no_output" };
    const structuredOutput = parseJson(text);
    return structuredOutput === undefined
      ? { subtype: "error_invalid_structured_output" }
      : { subtype: "success", structuredOutput };
  });
}

export interface CodexToolResult {
  isError?: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
}
export interface CodexTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: unknown) => Promise<CodexToolResult>;
}

/**
 * Codex cannot host the in-process MCP tool the Claude path uses, so a tool session runs as a
 * code-driven loop: each turn the model answers with either the tool's arguments or its final
 * output, code runs the tool, and the next turn replays the prompt plus every earlier round with
 * the latest round's images attached. Threads are ephemeral, so each turn re-sends that history
 * rather than resuming a stored session.
 */
export async function runCodexToolLoop(
  opts: AgentRunOptions & { tool: CodexTool },
): Promise<AgentRunResult> {
  const { tool } = opts;
  const finalSchema = openAiOutputSchema(
    opts.outputSchema ?? {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  );
  const turnSchema = {
    type: "object",
    properties: {
      [tool.name]: {
        anyOf: [openAiOutputSchema(tool.inputSchema), { type: "null" }],
      },
      final: { anyOf: [finalSchema, { type: "null" }] },
    },
    required: [tool.name, "final"],
    additionalProperties: false,
  };
  const protocol = `Tools are not called directly in this session. Each reply is one JSON object with two fields:
- "${tool.name}": the tool's arguments to call it (then "final": null). Its result arrives in the next message. ${tool.description}
- "final": your final answer (then "${tool.name}": null).
Call the tool sequentially, one call per reply.`;
  return withSession(opts, async ({ session, turn, counters }) => {
    const rounds: string[] = [];
    let images: string[] = [];
    for (let n = 1; n <= opts.maxTurns; n++) {
      const text = [
        opts.prompt,
        protocol,
        ...(rounds.length
          ? [`<previous_rounds>\n${rounds.join("\n")}\n</previous_rounds>`]
          : []),
      ].join("\n\n");
      const input: UserInput[] = [
        { type: "text", text },
        ...images.map((p) => ({ type: "local_image" as const, path: p })),
      ];
      const { text: reply } = await turn(input, turnSchema);
      const parsed = parseJson(reply) as Record<string, unknown> | undefined;
      if (!parsed) return { subtype: "error_invalid_structured_output" };
      const args = parsed[tool.name];
      if (args === null || args === undefined) {
        return parsed.final === null || parsed.final === undefined
          ? { subtype: "error_invalid_structured_output" }
          : { subtype: "success", structuredOutput: parsed.final };
      }
      counters.toolCalls++;
      const result = await tool.call(args);
      images = [];
      const texts: string[] = [];
      result.content.forEach((part, i) => {
        if (part.type === "text") texts.push(part.text);
        else {
          const file = path.join(session.workDir, `round-${n}-${i}.png`);
          fs.writeFileSync(file, Buffer.from(part.data, "base64"));
          images.push(file);
        }
      });
      rounds.push(
        `<round number="${n}">
<${tool.name}_arguments>${JSON.stringify(args)}</${tool.name}_arguments>
<${tool.name}_result is_error="${Boolean(result.isError)}"${images.length ? ` images_attached="${images.length}"` : ""}>
${texts.join("\n")}
</${tool.name}_result>
</round>`,
      );
    }
    return { subtype: "error_max_turns" };
  });
}
