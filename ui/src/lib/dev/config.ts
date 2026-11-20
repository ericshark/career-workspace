import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CAREER_ROOT } from "@/lib/paths";
import type { ServiceDef, SetupStep } from "./types";

/**
 * Custom run setups for projects whose dev server cannot be detected from a root
 * `package.json` dev script. They live in `ui/.workshop/dev.json` (Git-ignored,
 * local to this machine), never in the Workshop snapshot: a snapshot can be
 * restored or imported, and these are shell commands.
 *
 *   { "projects": { "/abs/path/to/repo": { "services": [...], "setup": [...] } } }
 */
const service = z.strictObject({
  name: z.string().min(1),
  cwd: z.string().optional(),
  command: z.string().min(1),
  defaultPort: z.number().int().min(1).max(65535).optional(),
  env: z.record(z.string(), z.string()).optional(),
  open: z.boolean().optional(),
  url: z.string().optional(),
});
const setup = z.strictObject({
  name: z.string().min(1),
  cwd: z.string().optional(),
  command: z.string().min(1),
  creates: z.string().optional(),
});
const override = z.strictObject({
  services: z.array(service).optional(),
  setup: z.array(setup).optional(),
});
const file = z.strictObject({ projects: z.record(z.string(), override) });

export interface ProjectOverride {
  services?: ServiceDef[];
  setup?: SetupStep[];
}

export const DEV_CONFIG_FILE = path.join(CAREER_ROOT, "ui/.workshop/dev.json");

/** The override for a repo root, or undefined. A missing or unreadable file means none. */
export function projectOverride(repoRoot: string): ProjectOverride | undefined {
  let text: string;
  try {
    text = fs.readFileSync(DEV_CONFIG_FILE, "utf8");
  } catch {
    return undefined;
  }
  try {
    return file.parse(JSON.parse(text)).projects[repoRoot];
  } catch (error) {
    console.error(
      `[workshop dev] could not read ${DEV_CONFIG_FILE}: ${(error as Error).message}`,
    );
    return undefined;
  }
}
