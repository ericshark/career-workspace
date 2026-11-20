// Canonical instructions are read for each invocation so edits apply to the next query.
import fs from "node:fs";
import path from "node:path";
import { CAREER_ROOT, resolveInside } from "../paths";

export function readPrompt(name: string, root = CAREER_ROOT): string {
  if (!/^[a-z-]+\.md$/.test(name))
    throw new Error(`Invalid prompt name: ${name}`);
  const rel = `prompts/${name}`;
  const file = resolveInside(root, rel);
  if (!file || file !== path.join(fs.realpathSync(root), rel))
    throw new Error(`Source outside Career: ${rel}`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${rel}`);
  return fs.readFileSync(file, "utf8");
}

/** Quick Add has named sections; headings themselves are not model input. */
export function quickInstructions(name: "quick-add.md") {
  const text = readPrompt(name);
  const match =
    /^## System prompt\r?\n\r?\n([\s\S]+?)\r?\n\r?\n## User prompt\r?\n\r?\n([\s\S]+?)\s*$/.exec(
      text,
    );
  if (!match) throw new Error(`Invalid prompt sections: prompts/${name}`);
  return { systemPrompt: match[1], userPrompt: match[2] };
}

/** Substitute instruction slots before appending untrusted job data; never expand job content. */
export function fillInstructions(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Za-z]+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`Unknown prompt slot: ${key}`);
    return values[key];
  });
}

/** Keep review rules in the system prompt and its inline brief instructions in the user prompt. */
export function reviewInstructions(text: string) {
  const marker = "\n## Job brief\n\n";
  const boundary = text.indexOf(marker);
  if (boundary < 0 || !text.slice(boundary + marker.length).trim())
    throw new Error("Missing Job brief section in prompts/review-job.md");
  return {
    systemPrompt: text.slice(0, boundary),
    jobBrief: text.slice(boundary + marker.length),
  };
}
