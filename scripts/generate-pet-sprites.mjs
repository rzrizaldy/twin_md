import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const assetsRoot = path.join(repoRoot, "packages/core/assets");
const petsRoot = path.join(assetsRoot, "pets");
const generatedRoot = path.join(repoRoot, "packages/core/src/generated");

const SPECIES = {
  axolotl: {
    body: "#ffd6e5",
    accent: "#ff92b2",
    blush: "#ff6f91",
    glow: "#ffe8f0",
    outline: "#473643",
    shadow: "#c78ba0"
  },
  cat: {
    body: "#ffe4b8",
    accent: "#f6b15d",
    blush: "#ff926b",
    glow: "#fff0d8",
    outline: "#4b3a2a",
    shadow: "#c79a5e"
  },
  slime: {
    body: "#c4f2cb",
    accent: "#58cc7c",
    blush: "#3fa862",
    glow: "#e7ffe8",
    outline: "#30543d",
    shadow: "#5d8f6d"
  }
};

const STATES = {
  healthy: {
    fg: "#4b3a2a",
    bg: "#fff8d2",
    accent: "#f3c95c",
    bubble: "#fff8d2"
  },
  sleep_deprived: {
    fg: "#3a3a66",
    bg: "#d5d8ff",
    accent: "#b9c1ff",
    bubble: "#d5d8ff"
  },
  stressed: {
    fg: "#a34a1f",
    bg: "#ffe1d4",
    accent: "#89a4d5",
    bubble: "#ffe1d4"
  },
  neglected: {
    fg: "#544e3c",
    bg: "#e6e2d4",
    accent: "#8e9b6e",
    bubble: "#e6e2d4"
  }
};

const BUBBLES = {
  soft: "#fff8d2",
  groggy: "#d5d8ff",
  clipped: "#ffe1d4",
  quiet: "#e6e2d4"
};

const BASE_FRAMES = ["breath-a", "breath-b", "blink", "reminder-speak"];

function framesForState(state) {
  if (state === "healthy") {
    return [...BASE_FRAMES, "reaction-happy"];
  }

  if (state === "neglected") {
    return [...BASE_FRAMES, "reaction-wilt"];
  }

  return BASE_FRAMES;
}

function getPose(frame) {
  switch (frame) {
    case "breath-a":
      return { y: -3, lean: -2, squash: 1.03, eyes: "open", talk: false, hop: 0 };
    case "breath-b":
      return { y: 2, lean: 2, squash: 0.97, eyes: "open", talk: false, hop: 0 };
    case "blink":
      return { y: 0, lean: 0, squash: 1, eyes: "blink", talk: false, hop: 0 };
    case "reminder-speak":
      return { y: -5, lean: 7, squash: 1.01, eyes: "open", talk: true, hop: 0 };
    case "reaction-happy":
      return { y: -18, lean: -9, squash: 1.08, eyes: "open", talk: true, hop: 1 };
    case "reaction-wilt":
      return { y: 10, lean: -10, squash: 0.94, eyes: "low", talk: false, hop: 0 };
    default:
      return { y: 0, lean: 0, squash: 1, eyes: "open", talk: false, hop: 0 };
  }
}

function svgStyle(species, state, opacity) {
  const palette = SPECIES[species];
  const mood = STATES[state];

  return [
    "<style>",
    `.body-fill{fill:var(--color-species-${species}-body,${palette.body});opacity:${opacity};}`,
    `.accent-fill{fill:var(--color-species-${species}-accent,${palette.accent});opacity:${opacity};}`,
    `.blush-fill{fill:var(--color-species-${species}-blush,${palette.blush});}`,
    `.glow-fill{fill:var(--color-species-${species}-glow,${palette.glow});}`,
    `.outline-stroke{stroke:var(--color-species-${species}-outline,${palette.outline});stroke-width:6;stroke-linecap:round;stroke-linejoin:round;}`,
    `.fine-stroke{stroke:var(--color-species-${species}-outline,${palette.outline});stroke-width:4;stroke-linecap:round;stroke-linejoin:round;}`,
    `.mood-accent-fill{fill:var(--color-state-${state}-accent,${mood.accent});}`,
    `.mood-accent-stroke{stroke:var(--color-state-${state}-accent,${mood.accent});stroke-width:5;stroke-linecap:round;stroke-linejoin:round;}`,
    `.mood-bg-fill{fill:var(--color-state-${state}-bg,${mood.bg});}`,
    `.mood-fg-fill{fill:var(--color-state-${state}-fg,${mood.fg});}`,
    `.shadow-fill{fill:${palette.shadow};opacity:0.22;}`,
    "</style>"
  ].join("");
}

