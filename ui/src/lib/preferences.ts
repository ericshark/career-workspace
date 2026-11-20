import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CAREER_ROOT } from "./paths";
import {
  MODEL_IDS,
  modelFor,
  modelsFor,
  providerOf,
  type Provider,
} from "./config";
const selection = z.object({
  review: z.enum(MODEL_IDS),
  tailor: z.enum(MODEL_IDS),
  extras: z.enum(MODEL_IDS),
  // Optional so older preference files still load; fall back to the fast model.
  quick: z.enum(MODEL_IDS).optional(),
  findLink: z.enum(MODEL_IDS).optional(),
});
export const preferencesSchema = z.object({
  version: z.literal(1),
  provider: z.enum(["claude", "openai"]),
  selections: z.object({ claude: selection, openai: selection }),
  efforts: z.record(z.enum(MODEL_IDS), z.enum(["low", "medium", "high"])),
  operationEfforts: z
    .record(z.string(), z.enum(["low", "medium", "high"]))
    .default({}),
  contextMode: z.enum(["original", "brief"]),
  // Provider and model for Workshop's AI task suggestions. Optional so older
  // preference files still load; effort lives in operationEfforts.
  workshop: z
    .object({
      provider: z.enum(["claude", "openai"]),
      models: z.object({
        claude: z.enum(MODEL_IDS),
        openai: z.enum(MODEL_IDS),
      }),
    })
    .optional(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
const file = () => path.join(CAREER_ROOT, "ui/.cache/preferences.json");
export function defaultPreferences(): Preferences {
  return {
    operationEfforts: {},
    version: 1,
    provider: "openai",
    selections: {
      claude: {
        review: "claude-sonnet-5-5",
        tailor: "claude-sonnet-5-5",
        extras: "claude-sonnet-5-5",
        quick: "claude-haiku-5-5",
        findLink: "claude-haiku-5-5",
      },
      openai: {
        review: "gpt-6.1-terra",
        tailor: "gpt-6.1-terra",
        extras: "gpt-6.1-terra",
        quick: "gpt-6-luna",
        findLink: "gpt-6.1-terra",
      },
    },
    efforts: {
      "claude-sonnet-5-5": "medium",
      "claude-haiku-5-5": "low",
      "gpt-6.1-sol": "medium",
      "gpt-6.1-terra": "medium",
      "gpt-6-luna": "medium",
    },
    contextMode: "original",
  };
}
export function readPreferences(): Preferences {
  try {
    return preferencesSchema.parse(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return defaultPreferences();
  }
}
export function savePreferences(value: Preferences): void {
  const parsed = preferencesSchema.parse(value);
  for (const provider of ["claude", "openai"] as const)
    for (const model of Object.values(parsed.selections[provider])) {
      if ((model.startsWith("gpt-") ? "openai" : "claude") !== provider)
        throw new Error("Model does not belong to provider");
    }
  if (parsed.workshop)
    for (const provider of ["claude", "openai"] as const)
      if (providerOf(parsed.workshop.models[provider]) !== provider)
        throw new Error("Model does not belong to provider");
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const temp = `${file()}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(parsed), { mode: 0o600 });
    fs.renameSync(temp, file());
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
