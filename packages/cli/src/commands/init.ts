import { select } from "@inquirer/prompts";
import {
  createDefaultConfig,
  ensureSeedTwin,
  interpretTwinDocument,
  readTwinConfigOrDefault,
  registerClaudeDesktopMcp,
  type TwinConfig,
  writePetState,
  writeTwinConfig
} from "@twin-md/core";
import { resolveMcpEntrypoint } from "../support.js";

type InitOptions = {
  species?: string;
  owner?: string;
  obsidianVault?: string;
  healthPath?: string;
  calendarPath?: string;
  locationPath?: string;
};

export async function runInitCommand(options: InitOptions): Promise<void> {
  const current = await readTwinConfigOrDefault();
  const species =
    options.species ??
    (process.stdout.isTTY
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

  const config = createDefaultConfig({
    ...current,
    species: species as TwinConfig["species"],
    owner: options.owner ?? current.owner,
    obsidianVaultPath: options.obsidianVault ?? current.obsidianVaultPath,
    healthPath: options.healthPath ?? current.healthPath,
    calendarPath: options.calendarPath ?? current.calendarPath,
    locationPath: options.locationPath ?? current.locationPath
  });

  const seed = await ensureSeedTwin(config);
  const state = await interpretTwinDocument(seed, config);
  await writePetState(state);

  const registration = await registerClaudeDesktopMcp(resolveMcpEntrypoint(), config);
  await writeTwinConfig({
    ...config,
    mcpCommandId: registration.commandId
  });

  console.log(`Initialized twin for ${config.owner}.`);
  console.log(`Species: ${config.species}`);
  console.log(`Claude config: ${registration.configPath}`);
  console.log(`MCP command id: ${registration.commandId}`);
}
