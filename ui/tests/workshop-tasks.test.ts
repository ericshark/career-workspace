import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const runAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/claude/agent", async (original) => ({
  ...(await original<typeof import("@/lib/claude/agent")>()),
  runAgent,
}));

let root: string;
beforeEach(() => {
  vi.resetModules();
  runAgent.mockReset();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-tasks-"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.stubEnv("UI_FIXTURES", "0");
  fs.mkdirSync(path.join(root, "prompts"));
  fs.copyFileSync(
    path.resolve("../prompts/workshop-tasks.md"),
    path.join(root, "prompts/workshop-tasks.md"),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

const body = {
  mode: "plan",
  text: "Add login with passkeys",
  title: "Portfolio",
  description: "Personal site",
  existing: ["Set up repo"],
};
async function post(payload: unknown) {
  const { POST } = await import("@/app/api/workshop/tasks/route");
  return POST(
    new Request("http://localhost/api/workshop/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

it("returns suggested tasks from the fast model without saving anything", async () => {
  runAgent.mockResolvedValue({
    subtype: "success",
    structuredOutput: {
      tasks: [{ title: "Add passkey library", details: "SimpleWebAuthn" }],
    },
  });
  const response = await post(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    tasks: [{ title: "Add passkey library", details: "SimpleWebAuthn" }],
  });
  const call = runAgent.mock.calls[0][0];
  expect(call).toMatchObject({
    operation: "workshop-tasks",
    // Claude needs a second turn to deliver structured output.
    maxTurns: 3,
    allowedTools: [],
    // The default provider's fast model at low effort.
    model: "gpt-6-luna",
    effort: "low",
  });
  // The Claude CLI rejects the 2020-12 $schema Zod writes by default.
  expect(call.outputSchema.$schema).toBe(
    "http://json-schema.org/draft-07/schema#",
  );
  // The typed note, project and existing tasks travel as data; the prompt
  // file supplies the instructions for the chosen mode.
  expect(call.prompt).toContain("Add login with passkeys");
  expect(call.prompt).toContain("Set up repo");
  expect(call.prompt).toContain(
    "the workspace owner wrote a few things he wants to do",
  );
  expect(fs.existsSync(path.join(root, "ui/.workshop"))).toBe(false);
});

it("uses the list instructions for 'Use my list'", async () => {
  runAgent.mockResolvedValue({
    subtype: "success",
    structuredOutput: { tasks: [{ title: "One", details: "" }] },
  });
  await post({ ...body, mode: "list" });
  expect(runAgent.mock.calls[0][0].prompt).toContain(
    "the workspace owner typed the tasks himself",
  );
});

it("rejects too-short notes and unknown fields", async () => {
  expect((await post({ ...body, text: "hi" })).status).toBe(400);
  expect((await post({ ...body, extra: true })).status).toBe(400);
  expect(runAgent).not.toHaveBeenCalled();
});

it("reports an unusable model result instead of inventing tasks", async () => {
  runAgent.mockResolvedValue({
    subtype: "success",
    structuredOutput: { tasks: [] },
  });
  const response = await post(body);
  expect(response.status).toBe(502);
  // One retry for a malformed answer.
  expect(runAgent).toHaveBeenCalledTimes(2);
});

it("retries once and succeeds when the first answer is malformed", async () => {
  runAgent
    .mockResolvedValueOnce({ subtype: "success", structuredOutput: {} })
    .mockResolvedValueOnce({
      subtype: "success",
      structuredOutput: { tasks: [{ title: "One", details: "" }] },
    });
  const response = await post(body);
  expect(response.status).toBe(200);
  expect(runAgent).toHaveBeenCalledTimes(2);
});

it("shows a short message instead of raw CLI errors", async () => {
  runAgent.mockRejectedValue(
    new Error("Claude Code process exited with code 1. stderr: boom"),
  );
  const response = await post(body);
  expect(response.status).toBe(502);
  const message = (await response.json()).error.message as string;
  expect(message).toContain("Could not get task suggestions");
  expect(message).not.toContain("stderr");
});

it("uses the provider, model and effort chosen in Settings", async () => {
  fs.mkdirSync(path.join(root, "ui/.cache"), { recursive: true });
  const { defaultPreferences } = await import("@/lib/preferences");
  const preferences = defaultPreferences();
  fs.writeFileSync(
    path.join(root, "ui/.cache/preferences.json"),
    JSON.stringify({
      ...preferences,
      provider: "claude",
      workshop: {
        provider: "claude",
        models: { claude: "claude-sonnet-5-5", openai: "gpt-6-luna" },
      },
      operationEfforts: { "workshop-tasks:claude-sonnet-5-5": "high" },
    }),
  );
  runAgent.mockResolvedValue({
    subtype: "success",
    structuredOutput: { tasks: [{ title: "One", details: "" }] },
  });
  await post(body);
  expect(runAgent.mock.calls[0][0]).toMatchObject({
    model: "claude-sonnet-5-5",
    effort: "high",
  });
});

it("every JSON Schema handed to a model uses draft-7", async () => {
  const { globSync } = await import("node:fs");
  for (const file of globSync("src/**/*.ts")) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/z\.toJSONSchema\(/g)) {
      // The whole call, up to its matching parenthesis.
      let depth = 0;
      let end = match.index + match[0].length - 1;
      for (; end < text.length; end++) {
        if (text[end] === "(") depth++;
        if (text[end] === ")" && --depth === 0) break;
      }
      const call = text.slice(match.index, end + 1);
      expect(call, `${file} needs target: "draft-7"`).toContain("draft-7");
    }
  }
});

it("returns canned tasks in fixture mode without a model call", async () => {
  vi.stubEnv("UI_FIXTURES", "1");
  const response = await post({
    ...body,
    mode: "list",
    text: "- First\n2. Second; Third",
  });
  expect(
    (await response.json()).tasks.map((task: { title: string }) => task.title),
  ).toEqual(["First", "Second", "Third"]);
  expect(runAgent).not.toHaveBeenCalled();
});
