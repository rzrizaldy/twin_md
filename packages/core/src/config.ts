import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

export const TwinConfigSchema = z.object({
  version: z.literal(1),
  owner: z.string().min(1),
  species: z.enum(TWIN_SPECIES),
  claudeDir: z.string().min(1),
  healthPath: z.string().min(1),
  calendarPath: z.string().min(1),
  locationPath: z.string().min(1),
  obsidianVaultPath: z.string().nullable(),
  anthropicModel: z.string().min(1),
  mcpCommandId: z.string().min(1).optional()
});

export type TwinConfig = z.infer<typeof TwinConfigSchema>;

export const DEFAULT_ANTHROPIC_MODEL =
  process.env.TWIN_ANTHROPIC_MODEL ?? "claude-opus-4-20250514";

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
    anthropicModel: DEFAULT_ANTHROPIC_MODEL,
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
