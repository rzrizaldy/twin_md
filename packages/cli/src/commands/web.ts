import { spawn } from "node:child_process";
import qrcodeTerminal from "qrcode-terminal";
import { readTwinConfigOrDefault, runTwinHarvest } from "@twin/core";
import { getLanUrl, resolvePackageRoot } from "../support.js";

type WebOptions = {
  port?: string;
};

export async function runWebCommand(options: WebOptions): Promise<void> {
  const port = Number(options.port ?? "3000");
  const config = await readTwinConfigOrDefault();
  await runTwinHarvest(config);

  const webRoot = resolvePackageRoot("@twin/web");
  const url = getLanUrl(port);

  console.log(`Starting twin web at ${url}`);
  qrcodeTerminal.generate(url, { small: true });

  const child = spawn(
    "npm",
    ["run", "dev", "--", "--hostname", "0.0.0.0", "--port", String(port)],
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
