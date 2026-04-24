#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreCat = resolve(root, "packages/core/assets/pets/cat");
const stagedCats = [
  resolve(root, "apps/desktop/public/pets/cat"),
  resolve(root, "apps/landing/public/pets/cat")
];

const states = ["healthy", "sleep_deprived", "stressed", "neglected"];
const requiredBaseFrames = [
  "blink",
  "breath-a",
  "breath-b",
  "reminder-speak",
  "turn-3q",
  "turn-front"
];
const stateExtraFrames = {
  healthy: ["reaction-happy"],
  neglected: ["reaction-wilt"]
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

function fail(message) {
  throw new Error(message);
}

function rel(file) {
  return relative(root, file);
}

function readPng(file) {
  if (!existsSync(file)) fail(`missing PNG: ${rel(file)}`);
  const buffer = readFileSync(file);
  if (buffer.length < 33) fail(`too small to be a PNG: ${rel(file)}`);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail(`bad PNG signature: ${rel(file)}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== 1024 || height !== 1024) {
    fail(`unexpected PNG dimensions ${width}x${height}: ${rel(file)}`);
  }
  return buffer;
}

function sha(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const coreHashes = new Map();

for (const state of states) {
  const frames = [
    ...requiredBaseFrames,
    ...(stateExtraFrames[state] ?? [])
  ];
  for (const frame of frames) {
    const file = join(coreCat, state, `${frame}.png`);
    coreHashes.set(`${state}/${frame}.png`, sha(readPng(file)));
  }
}

for (const stagedCat of stagedCats) {
  if (!existsSync(stagedCat)) continue;
  for (const [path, hash] of coreHashes) {
    const stagedFile = join(stagedCat, path);
    const stagedHash = sha(readPng(stagedFile));
    if (stagedHash !== hash) {
      fail(
        `staged cat asset drift: ${rel(stagedFile)} does not match packages/core/assets/pets/cat/${path}`
      );
    }
  }

  for (const state of readdirSync(stagedCat)) {
    const stateDir = join(stagedCat, state);
    if (!existsSync(stateDir)) continue;
    if (!statSync(stateDir).isDirectory()) continue;
    for (const file of readdirSync(stateDir)) {
      if (file.endsWith("-reference.png")) continue;
      if (file.endsWith(".png")) readPng(join(stateDir, file));
    }
  }
}

console.log(`Validated ${coreHashes.size} canonical cat PNGs.`);