function faceMarkup(state, pose, leftX, rightX, eyeY, mouthCx, mouthY) {
  const blink = pose.eyes === "blink";
  const downcast = pose.eyes === "low" || state === "neglected";
  const sleepy = state === "sleep_deprived";
  const stressed = state === "stressed";
  const openMouth = pose.talk || state === "healthy";

  let eyes = "";
  if (blink) {
    eyes = [
      `<path class="fine-stroke" d="M ${leftX - 9} ${eyeY} Q ${leftX} ${eyeY + 4} ${leftX + 9} ${eyeY}" />`,
      `<path class="fine-stroke" d="M ${rightX - 9} ${eyeY} Q ${rightX} ${eyeY + 4} ${rightX + 9} ${eyeY}" />`
    ].join("");
  } else if (stressed) {
    eyes = [
      `<path class="fine-stroke" d="M ${leftX - 10} ${eyeY - 8} L ${leftX + 8} ${eyeY + 8}" />`,
      `<path class="fine-stroke" d="M ${leftX - 10} ${eyeY + 8} L ${leftX + 8} ${eyeY - 8}" />`,
      `<path class="fine-stroke" d="M ${rightX - 8} ${eyeY - 8} L ${rightX + 10} ${eyeY + 8}" />`,
      `<path class="fine-stroke" d="M ${rightX - 8} ${eyeY + 8} L ${rightX + 10} ${eyeY - 8}" />`
    ].join("");
  } else if (sleepy) {
    eyes = [
      `<path class="fine-stroke" d="M ${leftX - 11} ${eyeY + 1} H ${leftX + 9}" />`,
      `<path class="fine-stroke" d="M ${rightX - 9} ${eyeY + 1} H ${rightX + 11}" />`,
      `<path class="fine-stroke" d="M ${leftX - 10} ${eyeY - 6} Q ${leftX} ${eyeY - 10} ${leftX + 10} ${eyeY - 6}" opacity="0.45" />`,
      `<path class="fine-stroke" d="M ${rightX - 10} ${eyeY - 6} Q ${rightX} ${eyeY - 10} ${rightX + 10} ${eyeY - 6}" opacity="0.45" />`
    ].join("");
  } else if (downcast) {
    eyes = [
      `<ellipse class="mood-fg-fill" cx="${leftX}" cy="${eyeY}" rx="5" ry="6" opacity="0.72" />`,
      `<ellipse class="mood-fg-fill" cx="${rightX}" cy="${eyeY}" rx="5" ry="6" opacity="0.72" />`
    ].join("");
  } else {
    eyes = [
      `<ellipse class="mood-fg-fill" cx="${leftX}" cy="${eyeY}" rx="6" ry="8" />`,
      `<ellipse class="mood-fg-fill" cx="${rightX}" cy="${eyeY}" rx="6" ry="8" />`
    ].join("");
  }

  let mouth = "";
  if (state === "stressed") {
    mouth = `<path class="fine-stroke" d="M ${mouthCx - 15} ${mouthY} Q ${mouthCx - 7} ${mouthY - 7} ${mouthCx} ${mouthY} Q ${mouthCx + 7} ${mouthY + 7} ${mouthCx + 15} ${mouthY}" />`;
  } else if (pose.talk) {
    mouth = `<path class="outline-stroke" d="M ${mouthCx - 12} ${mouthY - 2} Q ${mouthCx} ${mouthY + 16} ${mouthCx + 12} ${mouthY - 2}" fill="var(--color-state-${state}-fg,${STATES[state].fg})" />`;
  } else if (state === "neglected") {
    mouth = `<path class="fine-stroke" d="M ${mouthCx - 10} ${mouthY + 3} Q ${mouthCx} ${mouthY + 8} ${mouthCx + 10} ${mouthY + 3}" opacity="0.74" />`;
  } else if (openMouth) {
    mouth = `<path class="fine-stroke" d="M ${mouthCx - 10} ${mouthY - 2} L ${mouthCx} ${mouthY + 8} L ${mouthCx + 10} ${mouthY - 2}" />`;
  } else {
    mouth = `<path class="fine-stroke" d="M ${mouthCx - 12} ${mouthY} Q ${mouthCx} ${mouthY + 6} ${mouthCx + 12} ${mouthY}" />`;
  }

  return `${eyes}${mouth}`;
}

