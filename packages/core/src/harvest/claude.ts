import path from "node:path";
import type { TwinConfig } from "../config.js";
import type { TwinSection } from "../schema.js";
import { mostRecentFiles, pickTopItems, safeReadText, walkFiles } from "./shared.js";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "have",
  "will",
  "your",
  "into",
  "when",
  "then",
  "them",
  "just",
  "like",
  "user",
  "users",
  "work",
  "code",
  "task",
  "turn",
  "they",
  "keep"
]);

export async function harvestClaudeSignals(
  config: TwinConfig
): Promise<TwinSection> {
  const candidateFiles = await walkFiles(config.claudeDir, {
    include: (filePath) =>
      filePath.endsWith(".md") ||
      filePath.endsWith(".txt") ||
      filePath.endsWith(".jsonl"),
    maxDepth: 5,
    maxFiles: 120,
    skip: (entryPath) =>
      /node_modules|\.git|\.next|Library\/Application Support/u.test(entryPath)
  });

  const prioritized = await mostRecentFiles(
    candidateFiles.filter((filePath) => {
      const name = path.basename(filePath).toLowerCase();
      return (
        name === "claude.md" ||
        name === "memory.md" ||
        name === "memory_summary.md" ||
        filePath.includes("rollout_summaries")
      );
    }),
    8
  );

  const texts = (
    await Promise.all(prioritized.map((filePath) => safeReadText(filePath)))
  ).filter(Boolean) as string[];

  if (!texts.length) {
    return {
      recent_topics: ["setup"],
      tone_7d: "neutral",
      wins: "No recent Claude memory files found.",
      frictions: "Memory source not connected yet."
    };
  }

  const combined = texts.join("\n");
  const topics = pickTopItems(
    combined
      .toLowerCase()
      .match(/[a-z][a-z0-9_-]{3,}/g) ?? []
        .filter((word) => !STOPWORDS.has(word))
  );

  const tone = inferTone(combined);

  return {
    recent_topics: topics.length ? topics : ["build", "notes"],
    tone_7d: tone,
    wins: extractSignalLine(combined, /(shipped|done|completed|win|finished)/iu) ?? "Kept pushing work forward.",
    frictions:
      extractSignalLine(combined, /(blocked|risk|issue|failed|stress|debt|anxious)/iu) ??
      "Context switching is the main visible drag."
  };
}

function inferTone(text: string): string {
  const lower = text.toLowerCase();
  if (/(anxious|stressed|overloaded|deadline|sleep debt)/u.test(lower)) {
    return "anxious, determined";
  }

  if (/(steady|calm|rhythm|routine)/u.test(lower)) {
    return "steady";
  }

  if (/(shipped|momentum|win|excited)/u.test(lower)) {
    return "energized";
  }

  return "neutral";
}

function extractSignalLine(text: string, pattern: RegExp): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => pattern.test(line)) ?? null;
}
