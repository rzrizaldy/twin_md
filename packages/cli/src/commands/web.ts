import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import qrcodeTerminal from "qrcode-terminal";
import { readTwinConfigOrDefault, runTwinHarvest } from "@twin-md/core/server";
import { startWebLiteServer } from "@twin-md/web-lite";
import { getLanUrl, resolvePackageRoot } from "../support.js";

type WebOptions = {
  port?: string;
  host?: string;
  next?: boolean;
  dev?: boolean;
};

const WEB_LITE_DEFAULT_PORT = 4730;

export async function runWebCommand(options: WebOptions): Promise<void> {
  const config = await readTwinConfigOrDefault();
  await runTwinHarvest(config);

  if (options.next) {
    await runNextWeb(options);
    return;
  }

  const port = Number(options.port ?? String(WEB_LITE_DEFAULT_PORT));
  const host = options.host ?? "127.0.0.1";

  const server = await startWebLiteServer({ port, host });
  const localUrl = `http://${host}:${port}/`;
  console.log(`twin web-lite at ${localUrl}`);
  console.log("Island mirror (read-only). Chat lives in the desktop pet.");

  if (host === "0.0.0.0") {
    const lan = getLanUrl(port);
    console.log(`LAN: ${lan}`);
    qrcodeTerminal.generate(lan, { small: true });
  }

  const shutdown = () => {
    server.close();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>((resolve) => {
    server.on("close", () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    });
  });
}

async function runNextWeb(options: WebOptions): Promise<void> {
  const port = Number(options.port ?? "3000");
  const webRoot = resolvePackageRoot("@twin-md/web");
  const url = getLanUrl(port);

  const hasBuild = existsSync(path.join(webRoot, ".next"));
  const mode = options.dev || !hasBuild ? "dev" : "start";

  console.log(`Starting twin Next.js web (${mode}) at ${url}`);
  console.warn("Legacy mode: requires @twin-md/web. Prefer default web-lite (omit --next).");
  qrcodeTerminal.generate(url, { small: true });

  const child = spawn(
    "npm",
    ["run", mode, "--", "--hostname", "0.0.0.0", "--port", String(port)],
    {
      cwd: webRoot,
      stdio: "inherit"
    }
  );

  const shutdown = () => {
    child.kill("SIGINT");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`twin web (next) exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}
