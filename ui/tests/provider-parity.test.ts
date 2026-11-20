import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerQuestions,
  writeCoverLetter,
  fixtureQuestions,
  fixtureCover,
} from "@/lib/claude/extras";
import { runAgent } from "@/lib/claude/agent";

const state = vi.hoisted(() => ({
  root: `/tmp/career-parity-${crypto.randomUUID()}`,
  output: {} as unknown,
  claude: [] as any[],
  codex: [] as any[],
  controller: undefined as AbortController | undefined,
}));
vi.mock("@/lib/paths", async (original) => ({
  ...(await original<typeof import("@/lib/paths")>()),
  CAREER_ROOT: state.root,
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: (_f: string, _a: unknown, _o: unknown, cb: any) =>
    cb(null, {
      stdout: JSON.stringify({
        models: [{ slug: "gpt-6.1-sol" }, { slug: "gpt-6-luna" }],
      }),
      stderr: "",
    }),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (request: any) => {
    state.claude.push(request);
    return (async function* () {
      if (state.controller) {
        state.controller.abort(new Error("timeout"));
        throw new Error("aborted");
      }
      yield {
        type: "result",
        subtype: "success",
        structured_output: state.output,
      };
    })();
  },
}));
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "fixture");
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      state.codex.push({ body, signal: init.signal });
      if (state.controller) {
        state.controller.abort(new Error("timeout"));
        throw new Error("aborted");
      }
      const event = {
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: JSON.stringify(state.output) },
              ],
            },
          ],
        },
      };
      return new Response("data: " + JSON.stringify(event) + "\n\n");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  state.claude.length = 0;
  state.codex.length = 0;
  state.controller = undefined;
  fs.rmSync(state.root, { recursive: true, force: true });
});

describe("provider task parity", () => {
  for (const [claude, codex, effort] of [
    ["claude-sonnet-5-5", "gpt-6.1-sol", "medium"],
    ["claude-haiku-5-5", "gpt-6-luna", "medium"],
  ] as const) {
    it(`${claude} and ${codex} receive the same Questions and letter inputs and schemas`, async () => {
      const inputs = {
        careerEvidence: "Built supported services.",
        resumeVisible: "Supported services.",
        questionsRules: "Answer from facts.",
        coverRules: "Write from facts.",
      };
      for (const operation of ["questions", "letter"] as const) {
        state.output =
          operation === "questions"
            ? fixtureQuestions(["Why this role?"])
            : fixtureCover();
        const invoke = (model: typeof claude | typeof codex) =>
          operation === "questions"
            ? answerQuestions(
                inputs,
                "Job description",
                ["Why this role?"],
                model,
              )
            : writeCoverLetter(inputs, "Job description", model);
        expect(await invoke(claude)).toEqual(await invoke(codex));
        const a = state.claude.at(-1),
          b = state.codex.at(-1);
        expect(a.prompt).toBe(b.body.input[0].content);
        expect(a.options.systemPrompt).toBe(b.body.instructions);
        const { $schema: _draft, ...schema } = a.options.outputFormat.schema;
        expect(schema).toEqual(b.body.text.format.schema);
        expect(a.options).toMatchObject({
          effort: claude.includes("haiku") ? "low" : effort,
          tools: [],
          settingSources: [],
          permissionMode: "dontAsk",
          persistSession: false,
          maxTurns: 3,
        });
        expect(b.body).toMatchObject({
          reasoning: { effort },
          store: false,
          stream: true,
        });
        expect(b.body.tools).toBeUndefined();
      }
    });
  }
  it.each(["claude-sonnet-5-5", "gpt-6.1-sol"] as const)(
    "%s propagates cancellation during the SDK stream",
    async (model) => {
      state.controller = new AbortController();
      await expect(
        runAgent({
          model,
          prompt: "test",
          allowedTools: [],
          maxTurns: 3,
          signal: state.controller.signal,
        }),
      ).rejects.toMatchObject({ kind: "timeout" });
      if (model.startsWith("claude"))
        expect(state.claude[0].options.abortController.signal.aborted).toBe(
          true,
        );
      else expect(state.codex[0].signal.aborted).toBe(true);
    },
  );
});
