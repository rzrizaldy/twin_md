import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";

export const DEFAULT_SOURCE_DIR = "~/twin-sources";

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function getClaudeDir(): string {
  return expandHome(process.env.TWIN_CLAUDE_DIR ?? "~/.claude");
}

export function getTwinConfigPath(): string {
  return path.join(getClaudeDir(), "twin.config.json");
}

export function getTwinMdPath(): string {
  return path.join(getClaudeDir(), "twin.md");
}

export function getTwinStatePath(): string {
  return path.join(getClaudeDir(), "twin-state.json");
}

export function getTwinHistoryDir(): string {
  return path.join(getClaudeDir(), "twin-history");
}

export function getClaudeDesktopConfigPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Claude",
    "claude_desktop_config.json"
  );
}

export async function ensureTwinRuntimeDirs(): Promise<void> {
  await Promise.all([
    mkdir(getClaudeDir(), { recursive: true }),
    mkdir(getTwinHistoryDir(), { recursive: true })
  ]);
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export function snapshotFileName(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-") + ".md";
}
