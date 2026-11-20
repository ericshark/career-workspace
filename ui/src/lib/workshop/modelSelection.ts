// Browser-safe: used by the API route and by the Workshop model settings popover.
import { modelFor, modelsFor, providerOf, type Provider } from "@/lib/config";
import type { Preferences } from "@/lib/preferences";

/**
 * Provider, model and effort for Workshop task suggestions. The default is the
 * provider chosen in Settings with its fast model at low effort: these are short
 * structured-output jobs with no tools, so speed matters more than depth.
 */
export function workshopSelection(preferences: Preferences) {
  // The provider is the one global choice in Settings.
  const provider: Provider = preferences.provider;
  const chosen = preferences.workshop?.models[provider];
  const model =
    chosen && providerOf(chosen) === provider
      ? chosen
      : modelFor(provider, "fast");
  const effort =
    preferences.operationEfforts[`workshop-tasks:${model}`] ?? "low";
  return { provider, model, effort, models: modelsFor(provider) };
}
