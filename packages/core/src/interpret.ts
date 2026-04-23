import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { TwinConfig } from "./config.js";
import { ensureParentDir, getTwinStatePath } from "./paths.js";
import {
  getStateColor,
  renderAsciiPet,
  type TwinAnimation,
  type TwinEnvironment,
  type TwinState
} from "./pet.js";
import { serializeTwinDocument, type TwinDocument } from "./schema.js";

export type PetState = {
  species: TwinDocument["species"];
  state: TwinState;
  energy: number;
  stress: number;
  glow: number;
  environment: TwinEnvironment;
  animation: TwinAnimation;
  caption: string;
  scene: string;
  message: string;
  reason: string[];
  updated: string;
  sourceUpdated: string;
  ascii: string;
  svg: string;
  color: string;
};

const PetStateSchema = z.object({
  species: z.enum(["axolotl", "cat", "slime"]),
  state: z.enum(["healthy", "sleep_deprived", "stressed", "neglected"]),
  energy: z.number().min(0).max(100),
  stress: z.number().min(0).max(100),
  glow: z.number().min(0).max(100),
  environment: z.enum(["sunny_island", "stars_at_noon", "storm_room", "grey_nook"]),
  animation: z.enum(["dancing", "yawning", "pacing", "sitting"]),
  caption: z.string().min(1),
  scene: z.string().min(1),
  message: z.string().min(1),
  reason: z.array(z.string()).min(1),
  updated: z.string(),
  sourceUpdated: z.string(),
  ascii: z.string(),
  svg: z.string(),
  color: z.string()
});

export function parsePetState(input: unknown): PetState {
  return PetStateSchema.parse(input);
}

const SCENE_META: Record<
  TwinState,
  {
    environment: TwinEnvironment;
    animation: TwinAnimation;
    caption: string;
  }
> = {
  healthy: {
    environment: "sunny_island",
    animation: "dancing",
    caption: "Bloom Mode"
  },
  sleep_deprived: {
    environment: "stars_at_noon",
    animation: "yawning",
    caption: "Low Charge"
  },
  stressed: {
    environment: "storm_room",
    animation: "pacing",
    caption: "Paper Storm"
  },
  neglected: {
    environment: "grey_nook",
    animation: "sitting",
    caption: "Quiet Corner"
  }
};

