import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function safeReadText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function safeReadJson<T = unknown>(
  filePath: string
): Promise<T | null> {
  const text = await safeReadText(filePath);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(
  rootDir: string,
  options: {
    include?: (filePath: string) => boolean;
    maxDepth?: number;
    maxFiles?: number;
    skip?: (entryPath: string) => boolean;
  } = {}
): Promise<string[]> {
  const include = options.include ?? (() => true);
  const skip = options.skip ?? (() => false);
  const maxDepth = options.maxDepth ?? 6;
  const maxFiles = options.maxFiles ?? 200;
  const results: string[] = [];

  async function visit(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth || results.length >= maxFiles || skip(currentDir)) {
      return;
    }

    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (skip(entryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1);
      } else if (include(entryPath)) {
        results.push(entryPath);
        if (results.length >= maxFiles) {
          return;
        }
      }
    }
  }

  await visit(rootDir, 0);
  return results;
}

export async function mostRecentFiles(
  paths: string[],
  limit: number
): Promise<string[]> {
  const dated = await Promise.all(
    paths.map(async (filePath) => {
      try {
        const details = await stat(filePath);
        return { filePath, mtimeMs: details.mtimeMs };
      } catch {
        return { filePath, mtimeMs: 0 };
      }
    })
  );

  return dated
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

export function pickTopItems(values: string[], limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

export function pickDeepValue(
  input: unknown,
  candidateKeys: string[]
): unknown {
  const queue: unknown[] = [input];
  const normalizedCandidates = candidateKeys.map(normalizeKey);

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (normalizedCandidates.includes(normalizeKey(key))) {
        return value;
      }

      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return null;
}

export function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numeric = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  return 0;
}

export function formatHoursAndMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  return `${hoursPart}h ${String(minutesPart).padStart(2, "0")}m`;
}

export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
