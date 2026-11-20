// Browser-safe: describes every AI operation whose model and effort are chosen in Settings.
import {
  modelFor,
  modelsFor,
  providerOf,
  quickModel,
  type Provider,
} from "./config";
import type { Preferences } from "./preferences";

export type Effort = "low" | "medium" | "high";
export type ModelOperation =
  "quick" | "review" | "tailor" | "extras" | "findLink" | "workshop";

export const MODEL_OPERATIONS: {
  id: ModelOperation;
  label: string;
  hint: string;
  /** Prefix of the operationEfforts key (`<prefix>:<model>`). */
  effortKey: string;
}[] = [
  {
    id: "quick",
    label: "Quick add",
    hint: "Reads pasted jobs (Haiku or Luna, by provider)",
    effortKey: "quick",
  },
  {
    id: "review",
    label: "Review",
    hint: "Scores fit before you apply",
    effortKey: "review",
  },
  {
    id: "tailor",
    label: "Tailor",
    hint: "Tailors a resume to a job",
    effortKey: "tailor",
  },
  {
    id: "extras",
    label: "Questions & cover letter",
    hint: "Application answers and letters",
    effortKey: "extras",
  },
  {
    id: "findLink",
    label: "Find job link",
    hint: "Web search for a job's link (ChatGPT: Terra or Luna)",
    effortKey: "find-link",
  },
  {
    id: "workshop",
    label: "Workshop tasks",
    hint: "Tidy and Expand when adding tasks",
    effortKey: "workshop-tasks",
  },
];

/**
 * Find job link needs live web search, which only the ChatGPT provider has, so it ignores the
 * global provider; every other operation follows it.
 */
export const operationProvider = (
  prefs: Preferences,
  id: ModelOperation,
): Provider => (id === "findLink" ? "openai" : prefs.provider);

const operation = (id: ModelOperation) =>
  MODEL_OPERATIONS.find((entry) => entry.id === id)!;

/** The model an operation runs on for the current provider. */
export function operationModel(prefs: Preferences, id: ModelOperation): string {
  const provider = operationProvider(prefs, id);
  const sel = prefs.selections[provider];
  const chosen =
    id === "workshop"
      ? prefs.workshop?.models[provider]
      : id === "quick"
        ? sel.quick
        : id === "findLink"
          ? sel.findLink
          : sel[id];
  // Quick add and Find job link accept only the models offered for them; anything else stored
  // (an older choice, say) falls through to the default below.
  if (
    chosen &&
    providerOf(chosen) === provider &&
    (id !== "quick" && id !== "findLink"
      ? true
      : operationModels(prefs, id).some((model) => model.id === chosen))
  )
    return chosen;
  if (id === "quick") return quickModel(provider);
  // A research task with judgement calls (employer site vs aggregator), so the main model.
  if (id === "findLink") return "gpt-6.1-terra";
  if (id === "workshop") return modelFor(provider, "fast");
  return sel[id];
}

export function operationEffort(
  prefs: Preferences,
  id: ModelOperation,
): Effort {
  const model = operationModel(prefs, id);
  const stored = prefs.operationEfforts[`${operation(id).effortKey}:${model}`];
  if (stored) return stored;
  if (id === "quick" || id === "workshop") return "low";
  if (id === "findLink") return "medium";
  return prefs.efforts[model as keyof Preferences["efforts"]] ?? "medium";
}

export function withProvider(
  prefs: Preferences,
  provider: Provider,
): Preferences {
  return { ...prefs, provider };
}

export function withOperationModel(
  prefs: Preferences,
  id: ModelOperation,
  model: string,
): Preferences {
  const provider = operationProvider(prefs, id);
  if (id === "workshop")
    return {
      ...prefs,
      workshop: {
        provider,
        models: {
          claude: modelFor("claude", "fast"),
          openai: modelFor("openai", "fast"),
          ...prefs.workshop?.models,
          [provider]: model,
        },
      },
    };
  return {
    ...prefs,
    selections: {
      ...prefs.selections,
      [provider]: { ...prefs.selections[provider], [id]: model },
    },
  };
}

export function withOperationEffort(
  prefs: Preferences,
  id: ModelOperation,
  effort: Effort,
): Preferences {
  return {
    ...prefs,
    operationEfforts: {
      ...prefs.operationEfforts,
      [`${operation(id).effortKey}:${operationModel(prefs, id)}`]: effort,
    },
  };
}

/**
 * The models offered for an operation. Quick add runs only on the provider's fast model (Haiku or
 * Luna), so only its effort is a choice. Find job link is Terra or Luna.
 */
export function operationModels(prefs: Preferences, id: ModelOperation) {
  const provider = operationProvider(prefs, id);
  if (id === "quick")
    return modelsFor(provider).filter(
      (model) => model.id === quickModel(provider),
    );
  if (id === "findLink")
    return modelsFor(provider).filter(
      (model) => model.id === "gpt-6.1-terra" || model.id === "gpt-6-luna",
    );
  return modelsFor(provider);
}
