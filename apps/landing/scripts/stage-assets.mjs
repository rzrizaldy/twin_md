#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, '..', '..', '..', 'packages', 'core', 'assets');
const out = resolve(here, '..', 'public');

if (!existsSync(core)) {
  console.error(`[stage-assets] core assets not found at ${core}`);
  process.exit(1);
}

for (const sub of ['pets', 'bubbles']) {
  const src = resolve(core, sub);
  const dst = resolve(out, sub);
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`[stage-assets] ${sub} → public/${sub}`);
}

copyFileSync(resolve(core, 'tokens.json'), resolve(out, 'tokens.json'));
console.log('[stage-assets] tokens.json → public/tokens.json');
