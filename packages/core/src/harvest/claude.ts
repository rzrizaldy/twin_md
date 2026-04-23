import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type { TwinConfig } from "../config.js";
import type { TwinSection } from "../schema.js";
import { mostRecentFiles, pickTopItems, safeReadText, walkFiles } from "./shared.js";

const STOPWORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "have",
  "will", "your", "into", "when", "then", "them", "just", "like",
  "user", "users", "work", "code", "task", "turn", "they", "keep"
]);

export interface ClaudeSession {
  id: string;
  project: string;
  startedAt: string;
  endedAt: string;
  turnCount: number;
  userMsgLen: number;
  assistantMsgLen: number;
  lastUserMsg: string;
  topics: string[];
  emotionalTone: string;
  durationMinutes: number;
}

export interface ClaudeHarvestResult {
  sessions: ClaudeSession[];
  recentLastUserMsg: string;
  stuckThreads: string[];
  longSessionStreak: number;
  contextSwitches24h: number;
}

export async function harvestClaudeSessions(
  _config: TwinConfig
): Promise<ClaudeHarvestResult> {
  const claudeDir = path.join(os.homedir(), ".claude");
  const projectsDir = path.join(claudeDir, "projects");
  const sessions: ClaudeSession[] = [];

  try {
    const projects = await fs.readdir(projectsDir).catch(() => [] as string[]);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const project of projects) {
      const sessionsDir = path.join(projectsDir, project, "sessions");
      const sessionFiles = await fs.readdir(sessionsDir).catch(() => [] as string[]);

      for (const file of sessionFiles) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(sessionsDir, file);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat || stat.mtimeMs < sevenDaysAgo) continue;

        const session = await parseSessionFile(filePath, project, file.replace(".jsonl", ""));
        if (session) sessions.push(session);
      }
    }
  } catch {
    // projectsDir doesn't exist yet — return empty
  }

  // Sort by startedAt desc, cap at 30
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const recent = sessions.slice(0, 30);

  const recentLastUserMsg = recent.find((s) => s.lastUserMsg)?.lastUserMsg ?? "";
  const stuckThreads = findStuckThreads(recent);
  const longSessionStreak = computeLongSessionStreak(recent);
  const contextSwitches24h = countContextSwitches24h(recent);

  return { sessions: recent, recentLastUserMsg, stuckThreads, longSessionStreak, contextSwitches24h };
}

async function parseSessionFile(
  filePath: string,
  project: string,
  sessionId: string
): Promise<ClaudeSession | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    let startedAt = "";
    let endedAt = "";
    let turnCount = 0;
    let userMsgLen = 0;
    let assistantMsgLen = 0;
    let lastUserMsg = "";
    const allText: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const role = (entry["role"] as string) || (entry["type"] as string) || "";
        const msgObj = (entry["message"] as Record<string, unknown>) || entry;
        const content = extractContent(msgObj["content"] ?? entry["content"]);
        const ts = (entry["timestamp"] as string) || (entry["ts"] ? new Date((entry["ts"] as number) * 1000).toISOString() : "");

        if (ts) {
          if (!startedAt || ts < startedAt) startedAt = ts;
          if (!endedAt || ts > endedAt) endedAt = ts;
        }

        if (role === "user" || role === "human") {
          turnCount++;
          userMsgLen += content.length;
          if (content.trim()) lastUserMsg = content.trim().slice(0, 280);
          allText.push(content);
        } else if (role === "assistant") {
          assistantMsgLen += content.length;
          allText.push(content);
        }
      } catch { /* skip malformed line */ }
    }

    if (!turnCount) return null;

    const combined = allText.join(" ");
    const topics = pickTopItems(
      (combined.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? [])
        .filter((w) => !STOPWORDS.has(w))
    ).slice(0, 6);

    const durationMinutes = startedAt && endedAt
      ? Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000)
      : 0;

    return {
      id: sessionId,
      project,
      startedAt,
      endedAt,
      turnCount,
      userMsgLen,
      assistantMsgLen,
      lastUserMsg,
      topics,
      emotionalTone: inferTone(combined),
      durationMinutes,
    };
  } catch {
    return null;
  }
}

function extractContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null && "text" in item) {
          return String((item as Record<string, unknown>)["text"]);
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

function findStuckThreads(sessions: ClaudeSession[]): string[] {
  const topicCount: Record<string, number> = {};
  for (const s of sessions) {
    for (const t of s.topics) {
      topicCount[t] = (topicCount[t] ?? 0) + 1;
    }
  }
  return Object.entries(topicCount)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
}

function computeLongSessionStreak(sessions: ClaudeSession[]): number {
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const dayStr = day.toISOString().slice(0, 10);
    const dayTotal = sessions
      .filter((s) => s.startedAt.startsWith(dayStr))
      .reduce((acc, s) => acc + s.durationMinutes, 0);
    if (dayTotal >= 90) streak++;
    else break;
  }
  return streak;
}

function countContextSwitches24h(sessions: ClaudeSession[]): number {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const projects = new Set(
    sessions.filter((s) => s.startedAt >= cutoff).map((s) => s.project)
  );
  return projects.size;
}

// ─── Legacy TwinSection harvester (unchanged interface) ───────────────────────

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
  if (/(anxious|stressed|overloaded|deadline|sleep debt)/u.test(lower)) return "anxious, determined";
  if (/(steady|calm|rhythm|routine)/u.test(lower)) return "steady";
  if (/(shipped|momentum|win|excited)/u.test(lower)) return "energized";
  return "neutral";
}

function extractSignalLine(text: string, pattern: RegExp): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.find((line) => pattern.test(line)) ?? null;
}