function moodEffects(state, frame) {
  if (state === "healthy") {
    const extra = frame === "reaction-happy" ? ' opacity="1"' : ' opacity="0.88"';
    return [
      `<path class="mood-accent-stroke" d="M 70 60 L 70 44"${extra} />`,
      `<path class="mood-accent-stroke" d="M 63 52 L 77 52"${extra} />`,
      `<path class="mood-accent-stroke" d="M 185 54 L 193 40"${extra} />`,
      `<path class="mood-accent-stroke" d="M 178 44 L 200 50"${extra} />`,
      `<circle class="mood-accent-fill" cx="204" cy="84" r="${frame === "reaction-happy" ? 7 : 5}" opacity="0.75" />`
    ].join("");
  }

  if (state === "sleep_deprived") {
    return [
      '<path class="mood-bg-fill" d="M 188 58 Q 202 42 214 58 Q 205 60 201 73 Q 197 61 188 58 Z" opacity="0.7" />',
      '<circle class="mood-bg-fill" cx="56" cy="76" r="5" opacity="0.9" />',
      '<circle class="mood-bg-fill" cx="78" cy="56" r="4" opacity="0.82" />'
    ].join("");
  }

  if (state === "stressed") {
    return [
      '<path class="mood-accent-stroke" d="M 193 66 Q 204 47 218 66" />',
      '<path class="mood-accent-stroke" d="M 196 73 L 192 88" />',
      '<path class="mood-accent-stroke" d="M 208 74 L 204 90" />',
      '<path class="mood-accent-stroke" d="M 61 88 Q 64 66 78 74" opacity="0.65" />'
    ].join("");
  }

  return [
    '<path class="mood-accent-stroke" d="M 58 201 Q 68 182 82 192" opacity="0.74" />',
    '<circle class="mood-accent-fill" cx="198" cy="196" r="4" opacity="0.82" />'
  ].join("");
}

