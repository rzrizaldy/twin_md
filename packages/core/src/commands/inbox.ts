// /inbox <text> — append a dated bullet to {vault}/inbox.md, creating the
// file if needed. Purely local: never calls the LLM.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import type { TwinConfig } from "../config.js";
import { expandHome } from "../paths.js";

export type InboxResult = {
  ok: boolean;
  path?: string;
  message: string;
};

function formatStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export async function runInboxCommand(
  config: TwinConfig,
  note: string
): Promise<InboxResult> {
  const body = note.trim();
  if (!body) {
    return { ok: false, message: "give me something to save — /inbox <note>" };
  }

  const vault = config.obsidianVaultPath
    ? expandHome(config.obsidianVaultPath)
    : null;
  if (!vault) {
    return {
      ok: false,
      message: "no vault wired yet — set obsidianVaultPath in twin.config.json"
    };
  }

  await mkdir(vault, { recursive: true });
  const inboxPath = path.join(vault, "inbox.md");
  const line = `- [ ] ${formatStamp()} ${body}\n`;

  if (!existsSync(inboxPath)) {
    const header = "# inbox\n\nquick captures from your twin. sort later.\n\n";
    await writeFile(inboxPath, header + line, "utf8");
  } else {
    // Make sure the file ends with a newline before appending.
    const current = await readFile(inboxPath, "utf8");
    const prefix = current.endsWith("\n") ? "" : "\n";
    await appendFile(inboxPath, prefix + line, "utf8");
  }

  return {
    ok: true,
    path: inboxPath,
    message: `caught it. saved to \`${path.basename(inboxPath)}\`.`
  };
}
