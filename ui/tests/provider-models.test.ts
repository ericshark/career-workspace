import { describe, expect, it } from "vitest";
import {
  MODEL_IDS,
  PROVIDERS,
  counterpartModel,
  modelsFor,
  providerOf,
  quickModel,
} from "@/lib/config";

describe("provider model mapping", () => {
  it("offers one main and one fast model per provider", () => {
    for (const provider of PROVIDERS)
      expect(
        modelsFor(provider)
          .map((m) => m.tier)
          .sort(),
      ).toEqual(
        provider === "openai" ? ["fast", "main", "main"] : ["fast", "main"],
      );
  });
  it("maps each choice to its same-tier counterpart", () => {
    expect(counterpartModel("claude-sonnet-5-5", "openai")).toBe(
      "gpt-6.1-terra",
    );
    expect(counterpartModel("claude-haiku-5-5", "openai")).toBe("gpt-6-luna");
    expect(counterpartModel("gpt-6-luna", "claude")).toBe("claude-haiku-5-5");
    expect(counterpartModel("gpt-6.1-sol", "openai")).toBe("gpt-6.1-sol");
    expect(quickModel("claude")).toBe("claude-haiku-5-5");
    expect(quickModel("openai")).toBe("gpt-6-luna");
  });
  it("derives the provider from the model id, defaulting old records to Claude", () => {
    expect(MODEL_IDS.map(providerOf)).toEqual([
      "claude",
      "claude",
      "openai",
      "openai",
      "openai",
    ]);
    expect(providerOf("claude-opus-4")).toBe("claude");
  });
});
