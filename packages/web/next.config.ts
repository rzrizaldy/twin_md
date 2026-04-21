import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ["@twin-md/core"],
  outputFileTracingRoot: path.join(packageDir, "../../")
};

export default nextConfig;
