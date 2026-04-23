import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { getTwinStatePath } from "@twin-md/core/server";
import { gitPulse } from "@twin-md/brain";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_SCENES = new Set([
  "sunny_island",
  "stars_at_noon",
  "storm_room",
  "grey_nook"
]);

function coreRoot(): string {
  return path.dirname(require.resolve("@twin-md/core/package.json"));
}

function publicDir(): string {
  return path.join(__dirname, "..", "public");
}

function safePetPath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.includes("..")) return null;
  const posix = normalized.replace(/\\/g, "/");
  if (!/^[\w./-]+$/u.test(posix)) return null;
  if (!/\.(png|svg)$/i.test(normalized)) return null;
  const full = path.join(coreRoot(), "assets", "pets", normalized);
  const petsRoot = path.join(coreRoot(), "assets", "pets");
  if (!full.startsWith(petsRoot)) return null;
  // Reference-first: serve *-reference.png when it exists alongside the canonical.
  if (full.endsWith(".png") && !full.endsWith("-reference.png")) {
    const refPath = full.replace(/\.png$/, "-reference.png");
    if (existsSync(refPath)) return refPath;
  }
  return full;
}

function scenePath(sceneId: string): string | null {
  const bare = sceneId.replace(/\.svg$/i, "");
  if (!VALID_SCENES.has(bare)) return null;
  const full = path.join(coreRoot(), "assets", "scenes", bare, "composite.svg");
  return existsSync(full) ? full : null;
}

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

export type WebLiteOptions = {
  port: number;
  host: string;
};

export async function startWebLiteServer(options: WebLiteOptions): Promise<http.Server> {
  const pub = publicDir();

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, pub).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("server error");
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pub: string
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const p = url.pathname;

  if (req.method === "GET" && p === "/state.json") {
    const twinState = getTwinStatePath();
    if (!existsSync(twinState)) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(
        JSON.stringify({
          ok: false,
          error: "no_twin_state",
          hint: "Run `twin-md harvest` once, then refresh."
        })
      );
      return;
    }

    const raw = await readFile(twinState, "utf8");
    const stat = statSync(twinState);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ETag: `"${stat.mtimeMs}"`
    });
    res.end(raw);
    return;
  }

  if (req.method === "GET" && p.startsWith("/scenes/")) {
    const name = p.slice("/scenes/".length);
    const full = scenePath(name);
    if (!full) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=120"
    });
    createReadStream(full).pipe(res);
    return;
  }

  if (req.method === "GET" && p.startsWith("/pets/")) {
    const rel = p.slice("/pets/".length);
    const full = safePetPath(rel);
    if (!full || !existsSync(full)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(full),
      "Cache-Control": "public, max-age=300"
    });
    createReadStream(full).pipe(res);
    return;
  }

  if (req.method === "GET" && p === "/pulse.json") {
    const brainPath =
      process.env.TWIN_BRAIN_PATH ?? path.join(os.homedir(), "twin-brain");
    const days = await gitPulse(brainPath, 30).catch(() => []);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ ok: true, brainPath, days }, null, 2));
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("method not allowed");
    return;
  }

  const relative = (p.replace(/^\//, "") || "index.html").split("/").filter(Boolean).join(path.sep);
  const filePath = path.resolve(pub, relative);
  if (!filePath.startsWith(path.resolve(pub))) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-cache"
  });
  createReadStream(filePath).pipe(res);
}

const defaultPort = () => Number(process.env.TWIN_WEB_LITE_PORT ?? "4730");
const defaultHost = () => process.env.TWIN_WEB_LITE_HOST ?? "127.0.0.1";

async function main() {
  const port = defaultPort();
  const host = defaultHost();
  const server = await startWebLiteServer({ port, host });
  const url = `http://${host}:${port}/`;
  console.log(`twin web-lite listening at ${url}`);
  console.log("Replies and chat stay in the desktop pet. This mirror is read-only state + scene.");

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
