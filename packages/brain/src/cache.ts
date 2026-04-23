/**
 * Cached brain scanner — mirrors Tolaria's three-strategy approach:
 *   1. No cache → full scan
 *   2. Same git HEAD → re-parse only dirty (git status --porcelain) files
 *   3. Different HEAD → re-parse files touched between old HEAD and new HEAD (git diff)
 *
 * Cache lives at `~/.claude/twin/cache/<vault-hash>.json`.
 * Written atomically via .tmp + rename to avoid corrupt reads.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanBrain, scanFiles } from "./scan.js";
import { gitDiffFiles, gitDirtyFiles, gitHead } from "./git.js";
import type { BrainCache, BrainEntry } from "./types.js";
import { BRAIN_CACHE_SCHEMA_VERSION } from "./types.js";

function cacheDir(): string {
  return path.join(os.homedir(), ".claude", "twin", "cache");
}

function cachePathFor(brainPath: string): string {
  const hash = createHash("sha1").update(brainPath).digest("hex").slice(0, 12);
  return path.join(cacheDir(), `brain-${hash}.json`);
}

function readCache(cachePath: string): BrainCache | null {
  try {
    const raw = readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw) as BrainCache;
    if (parsed.schemaVersion !== BRAIN_CACHE_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cachePath: string, cache: BrainCache): void {
  mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2) + "\n", "utf8");
  renameSync(tmp, cachePath);
}

function entriesToRecord(entries: BrainEntry[]): Record<string, BrainEntry> {
  const r: Record<string, BrainEntry> = {};
  for (const e of entries) r[e.path] = e;
  return r;
}

/**
 * Three-strategy cached scan.
 * Returns all current BrainEntry[] for the vault. Updates cache on disk.
 */
export async function scanBrainCached(brainPath: string): Promise<BrainEntry[]> {
  if (!existsSync(brainPath)) return [];

  const cachePath = cachePathFor(brainPath);
  const cached = readCache(cachePath);
  const head = await gitHead(brainPath);

  // Strategy 1: no cache → full scan
  if (!cached) {
    const all = scanBrain(brainPath);
    writeCache(cachePath, {
      schemaVersion: BRAIN_CACHE_SCHEMA_VERSION,
      gitHead: head,
      writtenAt: new Date().toISOString(),
      entries: entriesToRecord(all)
    });
    return all;
  }

  // Strategy 2: same HEAD → only re-parse uncommitted dirty files
  if (head && cached.gitHead === head) {
    let dirty: string[] = [];
    try {
      dirty = await gitDirtyFiles(brainPath);
    } catch {
      dirty = [];
    }
    if (dirty.length === 0) {
      return Object.values(cached.entries);
    }
    const updated = scanFiles(brainPath, dirty);
    const newEntries = { ...cached.entries };
    for (const e of updated) newEntries[e.path] = e;
    // Remove deleted files
    for (const p of dirty) {
      const abs = path.isAbsolute(p) ? p : path.join(brainPath, p);
      if (!existsSync(abs)) delete newEntries[abs];
    }
    writeCache(cachePath, {
      schemaVersion: BRAIN_CACHE_SCHEMA_VERSION,
      gitHead: head,
      writtenAt: new Date().toISOString(),
      entries: newEntries
    });
    return Object.values(newEntries);
  }

  // Strategy 3: different HEAD → re-parse files that changed between HEADs
  if (head && cached.gitHead && head !== cached.gitHead) {
    let changed: string[] = [];
    try {
      changed = await gitDiffFiles(brainPath, cached.gitHead, head);
    } catch {
      changed = [];
    }
    // Also include currently dirty
    try {
      const dirty = await gitDirtyFiles(brainPath);
      changed.push(...dirty);
    } catch {
      // ignore
    }
    const updated = scanFiles(brainPath, changed);
    const newEntries = { ...cached.entries };
    for (const e of updated) newEntries[e.path] = e;
    for (const p of changed) {
      const abs = path.isAbsolute(p) ? p : path.join(brainPath, p);
      if (!existsSync(abs)) delete newEntries[abs];
    }
    writeCache(cachePath, {
      schemaVersion: BRAIN_CACHE_SCHEMA_VERSION,
      gitHead: head,
      writtenAt: new Date().toISOString(),
      entries: newEntries
    });
    return Object.values(newEntries);
  }

  // Fallback: no HEAD (no commits yet) — return cached entries or re-scan dirty
  return Object.values(cached.entries);
}

/** Force a full rescan and rewrite the cache. */
export async function rebuildBrainCache(brainPath: string): Promise<BrainEntry[]> {
  const all = scanBrain(brainPath);
  const head = await gitHead(brainPath);
  const cachePath = cachePathFor(brainPath);
  writeCache(cachePath, {
    schemaVersion: BRAIN_CACHE_SCHEMA_VERSION,
    gitHead: head,
    writtenAt: new Date().toISOString(),
    entries: entriesToRecord(all)
  });
  return all;
}
