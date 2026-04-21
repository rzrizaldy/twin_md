import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function resolvePackageRoot(packageName: string): string {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

export function resolveMcpEntrypoint(): string {
  return require.resolve("@twin-md/mcp/server");
}

export function getLanUrl(port: number): string {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return `http://${address.address}:${port}`;
      }
    }
  }

  return `http://localhost:${port}`;
}
