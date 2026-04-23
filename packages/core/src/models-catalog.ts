export type ModelTier = "nano" | "mini" | "flash" | "pro" | "legacy";

export type ModelDescriptor = {
  id: string;
  provider: "anthropic" | "openai" | "gemini";
  tier: ModelTier;
  label: string;
  blurb: string;
  recommended: boolean;
  deprecatedAfter?: string; // ISO date; UI grays out if past
};

export const MODEL_CATALOG: readonly ModelDescriptor[] = [
  // Anthropic
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    tier: "flash",
    label: "Claude Haiku 4.5",
    blurb: "fast, cheap — ideal for pet chat",
    recommended: true,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    tier: "pro",
    label: "Claude Sonnet 4.6",
    blurb: "balanced — capable but not overkill",
    recommended: false,
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    tier: "pro",
    label: "Claude Opus 4.6",
    blurb: "heavy lift — slow, expensive, overkill for pet chat",
    recommended: false,
  },
  // OpenAI
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    tier: "mini",
    label: "GPT-5.4 mini",
    blurb: "fast, cheap — recommended for pet chat",
    recommended: true,
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    tier: "nano",
    label: "GPT-5.4 nano",
    blurb: "cheapest, fastest — lightweight nudges",
    recommended: false,
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    tier: "mini",
    label: "GPT-5 mini",
    blurb: "capable small model",
    recommended: false,
  },
  {
    id: "gpt-5",
    provider: "openai",
    tier: "pro",
    label: "GPT-5",
    blurb: "frontier model — slow, heavy, overkill",
    recommended: false,
  },
  {
    id: "gpt-4.1",
    provider: "openai",
    tier: "legacy",
    label: "GPT-4.1",
    blurb: "stable fallback",
    recommended: false,
  },
  // Gemini
  {
    id: "gemini-3-flash-preview",
    provider: "gemini",
    tier: "flash",
    label: "Gemini 3 Flash",
    blurb: "fast, frontier flash — recommended for pet chat",
    recommended: true,
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    provider: "gemini",
    tier: "nano",
    label: "Gemini 3.1 Flash-Lite",
    blurb: "cheapest, fastest Gemini option",
    recommended: false,
  },
  {
    id: "gemini-2.5-flash",
    provider: "gemini",
    tier: "flash",
    label: "Gemini 2.5 Flash",
    blurb: "stable flash fallback",
    recommended: false,
  },
  {
    id: "gemini-flash-latest",
    provider: "gemini",
    tier: "flash",
    label: "Gemini Flash (latest)",
    blurb: "always the newest flash alias",
    recommended: false,
  },
  {
    id: "gemini-2.5-pro",
    provider: "gemini",
    tier: "pro",
    label: "Gemini 2.5 Pro",
    blurb: "heavy lift — overkill for pet chat",
    recommended: false,
  },
];

export function getModelsForProvider(
  provider: "anthropic" | "openai" | "gemini"
): readonly ModelDescriptor[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

export function getRecommendedModel(
  provider: "anthropic" | "openai" | "gemini"
): ModelDescriptor | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.recommended);
}

export function isDeprecated(model: ModelDescriptor): boolean {
  if (!model.deprecatedAfter) return false;
  return new Date(model.deprecatedAfter) < new Date();
}
