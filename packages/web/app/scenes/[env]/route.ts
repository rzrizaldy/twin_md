import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TWIN_ENVIRONMENTS, type TwinEnvironment } from "@twin-md/core";

// Walk up from the working dir to find packages/core/assets/scenes. Tries the
// monorepo layout first, then falls back to a hoisted node_modules copy.
function resolveAssetsDir(): string {
  const candidates = [
    resolve(process.cwd(), "../core/assets/scenes"),
    resolve(process.cwd(), "../../packages/core/assets/scenes"),
    resolve(process.cwd(), "node_modules/@twin-md/core/assets/scenes")
  ];

  for (const dir of candidates) {
    try {
      readFileSync(resolve(dir, "..", "tokens.json"));
      return dir;
    } catch {
      // try next
    }
  }
  return candidates[0];
}

let _assetsDir: string | undefined;
function getAssetsDir(): string {
  if (!_assetsDir) {
    _assetsDir = resolveAssetsDir();
  }
  return _assetsDir;
}

// In-memory cache so we don't re-read ~1-2MB PNG buffers on every request.
const cache = new Map<TwinEnvironment, Buffer>();

type RouteContext = {
  params: Promise<{ env: string }>;
};

function normalise(raw: string): TwinEnvironment | null {
  const bare = raw.replace(/\.(png|svg)$/, "") as TwinEnvironment;
  return (TWIN_ENVIRONMENTS as readonly string[]).includes(bare) ? bare : null;
}

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const { env } = await ctx.params;
  const scene = normalise(env);
  if (!scene) {
    return new Response("scene not found", { status: 404 });
  }

  let buf = cache.get(scene);
  if (!buf) {
    try {
      buf = readFileSync(resolve(getAssetsDir(), scene, "reference.png"));
      cache.set(scene, buf);
    } catch {
      return new Response("scene asset missing", { status: 404 });
    }
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300, must-revalidate"
    }
  });
}
