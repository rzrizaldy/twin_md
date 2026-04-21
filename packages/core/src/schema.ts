import matter from "gray-matter";
import { z } from "zod";
import type { TwinConfig, TwinSpecies } from "./config.js";

export const TWIN_SECTIONS = [
  "health",
  "calendar",
  "location",
  "claude_memory_signals",
  "obsidian_signals",
  "now"
] as const;

export type TwinSectionName = (typeof TWIN_SECTIONS)[number];
export type TwinScalar = string | number | boolean | null | string[];
export type TwinSection = Record<string, TwinScalar>;

export const TwinScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string())
]);

export const TwinSectionSchema = z.record(z.string(), TwinScalarSchema);

export const TwinDocumentSchema = z.object({
  updated: z.string(),
  species: z.enum(["axolotl", "cat", "slime"]),
  owner: z.string(),
  sections: z.object({
    health: TwinSectionSchema,
    calendar: TwinSectionSchema,
    location: TwinSectionSchema,
    claude_memory_signals: TwinSectionSchema,
    obsidian_signals: TwinSectionSchema,
    now: TwinSectionSchema
  })
});

export type TwinDocument = z.infer<typeof TwinDocumentSchema>;

const SECTION_SET = new Set<string>(TWIN_SECTIONS);

export function createSeedTwinDocument(config: TwinConfig): TwinDocument {
  const now = new Date().toISOString();
  return {
    updated: now,
    owner: config.owner,
    species: config.species,
    sections: {
      health: {
        sleep_last_night: "unknown",
        sleep_7d_avg: "unknown",
        steps_today: 0,
        hrv_7d: "unknown",
        workouts_7d: 0
      },
      calendar: {
        events_today: 0,
        deep_work_blocks: 0,
        next_deadline: "untracked",
        density_score: 0
      },
      location: {
        home_ratio_7d: "unknown",
        novelty_score: "unknown"
      },
      claude_memory_signals: {
        recent_topics: ["setup"],
        tone_7d: "neutral",
        wins: "bootstrapped twin.md",
        frictions: "data sources not connected yet"
      },
      obsidian_signals: {
        daily_note_streak: 0,
        recent_tags: [],
        unfinished_todos: 0,
        last_reflection: "No vault connected yet."
      },
      now: {
        mood_self_report: null,
        context: "Fresh twin initialized."
      }
    }
  };
}

export function serializeTwinDocument(document: TwinDocument): string {
  const frontmatter = matter.stringify("", {
    updated: document.updated,
    species: document.species,
    owner: document.owner
  }).trim();

  const sections = TWIN_SECTIONS.map((section) => {
    const values = document.sections[section];
    const lines = Object.entries(values).map(
      ([key, value]) => `- ${key}: ${formatTwinScalar(value)}`
    );
    return [`## ${section}`, ...lines].join("\n");
  }).join("\n\n");

  return `${frontmatter}\n\n# twin.md\n\n${sections}\n`;
}

export function parseTwinMarkdown(markdown: string): TwinDocument {
  const parsed = matter(markdown);
  const sections = parseSections(parsed.content);
  return TwinDocumentSchema.parse({
    updated: String(parsed.data.updated ?? new Date().toISOString()),
    species: normalizeSpecies(parsed.data.species),
    owner: String(parsed.data.owner ?? "owner"),
    sections
  });
}

export function updateTwinSections(
  document: TwinDocument,
  updates: Partial<Record<TwinSectionName, TwinSection>>
): TwinDocument {
  return TwinDocumentSchema.parse({
    ...document,
    updated: new Date().toISOString(),
    sections: TWIN_SECTIONS.reduce<Record<TwinSectionName, TwinSection>>(
      (acc, section) => {
        acc[section] = {
          ...document.sections[section],
          ...(updates[section] ?? {})
        };
        return acc;
      },
      {} as Record<TwinSectionName, TwinSection>
    )
  });
}

export function createTwinDocumentFromSections(
  config: Pick<TwinConfig, "species" | "owner">,
  sections: Record<TwinSectionName, TwinSection>
): TwinDocument {
  return TwinDocumentSchema.parse({
    updated: new Date().toISOString(),
    species: config.species,
    owner: config.owner,
    sections
  });
}

function normalizeSpecies(input: unknown): TwinSpecies {
  return (["axolotl", "cat", "slime"].includes(String(input))
    ? input
    : "axolotl") as TwinSpecies;
}

function parseSections(content: string): Record<TwinSectionName, TwinSection> {
  const result = TWIN_SECTIONS.reduce<Record<TwinSectionName, TwinSection>>(
    (acc, section) => {
      acc[section] = {};
      return acc;
    },
    {} as Record<TwinSectionName, TwinSection>
  );

  let currentSection: TwinSectionName | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      const nextSection = heading[1]?.trim();
      currentSection = SECTION_SET.has(nextSection)
        ? (nextSection as TwinSectionName)
        : null;
      continue;
    }

    if (!currentSection || !line.startsWith("- ")) {
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(2, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[currentSection][key] = parseTwinScalar(value);
  }

  return result;
}

function formatTwinScalar(value: TwinScalar): string {
  if (Array.isArray(value)) {
    return `[${value.join(", ")}]`;
  }

  if (typeof value === "string") {
    return /[:\[\]"]/u.test(value) || value.includes(",")
      ? JSON.stringify(value)
      : value;
  }

  if (value === null) {
    return "null";
  }

  return String(value);
}

function parseTwinScalar(raw: string): TwinScalar {
  if (raw === "null") {
    return null;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/u.test(raw)) {
    return Number(raw);
  }

  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map(stripQuotes);
  }

  return stripQuotes(raw);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
