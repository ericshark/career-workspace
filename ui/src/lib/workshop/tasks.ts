import { z } from "zod";
import { readPrompt } from "@/lib/claude/prompts";

export const taskModes = ["list", "plan"] as const;

export const taskRequestSchema = z.strictObject({
  mode: z.enum(taskModes),
  text: z.string().trim().min(3, "Describe what you want to do.").max(5000),
  title: z.string().trim().max(200),
  description: z.string().trim().max(5000),
  existing: z.array(z.string().trim().max(500)).max(200),
});
export type TaskRequest = z.infer<typeof taskRequestSchema>;

export const taskResultSchema = z.strictObject({
  tasks: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1).max(500),
        details: z.string().trim().max(1000),
      }),
    )
    .min(1)
    .max(25),
});

/**
 * JSON Schema for the model's structured output. Draft-7 on purpose: the Claude
 * CLI rejects the 2020-12 `$schema` line that Zod writes by default.
 */
export function taskJsonSchema() {
  return z.toJSONSchema(taskResultSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}

/** Splits prompts/workshop-tasks.md into its named sections. */
function sections(text: string) {
  const found: Record<string, string> = {};
  for (const match of text.matchAll(
    /^## (.+)\r?\n\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
  ))
    found[match[1].trim()] = match[2].trim();
  return found;
}

export function buildTaskPrompt(request: TaskRequest) {
  const parts = sections(readPrompt("workshop-tasks.md"));
  const systemPrompt = parts["System prompt"];
  const instruction =
    parts[request.mode === "list" ? "Use my list" : "Plan it"];
  if (!systemPrompt || !instruction)
    throw new Error("Invalid prompt sections: prompts/workshop-tasks.md");
  return {
    systemPrompt,
    prompt: `${instruction}

<project>
${JSON.stringify({ title: request.title, description: request.description })}
</project>
<existing_tasks>
${JSON.stringify(request.existing)}
</existing_tasks>
<note>
${request.text}
</note>`,
  };
}

/** UI_FIXTURES=1: no model call. "list" mode splits lines; "plan" mode returns fixed steps. */
export function fixtureTasks(request: TaskRequest) {
  if (request.mode === "list")
    return {
      tasks: request.text
        .split(/\r?\n|;/)
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 25)
        .map((title) => ({ title, details: "" })),
    };
  return {
    tasks: [
      { title: "Outline the goal", details: "Fixture plan step" },
      { title: "Build the first version", details: "" },
      { title: "Test and polish", details: "" },
    ],
  };
}
