#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync, rmSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, "..", "..", "..", "packages", "core", "assets");
const out = resolve(here, "..", "public");

if (!existsSync(core)) {
  console.error(`[stage-assets] core assets not found at ${core}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

for (const sub of ["pets", "bubbles", "scenes"]) {
  const src = resolve(core, sub);
  const dst = resolve(out, sub);
  if (!existsSync(src)) continue;
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (source) => basename(source) !== ".DS_Store"
  });
  console.log(`[stage-assets] ${sub} → public/${sub}`);
}

// Reference-first resolver: for each canonical *.png in public/pets, if a
// *-reference.png exists alongside it in the same directory, overwrite the
// canonical name with the reference variant so runtime code needs zero branches.
//
// Cat is intentionally excluded. Its canonical set is the cream/orange chibi
// PNG family in packages/core/assets/pets/cat, not the older reference files.
const petsOut = resolve(out, "pets");
if (existsSync(petsOut)) {
  let resolved = 0;
  for (const species of readdirSync(petsOut)) {
    if (species === "cat") continue;
    const speciesDir = join(petsOut, species);
    if (!statSync(speciesDir).isDirectory()) continue;
    for (const mood of readdirSync(speciesDir)) {
      const moodDir = join(speciesDir, mood);
      if (!statSync(moodDir).isDirectory()) continue;
      for (const file of readdirSync(moodDir)) {
        if (!file.endsWith(".png") || file.endsWith("-reference.png")) continue;
        const refFile = file.replace(/\.png$/, "-reference.png");
        const refPath = join(moodDir, refFile);
        if (existsSync(refPath)) {
          copyFileSync(refPath, join(moodDir, file));
          resolved += 1;
        }
      }
    }
  }
  if (resolved > 0) console.log(`[stage-assets] resolved ${resolved} reference sprite(s) to canonical names`);
}

copyFileSync(resolve(core, "tokens.json"), resolve(out, "tokens.json"));
console.log("[stage-assets] tokens.json → public/tokens.json");
