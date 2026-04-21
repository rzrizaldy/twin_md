import type { TwinSpecies } from "./config.js";

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

type PetPalette = {
  body: string;
  accent: string;
  blush: string;
  glow: string;
  outline: string;
};

const PALETTES: Record<TwinSpecies, PetPalette> = {
  axolotl: {
    body: "#ffd6e5",
    accent: "#ff92b2",
    blush: "#ff6f91",
    glow: "#ffe8f0",
    outline: "#473643"
  },
  cat: {
    body: "#ffe4b8",
    accent: "#f6b15d",
    blush: "#ff926b",
    glow: "#fff0d8",
    outline: "#4b3a2a"
  },
  slime: {
    body: "#c4f2cb",
    accent: "#58cc7c",
    blush: "#3fa862",
    glow: "#e7ffe8",
    outline: "#30543d"
  }
};

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

export function renderSvgPet(species: TwinSpecies, state: TwinState): string {
  const palette = PALETTES[species];
  const face =
    state === "healthy"
      ? {
          leftEye: `<circle cx="100" cy="120" r="7" fill="${palette.outline}" />`,
          rightEye: `<circle cx="156" cy="120" r="7" fill="${palette.outline}" />`,
          mouth: "M 110 148 Q 128 168 146 148"
        }
      : state === "sleep_deprived"
        ? {
            leftEye: `<path d="M 90 120 h 18" stroke="${palette.outline}" stroke-width="6" stroke-linecap="round" />`,
            rightEye: `<path d="M 146 120 h 18" stroke="${palette.outline}" stroke-width="6" stroke-linecap="round" />`,
            mouth: "M 110 146 Q 128 156 146 146"
          }
        : state === "stressed"
          ? {
              leftEye: `<path d="M93 112 l16 16 M109 112 l-16 16" stroke="${palette.outline}" stroke-width="5" stroke-linecap="round" />`,
              rightEye: `<path d="M147 112 l16 16 M163 112 l-16 16" stroke="${palette.outline}" stroke-width="5" stroke-linecap="round" />`,
              mouth: "M 108 150 Q 118 142 128 150 Q 138 158 148 150"
            }
          : {
              leftEye: `<circle cx="100" cy="120" r="5" fill="${palette.outline}" opacity="0.72" />`,
              rightEye: `<circle cx="156" cy="120" r="5" fill="${palette.outline}" opacity="0.72" />`,
              mouth: "M 112 150 Q 128 154 144 150"
            };

  const speciesExtra =
    species === "axolotl"
      ? `<path d="M60 110 l-22 -12 M60 125 l-22 0 M196 110 l22 -12 M196 125 l22 0" stroke="${palette.accent}" stroke-width="8" stroke-linecap="round" />`
      : species === "cat"
        ? `<path d="M72 70 l20 -28 l16 28 M164 70 l-20 -28 l-16 28" fill="${palette.accent}" />`
        : `<path d="M72 160 Q 128 205 184 160" stroke="${palette.accent}" stroke-width="10" stroke-linecap="round" />`;

  const stateExtra =
    state === "healthy"
      ? `<path d="M62 74 l10 -16 M72 58 l10 16 M176 54 l7 -10 M183 44 l7 10" stroke="#f3b53f" stroke-width="4" stroke-linecap="round" />`
      : state === "sleep_deprived"
        ? `<path d="M174 64 q10 -10 18 0 q-6 1 -9 8 q-3 -7 -9 -8" fill="#ffffff" opacity="0.9" /><circle cx="70" cy="68" r="5" fill="#fff8d2" /><circle cx="88" cy="52" r="4" fill="#fff8d2" />`
        : state === "stressed"
          ? `<path d="M181 83 l10 -18 l8 13 l8 -14" stroke="#6b7ba5" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none" /><path d="M74 82 q6 -18 16 0" stroke="#6b7ba5" stroke-width="4" stroke-linecap="round" fill="none" />`
          : `<path d="M63 176 q15 -18 29 -2" stroke="#8a8f73" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.8" />`;

  const bodyOpacity = state === "neglected" ? "0.82" : "1";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="${species} ${state} twin pet">`,
    `<rect width="256" height="256" rx="64" fill="${palette.glow}" />`,
    `<circle cx="128" cy="132" r="72" fill="${palette.body}" opacity="${bodyOpacity}" />`,
    speciesExtra,
    stateExtra,
    face.leftEye,
    face.rightEye,
    `<path d="${face.mouth}" stroke="${palette.outline}" stroke-width="6" stroke-linecap="round" fill="none" />`,
    `<circle cx="84" cy="146" r="10" fill="${palette.blush}" opacity="${state === "neglected" ? "0.2" : "0.45"}" />`,
    `<circle cx="172" cy="146" r="10" fill="${palette.blush}" opacity="${state === "neglected" ? "0.2" : "0.45"}" />`,
    state === "stressed"
      ? `<path d="M190 104 q14 14 2 28" stroke="#7aa3ff" stroke-width="5" stroke-linecap="round" fill="none" />`
      : "",
    "</svg>"
  ].join("");
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
