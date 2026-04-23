/**
 * Brain vault scanner — walks .md files and returns BrainEntry[].
 * Mirrors Tolaria's vault/scan logic: `_*` system keys excluded, protected dirs included.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { parseMdFile } from "./parse.js";
import type { BrainEntry } from "./types.js";

const PROTECTED_DIRS = new Set(["type", "config", "attachments"]);

function walkMd(dir: string, results: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMd(full, results);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
}

/**
 * Full scan of the brain vault at `brainPath`.
 * Walks root `.md` files + protected subdirectories.
 */
export function scanBrain(brainPath: string): BrainEntry[] {
  const paths: string[] = [];

  for (const entry of readdirSync(brainPath, { withFileTypes: true })) {
    const full = path.join(brainPath, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(full);
    } else if (entry.isDirectory()) {
      walkMd(full, paths);
    }
  }

  const results: BrainEntry[] = [];
  for (const p of paths) {
    try {
      results.push(parseMdFile(p));
    } catch {
      // Skip unreadable files silently
    }
  }
  return results;
}

/**
 * Selective scan of only the given file paths (absolute or relative to brainPath).
 * Used for cache incremental updates.
 */
export function scanFiles(brainPath: string, relPaths: string[]): BrainEntry[] {
  const results: BrainEntry[] = [];
  for (const rel of relPaths) {
    const abs = path.isAbsolute(rel) ? rel : path.join(brainPath, rel);
    if (!abs.endsWith(".md") || !existsSync(abs)) continue;
    try {
      results.push(parseMdFile(abs));
    } catch {
      // Skip
    }
  }
  return results;
}