function axolotlSvg(state, frame) {
  const pose = getPose(frame);
  const moodLean = state === "neglected" ? -8 : state === "stressed" ? 4 : 0;
  const lean = pose.lean + moodLean;
  const y = pose.y;
  const bodyOpacity = state === "neglected" ? 0.82 : 1;
  const headY = 102 + y;
  const bodyY = 163 + y + (frame === "reaction-wilt" ? 10 : 0);
  const frillLift = frame === "reminder-speak" ? 10 : frame === "reaction-happy" ? 7 : frame === "reaction-wilt" ? -8 : 0;
  const tailDrop = frame === "reaction-wilt" ? 16 : 0;

  return [
    svgStyle("axolotl", state, bodyOpacity),
    '<ellipse class="shadow-fill" cx="128" cy="222" rx="54" ry="16" />',
    moodEffects(state, frame),
    `<g transform="translate(${lean} ${0})">`,
    `<g id="pet-axolotl" transform="translate(0 ${y})">`,
    `<path class="accent-fill outline-stroke" d="M 81 ${headY - 7} C 56 ${headY - 31 - frillLift} 35 ${headY - 7} 62 ${headY + 15} C 66 ${headY + 9} 73 ${headY + 1} 81 ${headY - 7} Z" />`,
    `<path class="accent-fill outline-stroke" d="M 72 ${headY + 12} C 45 ${headY + 10 - frillLift / 2} 35 ${headY + 30} 62 ${headY + 40} C 65 ${headY + 31} 68 ${headY + 22} 72 ${headY + 12} Z" />`,
    `<path class="accent-fill outline-stroke" d="M 173 ${headY - 7} C 198 ${headY - 31 - frillLift} 221 ${headY - 7} 194 ${headY + 15} C 190 ${headY + 9} 182 ${headY + 1} 173 ${headY - 7} Z" />`,
    `<path class="accent-fill outline-stroke" d="M 184 ${headY + 12} C 211 ${headY + 10 - frillLift / 2} 221 ${headY + 30} 194 ${headY + 40} C 191 ${headY + 31} 188 ${headY + 22} 184 ${headY + 12} Z" />`,
    `<ellipse class="glow-fill outline-stroke" cx="128" cy="${headY - 8}" rx="54" ry="44" />`,
    `<ellipse class="body-fill outline-stroke" cx="128" cy="${bodyY}" rx="48" ry="${Math.round(38 * pose.squash)}" />`,
    `<path class="body-fill outline-stroke" d="M 104 ${bodyY + 12} Q 86 ${bodyY + 46} 96 ${bodyY + 68 - tailDrop} Q 114 ${bodyY + 52} 124 ${bodyY + 24}" />`,
    `<path class="body-fill outline-stroke" d="M 152 ${bodyY + 12} Q 170 ${bodyY + 46} 160 ${bodyY + 68 - tailDrop} Q 142 ${bodyY + 52} 132 ${bodyY + 24}" />`,
    `<path class="accent-fill outline-stroke" d="M 116 ${bodyY + 48} Q 120 ${bodyY + 70} 114 ${bodyY + 84}" />`,
    `<path class="accent-fill outline-stroke" d="M 140 ${bodyY + 48} Q 136 ${bodyY + 70} 142 ${bodyY + 84}" />`,
    faceMarkup(state, pose, 108, 148, headY - 6, 128, headY + 20),
    `<circle class="blush-fill" cx="88" cy="${headY + 16}" r="9" opacity="${state === "neglected" ? "0.18" : "0.34"}" />`,
    `<circle class="blush-fill" cx="168" cy="${headY + 16}" r="9" opacity="${state === "neglected" ? "0.18" : "0.34"}" />`,
    frame === "reaction-happy"
      ? '<path class="mood-accent-stroke" d="M 128 34 L 128 18" /><path class="mood-accent-stroke" d="M 118 24 L 138 24" />'
      : "",
    "</g></g>"
  ].join("");
}

