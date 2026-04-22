// /mood <0-10> — append a mood line to the vault's daily note. Local-only.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import type { TwinConfig } from "../config.js";
import { expandHome } from "../paths.js";

export type MoodResult = {
  ok: boolean;
  path?: string;
  message: string;
};

function todayStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function timeStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export async function runMoodCommand(
  config: TwinConfig,
  rawArgs: string
): Promise<MoodResult> {
  const match = rawArgs.trim().match(/^(\d{1,2})(?:\s+(.*))?$/);
  if (!match) {
    return { ok: false, message: "try `/mood 7` or `/mood 4 rough morning`." };
  }
  const score = Number(match[1]);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    return { ok: false, message: "mood is a 0-10 scale. try `/mood 6`." };
  }
  const note = (match[2] ?? "").trim();

  const vault = config.obsidianVaultPath
    ? expandHome(config.obsidianVaultPath)
    : null;
  if (!vault) {
    return {
      ok: false,
      message: "no vault wired yet — set obsidianVaultPath in twin.config.json"
    };
  }

  const dailyDir = path.join(vault, "daily-notes");
  await mkdir(dailyDir, { recursive: true });
  const file = path.join(dailyDir, `${todayStamp()}.md`);

  const entry = note
    ? `- ${timeStamp()} mood ${score}/10 — ${note}\n`
    : `- ${timeStamp()} mood ${score}/10\n`;

  if (!existsSync(file)) {
    const header = `# ${todayStamp()}\n\n## mood\n${entry}`;
    await writeFile(file, header, "utf8");
  } else {
    const existing = await readFile(file, "utf8");
    if (!/##\s+mood/i.test(existing)) {
      const prefix = existing.endsWith("\n") ? "" : "\n";
      await appendFile(file, `${prefix}\n## mood\n${entry}`, "utf8");
    } else {
      const prefix = existing.endsWith("\n") ? "" : "\n";
      await appendFile(file, prefix + entry, "utf8");
    }
  }

  return {
    ok: true,
    path: file,
    message: `logged mood ${score}/10.${note ? " thanks for the note." : ""}`
  };
}
