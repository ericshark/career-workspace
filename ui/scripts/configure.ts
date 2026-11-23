// Saves the AI provider and main model without opening the app. Used by the setup command (cli/).
//   configure.ts models                    available models as JSON
//   configure.ts set <provider> <model>    choose the provider and its main model
import { MODELS, PROVIDERS, type Provider } from "../src/lib/config";
import { readPreferences, savePreferences } from "../src/lib/preferences";

const [command, provider, model] = process.argv.slice(2);
if (command === "models") {
  console.log(
    JSON.stringify(
      MODELS.filter((m) => m.tier === "main").map(
        ({ id, label, provider }) => ({
          id,
          label,
          provider,
          default: readPreferences().selections[provider].review === id,
        }),
      ),
    ),
  );
} else if (
  command === "set" &&
  (PROVIDERS as readonly string[]).includes(provider)
) {
  const chosen = MODELS.find(
    (m) => m.id === model && m.provider === provider && m.tier === "main",
  );
  if (!chosen) throw new Error(`Unknown ${provider} model: ${model}`);
  const preferences = readPreferences();
  preferences.provider = provider as Provider;
  const selection = preferences.selections[provider as Provider];
  selection.review = selection.tailor = selection.extras = chosen.id;
  savePreferences(preferences);
  console.log(`Using ${chosen.label}.`);
} else {
  console.error("Usage: configure.ts models | set <provider> <model>");
  process.exit(2);
}
