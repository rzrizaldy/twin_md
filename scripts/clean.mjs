#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  "packages/core/dist",
  "packages/brain/dist",
  "packages/mcp/dist",
  "packages/cli/dist",
  "apps/landing/dist",
  "apps/landing/.astro",
  "apps/landing/public/pets",
  "apps/landing/public/bubbles",
  "apps/landing/public/tokens.json",
  "apps/desktop/dist",
  "apps/desktop/public/pets",
  "apps/desktop/public/bubbles",
  "apps/desktop/public/scenes",
  "apps/desktop/public/tokens.json",
  "apps/desktop/src-tauri/target",
  "output/releases",
  "tmp/sleep-build"
];

for (const target of targets) {
  const abs = path.join(root, target);
  await rm(abs, { recursive: true, force: true });
  console.log(`removed ${target}`);
}
