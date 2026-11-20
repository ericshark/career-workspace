import { expect, it } from "vitest";
import { defaultPreferences, preferencesSchema } from "@/lib/preferences";
import {
  operationEffort,
  operationModel,
  operationModels,
  withOperationEffort,
  withOperationModel,
  withProvider,
} from "@/lib/modelSettings";

it("defaults every operation to a model of the chosen provider", () => {
  const prefs = defaultPreferences();
  expect(operationModel(prefs, "quick")).toBe("gpt-6-luna");
  expect(operationModel(prefs, "findLink")).toBe("gpt-6.1-terra");
  expect(operationModel(prefs, "review")).toBe("gpt-6.1-terra");
  const claude = withProvider(prefs, "claude");
  expect(operationModel(claude, "quick")).toBe("claude-haiku-5-5");
  expect(operationModel(claude, "workshop")).toBe("claude-haiku-5-5");
  // Link search needs live web search, which only ChatGPT has, whatever the provider.
  expect(operationModel(claude, "findLink")).toBe("gpt-6.1-terra");
});

it("changes one operation's effort and model without touching the others", () => {
  let prefs = defaultPreferences();
  prefs = withOperationEffort(prefs, "quick", "high");
  prefs = withOperationModel(prefs, "findLink", "gpt-6-luna");
  expect(preferencesSchema.parse(prefs)).toBeTruthy();
  expect(operationModel(prefs, "quick")).toBe("gpt-6-luna");
  expect(operationEffort(prefs, "quick")).toBe("high");
  expect(operationModel(prefs, "findLink")).toBe("gpt-6-luna");
  expect(operationEffort(prefs, "findLink")).toBe("medium");
  expect(operationModel(prefs, "review")).toBe("gpt-6.1-terra");
  expect(prefs.operationEfforts["quick:gpt-6-luna"]).toBe("high");
});

it("offers only Haiku or Luna for Quick add and Terra or Luna for Find job link", () => {
  const openai = defaultPreferences();
  const claude = withProvider(openai, "claude");
  expect(operationModels(openai, "quick").map((m) => m.id)).toEqual([
    "gpt-6-luna",
  ]);
  expect(operationModels(claude, "quick").map((m) => m.id)).toEqual([
    "claude-haiku-5-5",
  ]);
  expect(operationModels(claude, "findLink").map((m) => m.id)).toEqual([
    "gpt-6.1-terra",
    "gpt-6-luna",
  ]);
  // A model outside the offered set (here, an older Sol choice) falls back to the default.
  const stale = withOperationModel(
    withOperationModel(openai, "quick", "gpt-6.1-sol"),
    "findLink",
    "gpt-6.1-sol",
  );
  expect(operationModel(stale, "quick")).toBe("gpt-6-luna");
  expect(operationModel(stale, "findLink")).toBe("gpt-6.1-terra");
});