function catSvg(state, frame) {
  const pose = getPose(frame);
  const y = pose.y;
  const lean = pose.lean + (state === "healthy" ? -1 : 0);
  const bodyOpacity = state === "neglected" ? 0.82 : 1;
  const headY = 102 + y;
  const bodyTop = 138 + y;
  const earLift = frame === "reminder-speak" ? 10 : frame === "reaction-happy" ? 8 : frame === "reaction-wilt" ? -12 : 0;
  const tailRise = state === "stressed" ? -12 : frame === "reaction-happy" ? -18 : 0;
  const bodyBottom = frame === "reaction-wilt" ? 220 : 210;

  return [
    svgStyle("cat", state, bodyOpacity),
    '<ellipse class="shadow-fill" cx="128" cy="222" rx="56" ry="16" />',
    moodEffects(state, frame),
    `<g transform="translate(${lean} 0)">`,
    `<g id="pet-cat" transform="translate(0 ${y})">`,
    `<path class="accent-fill outline-stroke" d="M 92 ${headY - 24} L 76 ${headY - 60 - earLift} L 106 ${headY - 40} Z" />`,
    `<path class="accent-fill outline-stroke" d="M 164 ${headY - 24} L 180 ${headY - 60 - earLift} L 150 ${headY - 40} Z" />`,
    `<circle class="glow-fill outline-stroke" cx="128" cy="${headY - 6}" r="48" />`,
    `<path class="body-fill outline-stroke" d="M 96 ${bodyTop} C 96 ${bodyTop - 20} 160 ${bodyTop - 20} 160 ${bodyTop} L 170 ${bodyBottom - 24} Q 168 ${bodyBottom} 128 ${bodyBottom} Q 88 ${bodyBottom} 86 ${bodyBottom - 24} Z" />`,
    `<path class="accent-fill outline-stroke" d="M 162 ${bodyTop + 30} Q 212 ${bodyTop + 10 + tailRise} 188 ${bodyTop + 68 + tailRise}" fill="none" />`,
    `<path class="accent-fill outline-stroke" d="M 110 ${bodyBottom - 8} Q 108 ${bodyBottom + 10} 112 ${bodyBottom + 22}" fill="none" />`,
    `<path class="accent-fill outline-stroke" d="M 144 ${bodyBottom - 8} Q 146 ${bodyBottom + 10} 142 ${bodyBottom + 22}" fill="none" />`,
    faceMarkup(state, pose, 110, 146, headY - 4, 128, headY + 18),
    `<path class="fine-stroke" d="M 94 ${headY + 10} H 66" />`,
    `<path class="fine-stroke" d="M 96 ${headY + 20} H 70" />`,
    `<path class="fine-stroke" d="M 162 ${headY + 10} H 190" />`,
    `<path class="fine-stroke" d="M 160 ${headY + 20} H 186" />`,
    `<circle class="blush-fill" cx="96" cy="${headY + 16}" r="8" opacity="${state === "neglected" ? "0.14" : "0.26"}" />`,
    `<circle class="blush-fill" cx="160" cy="${headY + 16}" r="8" opacity="${state === "neglected" ? "0.14" : "0.26"}" />`,
    "</g></g>"
  ].join("");
}

function slimeSvg(state, frame) {
  const pose = getPose(frame);
  const y = pose.y;
  const lean = pose.lean * 0.7;
  const bodyOpacity = state === "neglected" ? 0.82 : 1;
  const topY = 82 + y;
  const baseY = frame === "reaction-wilt" ? 208 : 198;
  const domeLift = frame === "reaction-happy" ? -8 : 0;
  const drip = state === "neglected" || frame === "reaction-wilt" ? 16 : 4;

  return [
    svgStyle("slime", state, bodyOpacity),
    '<ellipse class="shadow-fill" cx="128" cy="222" rx="58" ry="16" />',
    moodEffects(state, frame),
    `<g transform="translate(${lean} 0)">`,
    `<g id="pet-slime" transform="translate(0 ${y})">`,
    `<path class="glow-fill outline-stroke" d="M 76 ${baseY - 10} Q 68 ${topY + 46} 90 ${topY + 10} Q 110 ${topY - 26 + domeLift} 128 ${topY - 28 + domeLift} Q 149 ${topY - 26 + domeLift} 168 ${topY + 10} Q 190 ${topY + 44} 180 ${baseY - 10} Q 170 ${baseY + drip} 150 ${baseY - 2} Q 136 ${baseY + 10} 128 ${baseY + 4} Q 117 ${baseY + 14} 102 ${baseY - 2} Q 84 ${baseY + drip} 76 ${baseY - 10} Z" />`,
    `<path class="accent-fill outline-stroke" d="M 112 ${topY + 20} Q 128 ${topY + 8} 144 ${topY + 20}" fill="none" />`,
    `<path class="accent-fill outline-stroke" d="M 86 ${baseY - 8} Q 104 ${baseY + 18} 118 ${baseY - 2}" fill="none" opacity="0.82" />`,
    `<path class="accent-fill outline-stroke" d="M 170 ${baseY - 4} Q 156 ${baseY + 12} 142 ${baseY}" fill="none" opacity="0.82" />`,
    faceMarkup(state, pose, 108, 148, topY + 36, 128, topY + 68),
    `<circle class="blush-fill" cx="94" cy="${topY + 62}" r="8" opacity="${state === "neglected" ? "0.12" : "0.2"}" />`,
    `<circle class="blush-fill" cx="162" cy="${topY + 62}" r="8" opacity="${state === "neglected" ? "0.12" : "0.2"}" />`,
    frame === "reaction-happy"
      ? '<circle class="mood-accent-fill" cx="200" cy="56" r="8" opacity="0.8" /><circle class="mood-accent-fill" cx="58" cy="66" r="5" opacity="0.76" />'
      : "",
    "</g></g>"
  ].join("");
}

