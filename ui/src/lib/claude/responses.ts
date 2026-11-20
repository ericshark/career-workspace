import fs from "node:fs";
import { z } from "zod";
export type UserInput =
  { type: "text"; text: string } | { type: "local_image"; path: string };
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  reasoning_output_tokens: number;
}
import { AgentError, type AgentRunOptions } from "./agent";
import { chatGptToken, openAiMode } from "./chatgpt-connection";

const base = "https://api.openai.com/v1";
export async function openResponses(
  opts: AgentRunOptions,
  signal: AbortSignal,
) {
  const plan = openAiMode() === "chatgpt";
  if (!plan && !process.env.OPENAI_API_KEY)
    throw new AgentError(
      "Set OPENAI_API_KEY in ui/.env.local or connect a ChatGPT plan in Models.",
      "auth",
    );
  const getToken = async () =>
    plan ? chatGptToken() : process.env.OPENAI_API_KEY!;
  if (plan) {
    let token: string;
    try {
      token = await getToken();
    } catch (error) {
      throw new AgentError((error as Error).message, "auth");
    }
    const catalog = await fetch(base + "/models", {
      headers: { Authorization: "Bearer " + token },
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!catalog.ok)
      throw new AgentError(
        "Could not load ChatGPT models. Check your plan or reconnect from Models.",
        "auth",
      );
    const { models } = z
      .object({ models: z.array(z.object({ slug: z.string() })) })
      .parse(await catalog.json());
    if (!models.some((model) => model.slug === opts.model))
      throw new AgentError(
        `${opts.model} is unavailable on this ChatGPT account. Select another model or explicitly switch to API key in Models.`,
        "claude",
      );
  }
  return async (
    input: string | UserInput[],
    schema?: Record<string, unknown>,
  ) => {
    const token = await getToken();
    const content =
      typeof input === "string"
        ? input
        : input.map((part) =>
            part.type === "text"
              ? { type: "input_text", text: part.text }
              : {
                  type: "input_image",
                  image_url:
                    "data:image/png;base64," +
                    fs.readFileSync(part.path).toString("base64"),
                  detail: "auto",
                },
          );
    const search = opts.operation === "find-link";
    const response = await fetch(base + "/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      signal,
      redirect: "error",
      cache: "no-store",
      body: JSON.stringify({
        model: opts.model,
        instructions: opts.systemPrompt,
        input: [{ role: "user", content }],
        store: false,
        stream: true,
        reasoning: { effort: opts.effort ?? "low" },
        ...(search ? { tools: [{ type: "web_search" }] } : {}),
        ...(schema
          ? {
              text: {
                format: {
                  type: "json_schema",
                  name: "career_result",
                  strict: true,
                  schema,
                },
              },
            }
          : {}),
      }),
    });
    if (!response.ok || !response.body) {
      const message =
        response.status === 429
          ? "Usage limit reached. Check your provider's balance and rate limits."
          : response.status === 401 || response.status === 403
            ? "OpenAI rejected this connection or model. Check Models."
            : `OpenAI request failed (HTTP ${response.status}). Check the selected model and try again.`;
      throw new AgentError(
        message,
        response.status === 401 || response.status === 403 ? "auth" : "claude",
      );
    }
    let pending = "";
    for await (const chunk of response.body.pipeThrough(
      new TextDecoderStream(),
    )) {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end).trimEnd();
        pending = pending.slice(end + 1);
        if (!line.startsWith("data: {")) continue;
        const event = JSON.parse(line.slice(6));
        if (
          event.type === "response.failed" ||
          event.type === "error" ||
          event.type === "response.incomplete"
        )
          throw new AgentError(
            "OpenAI did not complete the response. Check model access and provider usage limits.",
            "claude",
          );
        if (event.type !== "response.completed") continue;
        const result = event.response;
        const items = result.output ?? [];
        if (
          items.some(
            (item: { type: string }) =>
              ![
                "reasoning",
                "message",
                ...(search ? ["web_search_call"] : []),
              ].includes(item.type),
          )
        )
          throw new AgentError(
            "OpenAI returned an unexpected tool call.",
            "claude",
          );
        const text = items
          .flatMap(
            (item: { content?: { type: string; text?: string }[] }) =>
              item.content ?? [],
          )
          .filter((part: { type: string }) => part.type === "output_text")
          .map((part: { text: string }) => part.text)
          .join("");
        const usage: Usage | undefined = result.usage
          ? {
              input_tokens: result.usage.input_tokens,
              output_tokens: result.usage.output_tokens,
              cached_input_tokens:
                result.usage.input_tokens_details?.cached_tokens ?? 0,
              cache_write_input_tokens:
                result.usage.input_tokens_details?.cache_write_tokens ?? 0,
              reasoning_output_tokens:
                result.usage.output_tokens_details?.reasoning_tokens ?? 0,
            }
          : undefined;
        return {
          text,
          searched: items.some(
            (item: { type: string; status?: string }) =>
              item.type === "web_search_call" && item.status === "completed",
          ),
          usage,
        };
      }
    }
    throw new AgentError(
      "OpenAI closed the response before completion.",
      "claude",
    );
  };
}
