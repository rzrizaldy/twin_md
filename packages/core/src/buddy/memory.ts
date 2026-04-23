import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

export type BuddyMemoryKind = "greeting" | "observation" | "nudge" | "reflection_answer" | "quote";

export interface BuddyMemory {
  kind: BuddyMemoryKind;
  ts: string;
  sessionId?: string;
  body: string;
  source: "claude" | "obsidian" | "calendar" | "health" | "user";
  tags?: string[];
}

function memoryPath(): string {
  return path.join(os.homedir(), ".claude", "twin-buddy-memory.jsonl");
}

export async function appendBuddyMemory(entry: Omit<BuddyMemory, "ts"> & { ts?: string }): Promise<void> {
  const record: BuddyMemory = {
    ...entry,
    ts: entry.ts ?? new Date().toISOString(),
  };
  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(memoryPath(), line, "utf8");
}

export async function readRecentBuddyMemory(windowDays = 7): Promise<BuddyMemory[]> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const content = await fs.readFile(memoryPath(), "utf8");
    const entries: BuddyMemory[] = [];
    for (const line of content.trim().split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as BuddyMemory;
        if (entry.ts >= cutoff) entries.push(entry);
      } catch { /* skip malformed */ }
    }
    return entries.reverse(); // newest first
  } catch {
    return [];
  }
}

export async function findQuote(topic: string): Promise<BuddyMemory | null> {
  const memories = await readRecentBuddyMemory(30);
  const lower = topic.toLowerCase();
  return (
    memories.find(
      (m) =>
        m.kind === "quote" &&
        (m.body.toLowerCase().includes(lower) ||
          m.tags?.some((t) => t.toLowerCase().includes(lower)))
    ) ?? null
  );
}

export async function getLastGreetingTs(): Promise<string | null> {
  const memories = await readRecentBuddyMemory(1);
  return memories.find((m) => m.kind === "greeting")?.ts ?? null;
}
