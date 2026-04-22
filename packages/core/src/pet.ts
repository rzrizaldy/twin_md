import type { TwinSpecies } from "./config.js";

// The 8 animation frames shipped per (species, state). Previously these were
// procedurally-generated SVG strings inlined into the bundle via
// `generated/pet-svg.ts`. Web + desktop now fetch the colourful PNGs from
// disk via `/pets/[species]/[state]/[frame].png`, so the SVG inlining is
// gone — we only keep the name union for callers that still want to pick
// a frame by name.
export const PET_SVG_FRAME_NAMES = [
  "breath-a",
  "breath-b",
  "blink",
  "reminder-speak",
  "reaction-happy",
  "reaction-wilt",
  "turn-3q",
  "turn-front"
] as const;
export type PetSvgFrameName = (typeof PET_SVG_FRAME_NAMES)[number];

export const TWIN_STATES = [
  "healthy",
  "sleep_deprived",
  "stressed",
  "neglected"
] as const;
export type TwinState = (typeof TWIN_STATES)[number];

export const TWIN_ENVIRONMENTS = [
  "sunny_island",
  "stars_at_noon",
  "storm_room",
  "grey_nook"
] as const;
export type TwinEnvironment = (typeof TWIN_ENVIRONMENTS)[number];

// Used by desktop + web to pick a scene backdrop for the current pet state.
// The map is intentionally 1:1 — each state gets one canonical environment.
export function getSceneForState(state: TwinState): TwinEnvironment {
  switch (state) {
    case "healthy":
      return "sunny_island";
    case "sleep_deprived":
      return "stars_at_noon";
    case "stressed":
      return "storm_room";
    case "neglected":
      return "grey_nook";
    default:
      return "sunny_island";
  }
}

export const TWIN_ANIMATIONS = [
  "dancing",
  "yawning",
  "pacing",
  "sitting"
] as const;
export type TwinAnimation = (typeof TWIN_ANIMATIONS)[number];

const STATE_EMOTES: Record<TwinState, string[]> = {
  healthy: ["^ ^", "o o"],
  sleep_deprived: ["- -", "u u"],
  stressed: ["> <", "x x"],
  neglected: [". .", ". ."]
};

export function renderAsciiPet(
  species: TwinSpecies,
  state: TwinState,
  frame = 0
): string {
  const eyes = STATE_EMOTES[state][frame % STATE_EMOTES[state].length];
  const mouth =
    state === "healthy"
      ? " v "
      : state === "sleep_deprived"
        ? " _ "
        : state === "stressed"
          ? " ~ "
          : " . ";

  const body =
    species === "axolotl"
      ? [
          state === "healthy" ? " \\ | / /" : "  \\ | /  ",
          ` / ${eyes} \\ `,
          `|   ${mouth} |`,
          state === "sleep_deprived" ? " \\_zzz_/" : " \\_____/",
          state === "healthy" ? " _/   \\_ " : "  /   \\ "
        ]
      : species === "cat"
        ? [
            " /\\_/\\\\ ",
            `( ${eyes} )`,
            `(  ${mouth} )`,
            state === "neglected" ? " /  .  \\" : " /     \\",
            "(_/ \\_)"
          ]
        : [
            state === "healthy" ? "  _*_ _ " : "  _____ ",
            ` / ${eyes} \\`,
            `|  ${mouth}  |`,
            state === "stressed" ? " /_____\\ " : " \\_____/ ",
            state === "sleep_deprived" ? "   zzz   " : "   ~~~   "
          ];

  return body.join("\n");
}

export function getStateColor(state: TwinState): string {
  switch (state) {
    case "healthy":
      return "green";
    case "sleep_deprived":
      return "yellow";
    case "stressed":
      return "red";
    default:
      return "gray";
  }
}
