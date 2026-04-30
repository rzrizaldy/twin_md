import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_SOURCE_DIR,
  ensureParentDir,
  ensureTwinRuntimeDirs,
  expandHome,
  getClaudeDesktopConfigPath,
  getClaudeDir,
  getTwinConfigPath
} from "./paths.js";

export const TWIN_SPECIES = ["axolotl", "cat", "slime"] as const;
export type TwinSpecies = (typeof TWIN_SPECIES)[number];

export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_KEY_STORAGE = ["env", "keychain", "config"] as const;
export type AiKeyStorage = (typeof AI_KEY_STORAGE)[number];

export const AI_MODELS: Record<AiProvider, readonly string[]> = {
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"]
} as const;

export const AI_DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5-mini",
  gemini: "gemini-2.5-flash"
};

export const TwinConfigSchema = z.object({
  version: z.literal(1),
  owner: z.string().min(1),
  species: z.enum(TWIN_SPECIES),
  claudeDir: z.string().min(1),
  healthPath: z.string().min(1),
  calendarPath: z.string().min(1),
  locationPath: z.string().min(1),
  obsidianVaultPath: z.string().nullable(),
  quickNotesPath: z.string().min(1).default("inbox"),
  anthropicModel: z.string().min(1),
  aiProvider: z.enum(AI_PROVIDERS).default("anthropic"),
  aiModel: z.string().min(1).default("claude-sonnet-4-6"),
  aiKeyStorage: z.enum(AI_KEY_STORAGE).default("env"),
  mcpCommandId: z.string().min(1).optional(),
  /** Absolute path to the brain vault (git repo). Defaults to ~/twin-brain. */
  brainPath: z.string().min(1).optional()
});

export type TwinConfig = z.infer<typeof TwinConfigSchema>;

export const DEFAULT_ANTHROPIC_MODEL =
  process.env.TWIN_ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

export function createDefaultConfig(
  overrides: Partial<TwinConfig> = {}
): TwinConfig {
  return TwinConfigSchema.parse({
    version: 1,
    owner: process.env.USER ?? "owner",
    species: "axolotl",
    claudeDir: getClaudeDir(),
    healthPath: expandHome(`${DEFAULT_SOURCE_DIR}/health.json`),
    calendarPath: expandHome(`${DEFAULT_SOURCE_DIR}/calendar.ics`),
    locationPath: expandHome(`${DEFAULT_SOURCE_DIR}/location.json`),
    obsidianVaultPath: null,
    quickNotesPath: "inbox",
    anthropicModel: DEFAULT_ANTHROPIC_MODEL,
    aiProvider: "anthropic",
    aiModel: DEFAULT_ANTHROPIC_MODEL,
    aiKeyStorage: "env",
    brainPath: path.join(os.homedir(), "twin-brain"),
    ...overrides
  });
}

export async function readTwinConfig(): Promise<TwinConfig> {
  const raw = await readFile(getTwinConfigPath(), "utf8");
  return TwinConfigSchema.parse(JSON.parse(raw));
}

export async function readTwinConfigOrDefault(): Promise<TwinConfig> {
  try {
    return await readTwinConfig();
  } catch {
    return createDefaultConfig();
  }
}

export async function writeTwinConfig(config: TwinConfig): Promise<void> {
  await ensureTwinRuntimeDirs();
  await ensureParentDir(getTwinConfigPath());
  await writeFile(
    getTwinConfigPath(),
    JSON.stringify(TwinConfigSchema.parse(config), null, 2) + "\n",
    "utf8"
  );
}

export async function registerClaudeDesktopMcp(
  mcpEntrypoint: string,
  config: TwinConfig
): Promise<{ configPath: string; commandId: string }> {
  const configPath = getClaudeDesktopConfigPath();
  const commandId = config.mcpCommandId ?? `twin-${randomUUID().slice(0, 8)}`;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    parsed = {};
  }

  const next = {
    ...parsed,
    mcpServers: {
      ...(((parsed.mcpServers as Record<string, unknown> | undefined) ?? {}) as Record<
        string,
        unknown
      >),
      [commandId]: {
        command: "node",
        args: [mcpEntrypoint],
        env: {
          TWIN_CLAUDE_DIR: config.claudeDir
        }
      }
    }
  };

  await ensureParentDir(configPath);
  await writeFile(configPath, JSON.stringify(next, null, 2) + "\n", "utf8");

  return { configPath, commandId };
}
