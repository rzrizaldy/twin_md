/**
 * Git shell-out helpers for @twin-md/brain.
 * All commands run in the brainPath directory. No provider-specific auth.
 * Error output is surfaced to the caller; never swallowed silently.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

/** Initialize a git repo in the brain directory. Safe to call on an existing repo. */
export async function gitInit(brainPath: string): Promise<void> {
  await run(brainPath, ["init"]);
}

/** Return HEAD SHA, or null if the repo has no commits yet. */
export async function gitHead(brainPath: string): Promise<string | null> {
  try {
    return await run(brainPath, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

/**
 * Return unstaged + staged dirty file paths (`git status --porcelain`).
 * Paths are relative to brainPath.
 */
export async function gitDirtyFiles(brainPath: string): Promise<string[]> {
  const out = await run(brainPath, ["status", "--porcelain"]);
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

/**
 * Return file paths that changed between two git SHAs.
 * Paths are relative to brainPath.
 */
export async function gitDiffFiles(
  brainPath: string,
  fromSha: string,
  toSha: string
): Promise<string[]> {
  const out = await run(brainPath, ["diff", "--name-only", `${fromSha}..${toSha}`]);
  if (!out) return [];
  return out.split("\n").filter(Boolean);
}

/** Stage all changes and commit with an auto-generated message. */
export async function gitCommit(brainPath: string, message: string): Promise<void> {
  await run(brainPath, ["add", "-A"]);
  try {
    await run(brainPath, ["commit", "-m", message]);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("nothing to commit")) return;
    throw err;
  }
}

/**
 * Return recent git log entries, grouped by day.
 * Format: `{ date, entries: [{ sha, subject, files }] }[]`
 */
export interface PulseEntry {
  sha: string;
  subject: string;
  date: string;
  files: string[];
}

export interface PulseDay {
  date: string;
  entries: PulseEntry[];
}

export async function gitPulse(
  brainPath: string,
  limit = 50
): Promise<PulseDay[]> {
  let log: string;
  try {
    log = await run(brainPath, [
      "log",
      `--max-count=${limit}`,
      "--name-only",
      "--format=COMMIT:%H|%ai|%s",
      "--diff-filter=ACDMR"
    ]);
  } catch {
    return [];
  }

  const days = new Map<string, PulseDay>();
  let current: PulseEntry | null = null;

  for (const line of log.split("\n")) {
    if (line.startsWith("COMMIT:")) {
      if (current) {
        const day = current.date.slice(0, 10);
        if (!days.has(day)) days.set(day, { date: day, entries: [] });
        days.get(day)!.entries.push(current);
      }
      const parts = line.slice(7).split("|");
      current = {
        sha: parts[0]!.slice(0, 8),
        date: parts[1]!,
        subject: parts[2] ?? "",
        files: []
      };
    } else if (current && line.trim()) {
      current.files.push(line.trim());
    }
  }
  if (current) {
    const day = current.date.slice(0, 10);
    if (!days.has(day)) days.set(day, { date: day, entries: [] });
    days.get(day)!.entries.push(current);
  }

  return Array.from(days.values());
}

/** Return the remote URL for `origin`, or null. */
export async function gitRemoteUrl(brainPath: string): Promise<string | null> {
  try {
    return await run(brainPath, ["remote", "get-url", "origin"]);
  } catch {
    return null;
  }
}

/** Add or update `origin` remote. Does NOT push — user's system git credentials do auth. */
export async function gitRemoteAdd(brainPath: string, url: string): Promise<void> {
  try {
    await run(brainPath, ["remote", "add", "origin", url]);
  } catch {
    await run(brainPath, ["remote", "set-url", "origin", url]);
  }
}

/** `git status --short` summary. */
export async function gitStatus(brainPath: string): Promise<string> {
  try {
    return await run(brainPath, ["status", "--short"]);
  } catch {
    return "";
  }
}
