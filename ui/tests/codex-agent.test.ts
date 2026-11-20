import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  openAiOutputSchema,
  runCodexAgent,
  runCodexToolLoop,
} from "@/lib/claude/codex";

const opts = {
  model: "gpt-6-luna" as const,
  prompt: "Synthetic posting",
  allowedTools: [],
  maxTurns: 3,
};
const schema = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
};
const complete = (text: string, extra: unknown[] = []) =>
  new Response(
    "data: " +
      JSON.stringify({
        type: "response.completed",
        response: {
          output: [
            ...extra,
            { type: "message", content: [{ type: "output_text", text }] },
          ],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      }) +
      "\n\n",
  );
const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("OPENAI_API_KEY", "fixture");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mockFetch.mockReset();
});

it("uses the Responses endpoint and strict output without tools by default", async () => {
  mockFetch.mockResolvedValueOnce(complete('{"value":"example"}'));
  expect(await runCodexAgent({ ...opts, outputSchema: schema })).toMatchObject({
    subtype: "success",
    structuredOutput: { value: "example" },
    metrics: { inputTokens: 10, outputTokens: 4 },
  });
  const [url, request] = mockFetch.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/responses");
  const body = JSON.parse(request.body);
  expect(body).toMatchObject({
    store: false,
    stream: true,
    text: { format: { strict: true, schema } },
  });
  expect(body.tools).toBeUndefined();
});
it("rejects incomplete streams and unexpected tool output", async () => {
  mockFetch
    .mockResolvedValueOnce(new Response("data: {}\n\n"))
    .mockResolvedValueOnce(complete("{}", [{ type: "function_call" }]));
  await expect(runCodexAgent(opts)).rejects.toThrow(/before completion/);
  await expect(runCodexAgent(opts)).rejects.toThrow(/unexpected tool/);
});
it("requires completed web search only for the explicit link lookup operation", async () => {
  mockFetch
    .mockResolvedValueOnce(complete("{}"))
    .mockResolvedValueOnce(
      complete("{}", [{ type: "web_search_call", status: "completed" }]),
    );
  expect(
    (await runCodexAgent({ ...opts, operation: "find-link" })).subtype,
  ).toBe("error_no_search");
  expect(
    (await runCodexAgent({ ...opts, operation: "find-link" })).subtype,
  ).toBe("success");
});
it("handles malformed JSON as invalid structured output", async () => {
  mockFetch.mockResolvedValueOnce(complete("plain text"));
  expect((await runCodexAgent({ ...opts, outputSchema: schema })).subtype).toBe(
    "error_invalid_structured_output",
  );
});
it("runs only the controlled tool, then replays its result", async () => {
  const call = vi.fn(async () => ({
    content: [{ type: "text" as const, text: "Candidate accepted" }],
  }));
  mockFetch
    .mockResolvedValueOnce(
      complete('{"submit_candidate":{"value":"change"},"final":null}'),
    )
    .mockResolvedValueOnce(
      complete('{"submit_candidate":null,"final":{"value":"pass"}}'),
    );
  expect(
    await runCodexToolLoop({
      ...opts,
      outputSchema: schema,
      tool: {
        name: "submit_candidate",
        description: "Submit change",
        inputSchema: schema,
        call,
      },
    }),
  ).toMatchObject({
    subtype: "success",
    structuredOutput: { value: "pass" },
    metrics: { toolCalls: 1 },
  });
  expect(call).toHaveBeenCalledWith({ value: "change" });
  expect(mockFetch.mock.calls[1][1].body).toContain("Candidate accepted");
});
it("rejects optional properties in a strict schema before a provider call", () => {
  expect(() => openAiOutputSchema({ ...schema, required: [] })).toThrow();
});
