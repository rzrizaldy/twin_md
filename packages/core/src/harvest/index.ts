import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TwinConfig } from "../config.js";
import {
  interpretTwinDocument,
  parsePetState,
  type PetState,
  writePetState
} from "../interpret.js";
import {
  ensureTwinRuntimeDirs,
  getTwinHistoryDir,
  getTwinMdPath,
  getTwinStatePath,
  snapshotFileName
} from "../paths.js";
import {
  createSeedTwinDocument,
  createTwinDocumentFromSections,
  parseTwinMarkdown,
  serializeTwinDocument,
  type TwinDocument
} from "../schema.js";
import { harvestCalendarSignals } from "./calendar.js";
import { harvestClaudeSignals } from "./claude.js";
import { harvestHealthSignals } from "./health.js";
import { harvestLocationSignals } from "./location.js";
import { harvestObsidianSignals } from "./obsidian.js";

export type HarvestResult = {
  document: TwinDocument;
  state: PetState;
  twinMdPath: string;
  statePath: string;
  snapshotPath: string;
};

export async function runTwinHarvest(config: TwinConfig): Promise<HarvestResult> {
  await ensureTwinRuntimeDirs();

  const sections = {
    health: await harvestHealthSignals(config),
    calendar: await harvestCalendarSignals(config),
    location: await harvestLocationSignals(config),
    claude_memory_signals: await harvestClaudeSignals(config),
    obsidian_signals: await harvestObsidianSignals(config),
    now: {
      mood_self_report: null,
      context: "Harvested from local life signals."
    }
  };

  const document = createTwinDocumentFromSections(config, sections);
  const markdown = serializeTwinDocument(document);
  const twinMdPath = getTwinMdPath();
  const snapshotPath = path.join(getTwinHistoryDir(), snapshotFileName());

  await writeFile(twinMdPath, markdown, "utf8");
  await writeFile(snapshotPath, markdown, "utf8");

  const state = await interpretTwinDocument(document, config);
  await writePetState(state);

  return {
    document,
    state,
    twinMdPath,
    statePath: getTwinStatePath(),
    snapshotPath
  };
}

export async function ensureSeedTwin(config: TwinConfig): Promise<TwinDocument> {
  await ensureTwinRuntimeDirs();
  const target = getTwinMdPath();

  try {
    const current = await readFile(target, "utf8");
    return parseTwinMarkdown(current);
  } catch {
    const seeded = createSeedTwinDocument(config);
    await writeFile(target, serializeTwinDocument(seeded), "utf8");
    return seeded;
  }
}

export async function readCurrentTwinDocument(
  config: TwinConfig
): Promise<TwinDocument> {
  try {
    const content = await readFile(getTwinMdPath(), "utf8");
    return parseTwinMarkdown(content);
  } catch {
    return ensureSeedTwin(config);
  }
}

export async function readCurrentTwinState(): Promise<PetState | null> {
  try {
    const raw = await readFile(getTwinStatePath(), "utf8");
    return parsePetState(JSON.parse(raw));
  } catch {
    return null;
  }
}
