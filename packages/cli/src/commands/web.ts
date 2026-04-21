import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import qrcodeTerminal from "qrcode-terminal";
import { readTwinConfigOrDefault, runTwinHarvest } from "@twin-md/core";
import { getLanUrl, resolvePackageRoot } from "../support.js";

type WebOptions = {
  port?: string;
  dev?: boolean;
};

export async function runWebCommand(options: WebOptions): Promise<void> {
  const port = Number(options.port ?? "3000");
  const config = await readTwinConfigOrDefault();
  await runTwinHarvest(config);

  const webRoot = resolvePackageRoot("@twin-md/web");
  const url = getLanUrl(port);

  const hasBuild = existsSync(path.join(webRoot, ".next"));
  const mode = options.dev || !hasBuild ? "dev" : "start";

  console.log(`Starting twin web (${mode}) at ${url}`);
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
        reject(new Error(`twin web exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}
