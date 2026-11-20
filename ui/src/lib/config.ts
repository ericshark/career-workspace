// Browser-safe shared defaults. Keep these independent of filesystem and server imports.
export const MAX_QUICK = 50;
export const MAX_QUICK_BATCH_CHARS = 250_000;
// Longest single description the quick-add API accepts; checked in the browser too, so a request
// that would be rejected never gets as far as clearing the composer.
export const MAX_QUICK_JOB_CHARS = 50_000;
const target = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};
export const DAY_TARGET = target(process.env.NEXT_PUBLIC_CAREER_DAY_TARGET, 5);
export const WEEK_TARGET = target(
  process.env.NEXT_PUBLIC_CAREER_WEEK_TARGET,
  DAY_TARGET * 5,
);
export const TIME_ZONE =
  process.env.NEXT_PUBLIC_CAREER_TIME_ZONE ||
  Intl.DateTimeFormat().resolvedOptions().timeZone;
export const PROVIDERS = ["claude", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: "Claude",
  openai: "OpenAI",
};
export type ModelTier = "main" | "fast";
export const MODELS = [
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    provider: "claude",
    tier: "main",
  },
  {
    id: "claude-haiku-5-5",
    label: "Haiku 5.5",
    provider: "claude",
    tier: "fast",
  },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "openai", tier: "main" },
  {
    id: "gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    provider: "openai",
    tier: "main",
  },
  { id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", tier: "fast" },
] as const satisfies readonly {
  id: string;
  label: string;
  provider: Provider;
  tier: ModelTier;
}[];
type ConfiguredModelId = (typeof MODELS)[number]["id"];
export const MODEL_IDS = MODELS.map((model) => model.id) as [
  ConfiguredModelId,
  ...ConfiguredModelId[],
];
export const DEFAULT_REVIEW_MODEL = "gpt-6.1-terra" as const;
export const DEFAULT_TAILOR_MODEL = "gpt-6.1-terra" as const;
export const DEFAULT_EXTRAS_MODEL = "gpt-6.1-terra" as const;
export const DEFAULT_MODEL = DEFAULT_REVIEW_MODEL;
export const QUICK_MODEL = MODELS[1].id;
export const QUICK_MODEL_LABEL = MODELS[1].label;

function modelEntry(id: string) {
  return MODELS.find((model) => model.id === id);
}
/** Shared effort policy; matching labels do not imply identical provider usage. */
export function modelEffort(id: ConfiguredModelId): "low" | "high" | "medium" {
  return providerOf(id) === "claude" && modelEntry(id)?.tier === "fast"
    ? "low"
    : "medium";
}
export function providerOf(id: string): Provider {
  return modelEntry(id)?.provider ?? "claude";
}
export function modelsFor(provider: Provider) {
  return MODELS.filter((model) => model.provider === provider);
}
export function modelFor(
  provider: Provider,
  tier: ModelTier,
): ConfiguredModelId {
  return modelsFor(provider).find((model) => model.tier === tier)!.id;
}
/** Preserve exact models within a provider; use the default counterpart when crossing providers. */
export function counterpartModel(
  id: string,
  provider: Provider,
): ConfiguredModelId {
  if (modelEntry(id)?.provider === provider) return id as ConfiguredModelId;
  return provider === "openai" && modelEntry(id)?.tier !== "fast"
    ? "gpt-6.1-terra"
    : modelFor(provider, modelEntry(id)?.tier ?? "main");
}
export function quickModel(provider: Provider): ConfiguredModelId {
  return modelFor(provider, "fast");
}
export function modelLabel(id: string): string {
  return modelEntry(id)?.label ?? id;
}
export const RESUMES = ["tech", "general", "datacenter"] as const;

/** Calendar offsets operate on New York's calendar day, including across DST boundaries. */
export function localDate(now = new Date(), plusDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (key: string) => parts.find((p) => p.type === key)!.value;
  const iso = `${value("year")}-${value("month")}-${value("day")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + plusDays);
  return date.toISOString().slice(0, 10);
}
/** Application days roll over at 03:00 New York wall time, including DST transitions. */
export function applicationDate(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return localDate(now, hour < 3 ? -1 : 0);
}
export const localToday = applicationDate;
export function laneForResume(
  resume: string,
  base?: string,
): "tech" | "bridge" {
  const master = resume.startsWith("tailored/") ? base : resume;
  return master === "datacenter" || master === "hourly" ? "bridge" : "tech";
}