export async function interpretTwinDocument(
  document: TwinDocument,
  config: TwinConfig
): Promise<PetState> {
  const heuristic = buildHeuristicState(document);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return heuristic;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 650,
      system: [
        "Interpret the twin.md document into a narrative pet scene state.",
        "Return valid JSON only.",
        "state must be one of healthy, sleep_deprived, stressed, neglected.",
        "environment must be one of sunny_island, stars_at_noon, storm_room, grey_nook.",
        "animation must be one of dancing, yawning, pacing, sitting.",
        "energy, stress, and glow are integers 0-100.",
        "caption should be a short title-case label, 2 to 4 words.",
        "scene should describe the environment in one sentence.",
        "message should sound like a warm, slightly guilt-tripping mirror pet.",
        "reason should be 2 to 4 short narrative phrases and should not contain raw numbers."
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Twin document:\n${serializeTwinDocument(document)}`,
                `Heuristic baseline:\n${JSON.stringify(heuristic, null, 2)}`,
                "Respond with JSON for keys: state, energy, stress, glow, environment, animation, caption, scene, message, reason."
              ].join("\n\n")
            }
          ]
        }
      ]
    });

    const text = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    const parsed = extractJson(text);
    if (!parsed) {
      return heuristic;
    }

    const ai = z
      .object({
        state: z.enum(["healthy", "sleep_deprived", "stressed", "neglected"]),
        energy: z.number(),
        stress: z.number(),
        glow: z.number(),
        environment: z.enum(["sunny_island", "stars_at_noon", "storm_room", "grey_nook"]),
        animation: z.enum(["dancing", "yawning", "pacing", "sitting"]),
        caption: z.string(),
        scene: z.string(),
        message: z.string(),
        reason: z.array(z.string()).optional()
      })
      .parse(parsed);

    return finalizePetState(document, {
      state: ai.state,
      energy: clamp(Math.round(ai.energy)),
      stress: clamp(Math.round(ai.stress)),
      glow: clamp(Math.round(ai.glow)),
      environment: ai.environment,
      animation: ai.animation,
      caption: ai.caption.trim() || heuristic.caption,
      scene: ai.scene.trim() || heuristic.scene,
      message: ai.message.trim() || heuristic.message,
      reason: normalizeReasonList(ai.reason, heuristic.reason)
    });
  } catch {
    return heuristic;
  }
}

export async function writePetState(state: PetState): Promise<void> {
  const target = getTwinStatePath();
  await ensureParentDir(target);
  await writeFile(target, JSON.stringify(parsePetState(state), null, 2) + "\n");
}

function buildHeuristicState(document: TwinDocument): PetState {
  const health = document.sections.health;
  const calendar = document.sections.calendar;
  const location = document.sections.location;
  const claude = document.sections.claude_memory_signals;
  const obsidian = document.sections.obsidian_signals;
  const nowSection = document.sections.now;

  const sleepHours = durationToHours(health.sleep_last_night);
  const steps = numberValue(health.steps_today);
  const workouts = numberValue(health.workouts_7d);
  const density = numberValue(calendar.density_score);
  const todos = numberValue(obsidian.unfinished_todos);
  const streak = numberValue(obsidian.daily_note_streak);
  const tone = String(claude.tone_7d ?? "").toLowerCase();
  const wins = String(claude.wins ?? "");
  const frictions = String(claude.frictions ?? "");
  const contextSwitches = numberValue(claude.context_switches_24h);
  const context = String(nowSection.context ?? "");
  const novelty = String(location.novelty_score ?? "").toLowerCase();

  const energy = clamp(
    Math.round(sleepHours * 12 + Math.min(steps / 190, 16) + workouts * 8 + 16)
  );
  const stress = clamp(
    Math.round(
      density * 58 +
        todos * 2 +
        (tone.includes("anxious") ? 18 : 0) +
        (frictions.includes("deadline") ? 10 : 0) +
        Math.min(contextSwitches * 2, 14)
    )
  );
  const glow = clamp(
    Math.round(
      34 +
        streak * 4 +
        Math.min(steps / 300, 18) +
        workouts * 8 +
        (wins && !/none|untracked/i.test(wins) ? 12 : 0) +
        (novelty === "high" ? 8 : 0) -
        stress / 3
    )
  );

  const sleepDebtScore = clamp(
    Math.round(
      Math.max(0, 7 - sleepHours) * 18 +
        (sleepHours < 6 ? 16 : 0) +
        (energy < 42 ? 10 : 0)
    )
  );
  const stressLoadScore = clamp(
    Math.round(
      density * 80 +
        todos * 2 +
        (tone.includes("anxious") ? 16 : 0) +
        (context.toLowerCase().includes("deadline") ? 8 : 0) +
        Math.min(contextSwitches * 3, 18)
    )
  );
  const neglectScore = clamp(
    Math.round(
      (steps < 2000 ? 24 : steps < 4200 ? 10 : 0) +
        (workouts === 0 ? 14 : 0) +
        (streak === 0 ? 18 : streak <= 2 ? 8 : 0) +
        (glow < 36 ? 16 : 0) +
        (!wins || /none|untracked/i.test(wins) ? 10 : 0)
    )
  );
  const healthyScore = clamp(
    Math.round(
      energy +
        glow +
        workouts * 8 +
        Math.min(steps / 160, 16) +
        (streak >= 3 ? 10 : 0) -
        stress / 2
    )
  );

  const state = chooseState({
    healthy: healthyScore,
    sleep_deprived: sleepDebtScore,
    stressed: stressLoadScore,
    neglected: neglectScore
  });

  const meta = SCENE_META[state];
  const scene = buildSceneLine(state, context);
  const reason = buildReasonLines({
    state,
    sleepHours,
    density,
    steps,
    workouts,
    streak,
    tone,
    wins,
    frictions
  });
  const message = buildPetMessage(state, context);

  return finalizePetState(document, {
    state,
    energy,
    stress,
    glow,
    environment: meta.environment,
    animation: meta.animation,
    caption: meta.caption,
    scene,
    message,
    reason
  });
}

function chooseState(scores: Record<TwinState, number>): TwinState {
  if (scores.stressed >= 62) {
    return "stressed";
  }

  if (scores.sleep_deprived >= 52 && scores.stressed < scores.sleep_deprived + 10) {
    return "sleep_deprived";
  }

  if (scores.neglected >= 56 && scores.healthy < 72) {
    return "neglected";
  }

  if (
    scores.healthy >= 72 &&
    scores.sleep_deprived < 40 &&
    scores.stressed < 58 &&
    scores.neglected < 52
  ) {
    return "healthy";
  }

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as TwinState;
}

function buildSceneLine(state: TwinState, context: string): string {
  switch (state) {
    case "healthy":
      return `Sunlight is on the island, the flowers are up, and the whole place feels ready to play.${context ? ` ${context}` : ""}`;
    case "sleep_deprived":
      return `The sky never quite finished waking up, and a few stars are still hanging around at noon.${context ? ` ${context}` : ""}`;
    case "stressed":
      return `Storm clouds have pushed into the room and the floor is starting to fill with scattered paper and half-finished intent.${context ? ` ${context}` : ""}`;
    default:
      return `The corner has gone gray and quiet, with wilted plants waiting for somebody to come back to them.${context ? ` ${context}` : ""}`;
  }
}

function buildPetMessage(state: TwinState, context: string): string {
  switch (state) {
    case "healthy":
      return `I am feeling bright and a little showy. ${context || "Keep feeding the good rhythm and I will keep dancing."}`;
    case "sleep_deprived":
      return `I am trying to be brave, but my eyelids are losing the argument. ${context || "Tonight needs less heroics and more sleep."}`;
    case "stressed":
      return `I am pacing because everything in the room feels urgent at once. ${context || "Pick one paper off the floor and finish it before touching the next."}`;
    default:
      return `I am still here, but the room knows when you have stopped checking in. ${context || "Come back to me with one small act of care and the color will start returning."}`;
  }
}

function buildReasonLines(input: {
  state: TwinState;
  sleepHours: number;
  density: number;
  steps: number;
  workouts: number;
  streak: number;
  tone: string;
  wins: string;
  frictions: string;
}): string[] {
  const hints: string[] = [];

  if (input.state === "healthy") {
    hints.push("The island is getting enough movement to feel alive.");
    if (input.workouts > 0) {
      hints.push("Your body left a little extra sunlight lying around.");
    }
    if (input.wins && !/none|untracked/i.test(input.wins)) {
      hints.push("A recent win is still warming the room.");
    }
  }

  if (input.sleepHours > 0 && input.sleepHours < 6.2) {
    hints.push("Sleep debt is pulling the eyes half closed.");
  }

  if (input.density >= 0.55) {
    hints.push("The calendar is crowding the walls.");
  }

  if (input.tone.includes("anxious") || /stress|deadline|blocked/i.test(input.frictions)) {
    hints.push("Your recent notes sound braced for impact.");
  }

  if (input.steps < 2400) {
    hints.push("The ground has barely felt your footsteps.");
  }

  if (input.workouts === 0) {
    hints.push("Nothing shook the dust off the day.");
  }

  if (input.streak <= 1) {
    hints.push("The journal corner has gone unusually quiet.");
  }

  if (!input.wins || /none|untracked/i.test(input.wins)) {
    hints.push("There has not been much fresh warmth for the pet to hold onto.");
  }

  if (input.state === "stressed") {
    hints.push("Every loose task turns into another sheet on the floor.");
  }

  if (input.state === "neglected") {
    hints.push("The plants are reading distance as neglect.");
  }

  if (input.state === "sleep_deprived") {
    hints.push("Even daylight is wearing a bedtime expression.");
  }

  return unique(hints).slice(0, 3);
}

function finalizePetState(
  document: TwinDocument,
  partial: Omit<
    PetState,
    "species" | "updated" | "sourceUpdated" | "ascii" | "svg" | "color"
  >
): PetState {
  return PetStateSchema.parse({
    ...partial,
    species: document.species,
    updated: new Date().toISOString(),
    sourceUpdated: document.updated,
    ascii: renderAsciiPet(document.species, partial.state),
    // Frontends now fetch sprites by URL from /pets/[species]/[state]/[frame].png.
    // Kept as an empty string so the zod contract + Rust PetState still parse.
    svg: "",
    color: getStateColor(partial.state)
  });
}

function normalizeReasonList(
  next: string[] | undefined,
  fallback: string[]
): string[] {
  if (!next?.length) {
    return fallback;
  }

  return unique(
    next
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.replace(/\b\d+(\.\d+)?\b/g, "").replace(/\s+/g, " ").trim())
  ).filter(Boolean).slice(0, 4);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function durationToHours(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }

  const hours = text.match(/(\d+(?:\.\d+)?)\s*h/u);
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*m/u);
  if (hours || minutes) {
    return Number(hours?.[1] ?? 0) + Number(minutes?.[1] ?? 0) / 60;
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  const numeric = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]+\}/u);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
