import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { TWIN_ENVIRONMENTS, type TwinEnvironment } from "@twin-md/core";

const require = createRequire(import.meta.url);

// Resolve once at module load; the Node server runtime can reach the
// workspace-linked assets under `@twin-md/core/assets/scenes/{env}/composite.svg`.
const coreAssetsRoot = (() => {
  const pkgPath = require.resolve("@twin-md/core/package.json");
  return join(dirname(pkgPath), "assets", "scenes");
})();

// In-memory cache so we don't re-read 1-2MB SVGs on every request.
const cache = new Map<TwinEnvironment, string>();

type RouteContext = {
  params: Promise<{ env: string }>;
};

function normalise(raw: string): TwinEnvironment | null {
  const bare = raw.replace(/\.svg$/, "") as TwinEnvironment;
  return (TWIN_ENVIRONMENTS as readonly string[]).includes(bare) ? bare : null;
}

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const { env } = await ctx.params;
  const scene = normalise(env);
  if (!scene) {
    return new Response("scene not found", { status: 404 });
  }

  let svg = cache.get(scene);
  if (!svg) {
    try {
      svg = await readFile(
        join(coreAssetsRoot, scene, "composite.svg"),
        "utf8"
      );
      cache.set(scene, svg);
    } catch {
      return new Response("scene asset missing", { status: 404 });
    }
  }

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate"
    }
  });
}
