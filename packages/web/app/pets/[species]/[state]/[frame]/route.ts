import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PetSvgFrameName } from "@twin-md/core";

// Resolve the pet assets directory relative to the core package
function findAssetsDir(): string {
  // Walk up from this file to find packages/core/assets/pets
  const cwd = process.cwd();
  return resolve(cwd, "node_modules/@twin-md/core/assets/pets");
}

// Try the monorepo structure first, then fallback to node_modules
function resolveAssetsDir(): string {
  const candidates = [
    resolve(process.cwd(), "../core/assets/pets"),
    resolve(process.cwd(), "../../packages/core/assets/pets"),
    findAssetsDir()
  ];
  
  for (const dir of candidates) {
    try {
      readFileSync(resolve(dir, "..", "tokens.json"));
      return dir;
    } catch {
      // try next
    }
  }
  return candidates[0]; // best guess
}

let _assetsDir: string | undefined;
function getAssetsDir(): string {
  if (!_assetsDir) {
    _assetsDir = resolveAssetsDir();
  }
  return _assetsDir;
}

type RouteContext = {
  params: Promise<{ species: string; state: string; frame: string }>;
};

const VALID_FRAMES: readonly PetSvgFrameName[] = [
  "breath-a",
  "breath-b",
  "blink",
  "reminder-speak",
  "reaction-happy",
  "reaction-wilt",
  "turn-3q",
  "turn-front"
];

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const { species, state, frame } = await ctx.params;
  const bareFrame = frame.replace(/\.(svg|png)$/, "") as PetSvgFrameName;
  const frameName: PetSvgFrameName = VALID_FRAMES.includes(bareFrame)
    ? bareFrame
    : "breath-a";

  const assetsDir = getAssetsDir();
  
  let pngBuffer: Buffer;
  try {
    pngBuffer = readFileSync(resolve(assetsDir, species, state, `${frameName}.png`));
  } catch {
    // Fallback to breath-a
    try {
      pngBuffer = readFileSync(resolve(assetsDir, species, state, "breath-a.png"));
    } catch {
      return new Response("sprite not found", { status: 404 });
    }
  }

  return new Response(new Uint8Array(pngBuffer), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300, must-revalidate"
    }
  });
}
