import { input, password, select } from "@inquirer/prompts";
import {
  AI_DEFAULT_MODEL,
  AI_MODELS,
  AI_PROVIDERS,
  createDefaultConfig,
  ensureSeedTwin,
  interpretTwinDocument,
  readTwinConfigOrDefault,
  registerClaudeDesktopMcp,
  runTwinHarvest,
  type AiProvider,
  type TwinConfig,
  writePetState,
  writeTwinConfig
} from "@twin-md/core/server";
import { resolveMcpEntrypoint } from "../support.js";

type InitOptions = {
  species?: string;
  owner?: string;
  obsidianVault?: string;
  healthPath?: string;
  calendarPath?: string;
  locationPath?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
};

export async function runInitCommand(options: InitOptions): Promise<void> {
  const current = await readTwinConfigOrDefault();
  const interactive = process.stdout.isTTY;

  const species =
    options.species ??
    (interactive
      ? await select({
          message: "Pick your species",
          choices: [
            { name: "axolotl", value: "axolotl" },
            { name: "cat", value: "cat" },
            { name: "slime", value: "slime" }
          ],
          default: current.species
        })
      : current.species);

  const provider: AiProvider = (options.provider as AiProvider | undefined) ??
    (interactive
      ? await select({
          message: "AI provider",
          choices: AI_PROVIDERS.map((p) => ({ name: p, value: p })),
          default: current.aiProvider ?? "anthropic"
        })
      : (current.aiProvider ?? "anthropic"));

  const modelChoices = AI_MODELS[provider];
  const model = options.model ??
    (interactive
      ? await select({
          message: `Model (${provider})`,
          choices: modelChoices.map((m) => ({ name: m, value: m })),
          default:
            current.aiProvider === provider
              ? current.aiModel
              : AI_DEFAULT_MODEL[provider]
        })
      : AI_DEFAULT_MODEL[provider]);

  const apiKey =
    options.apiKey ??
    (interactive
      ? await password({
          message: `API key for ${provider} (leave blank to skip)`,
          mask: "·"
        })
      : "");

  const ownerValue =
    options.owner ??
    (interactive
      ? await input({ message: "Your name", default: current.owner })
      : current.owner);

  const config = createDefaultConfig({
    ...current,
    species: species as TwinConfig["species"],
    owner: ownerValue,
    obsidianVaultPath: options.obsidianVault ?? current.obsidianVaultPath,
    healthPath: options.healthPath ?? current.healthPath,
    calendarPath: options.calendarPath ?? current.calendarPath,
    locationPath: options.locationPath ?? current.locationPath,
    aiProvider: provider,
    aiModel: model,
    aiKeyStorage: apiKey.trim() ? "config" : "env"
  });

  const registration = await registerClaudeDesktopMcp(resolveMcpEntrypoint(), config);
  const savedConfig: TwinConfig = {
    ...config,
    mcpCommandId: registration.commandId
  };
  await writeTwinConfig(savedConfig);

  try {
    const harvest = await runTwinHarvest(savedConfig);
    console.log(`Initial harvest → ${harvest.twinMdPath}`);
  } catch (error) {
    console.warn(
      "Initial harvest failed; run `twin-md harvest` after fixing paths.",
      error instanceof Error ? error.message : error
    );
    const seed = await ensureSeedTwin(savedConfig);
    const state = await interpretTwinDocument(seed, savedConfig);
    await writePetState(state);
  }

  if (apiKey.trim()) {
    await saveCliKey(provider, model, apiKey.trim());
  }

  console.log(`Initialized twin for ${savedConfig.owner}.`);
  console.log(`Species: ${savedConfig.species}`);
  console.log(`Provider: ${provider} (${model})`);
  console.log(`Claude config: ${registration.configPath}`);
  console.log(`MCP command id: ${registration.commandId}`);
}

async function saveCliKey(
  provider: AiProvider,
  model: string,
  apiKey: string
): Promise<void> {
  const { writeFile, mkdir, chmod } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { getClaudeDir } = await import("@twin-md/core/server");

  const path = `${getClaudeDir()}/twin-ai.json`;
  await mkdir(dirname(path), { recursive: true });
  const payload = {
    provider,
    model,
    storage: "config",
    api_key: apiKey
  };
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  try {
    await chmod(path, 0o600);
  } catch {
    /* best-effort */
  }
}