function buildSprite(species, state, frame) {
  const label = `${species} ${state} ${frame}`;
  const body =
    species === "axolotl"
      ? axolotlSvg(state, frame)
      : species === "cat"
        ? catSvg(state, frame)
        : slimeSvg(state, frame);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="${label}">`,
    body,
    "</svg>"
  ].join("");
}

function buildTokens() {
  const colorSpecies = Object.fromEntries(
    Object.entries(SPECIES).map(([name, palette]) => [
      name,
      Object.fromEntries(
        Object.entries(palette)
          .filter(([key]) => key !== "shadow")
          .map(([key, value]) => [key, { value }])
      )
    ])
  );

  const colorState = Object.fromEntries(
    Object.entries(STATES).map(([name, palette]) => [
      name,
      Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, { value }]))
    ])
  );

  const colorBubble = Object.fromEntries(
    Object.entries(BUBBLES).map(([name, value]) => [name, { value }])
  );

  return {
    color: {
      state: colorState,
      species: colorSpecies,
      bubble: colorBubble
    },
    font: {
      display: { value: '"Fraunces", "Young Serif", Georgia, serif' },
      body: { value: '"Inter Tight", "Recursive Sans", "Avenir Next", sans-serif' },
      terminal: { value: '"JetBrains Mono", "Berkeley Mono", monospace' }
    },
    size: {
      type: {
        12: { value: "12px" },
        14: { value: "14px" },
        16: { value: "16px" },
        20: { value: "20px" },
        28: { value: "28px" },
        40: { value: "40px" }
      }
    },
    motion: {
      breath: { duration: { value: "2200ms" }, ease: { value: "easeInOut" } },
      blink: { duration: { value: "120ms" } },
      bubble: { pop: { value: "220ms" } },
      stressed: { pace: { value: "1200ms" } },
      reaction: { happy: { value: "600ms" } }
    }
  };
}

function buildModule(spriteMap) {
  return [
    "export const PET_SVG_FRAMES = " + JSON.stringify(spriteMap, null, 2) + " as const;",
    "",
    "export type PetSvgFrameName =",
    '  | "breath-a"',
    '  | "breath-b"',
    '  | "blink"',
    '  | "reminder-speak"',
    '  | "reaction-happy"',
    '  | "reaction-wilt";',
    "",
    "type SpriteMap = Record<string, Record<string, Record<string, string>>>;",
    "",
    "export function getPetSvgFrame(",
    "  species: string,",
    "  state: string,",
    '  frame: PetSvgFrameName = "breath-a"',
    "): string {",
    "  const frames = (PET_SVG_FRAMES as SpriteMap)[species]?.[state];",
    "  if (!frames) {",
    '    return "";',
    "  }",
    '  return frames[frame] ?? frames["breath-a"] ?? "";',
    "}",
    ""
  ].join("\n");
}

async function main() {
  const spriteMap = {};
  await mkdir(petsRoot, { recursive: true });
  await mkdir(generatedRoot, { recursive: true });

  for (const species of Object.keys(SPECIES)) {
    spriteMap[species] = {};

    for (const state of Object.keys(STATES)) {
      spriteMap[species][state] = {};
      const dir = path.join(petsRoot, species, state);
      await mkdir(dir, { recursive: true });

      for (const frame of framesForState(state)) {
        const svg = buildSprite(species, state, frame);
        spriteMap[species][state][frame] = svg;
        await writeFile(path.join(dir, `${frame}.svg`), svg + "\n", "utf8");
      }
    }
  }

  await writeFile(
    path.join(assetsRoot, "tokens.json"),
    JSON.stringify(buildTokens(), null, 2) + "\n",
    "utf8"
  );

  await writeFile(
    path.join(generatedRoot, "pet-svg.ts"),
    buildModule(spriteMap),
    "utf8"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
