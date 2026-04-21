import path from "node:path";
import type { TwinConfig } from "../config.js";
import type { TwinSection } from "../schema.js";
import { mostRecentFiles, pickTopItems, safeReadText, walkFiles } from "./shared.js";

export async function harvestObsidianSignals(
  config: TwinConfig
): Promise<TwinSection> {
  if (!config.obsidianVaultPath) {
    return {
      daily_note_streak: 0,
      recent_tags: [],
      unfinished_todos: 0,
      last_reflection: "No Obsidian vault configured."
    };
  }

  const markdownFiles = await walkFiles(config.obsidianVaultPath, {
    include: (filePath) => filePath.endsWith(".md"),
    maxDepth: 8,
    maxFiles: 240,
    skip: (entryPath) => /\.obsidian|node_modules|\.git/u.test(entryPath)
  });

  if (!markdownFiles.length) {
    return {
      daily_note_streak: 0,
      recent_tags: [],
      unfinished_todos: 0,
      last_reflection: "Vault path exists but no markdown notes were found."
    };
  }

  const recentFiles = await mostRecentFiles(markdownFiles, 15);
  const recentContents = (
    await Promise.all(recentFiles.map((filePath) => safeReadText(filePath)))
  ).filter(Boolean) as string[];

  const tags = pickTopItems(
    recentContents.flatMap((content) =>
      [...content.matchAll(/(^|\s)#([A-Za-z0-9/_-]+)/g)].map((match) => match[2] ?? "")
    )
  );
  const unfinishedTodos = recentContents.reduce((count, content) => {
    return count + (content.match(/^- \[ \]/gmu)?.length ?? 0);
  }, 0);
  const dailyNoteStreak = computeDailyNoteStreak(markdownFiles);
  const lastReflection = await extractLastReflection(recentFiles);

  return {
    daily_note_streak: dailyNoteStreak,
    recent_tags: tags,
    unfinished_todos: unfinishedTodos,
    last_reflection: lastReflection
  };
}

function computeDailyNoteStreak(paths: string[]): number {
  const datedFiles = paths
    .map((filePath) => path.basename(filePath, ".md"))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/u.test(name))
    .sort()
    .reverse();

  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  for (const name of datedFiles) {
    const iso = cursor.toISOString().slice(0, 10);
    if (name !== iso) {
      if (streak === 0 && name === shiftIsoDate(iso, -1)) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      break;
    }

    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

async function extractLastReflection(recentFiles: string[]): Promise<string> {
  for (const filePath of recentFiles) {
    const content = await safeReadText(filePath);
    if (!content) {
      continue;
    }

    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !line.startsWith("#") &&
          !line.startsWith("- [") &&
          !line.startsWith("```")
      );

    const reflection =
      [...lines]
        .reverse()
        .find((line) => line.length > 24 && !line.startsWith("![")) ??
      lines.at(-1);

    if (reflection) {
      return reflection;
    }
  }

  return "No reflection line found in recent notes.";
}
