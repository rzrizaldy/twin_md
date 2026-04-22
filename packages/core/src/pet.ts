import type { TwinSpecies } from "./config.js";
import { getPetSvgFrame, type PetSvgFrameName } from "./generated/pet-svg.js";

export { getPetSvgFrame, type PetSvgFrameName } from "./generated/pet-svg.js";

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

export function renderSvgPet(
  species: TwinSpecies,
  state: TwinState,
  frame: PetSvgFrameName = "breath-a"
): string {
  return getPetSvgFrame(species, state, frame);
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
