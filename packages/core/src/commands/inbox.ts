// /inbox <text> — create a titled markdown note inside the configured
// quick-notes folder. Purely local: never calls the LLM.

import { mkdir, writeFile } from "node:fs/promises";
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

function normalizeQuickNotesPath(raw: string | null | undefined): string {
  const cleaned = (raw ?? "inbox").trim().replace(/^\/+|\/+$/g, "");
  if (!cleaned) return "inbox";
  const parts = cleaned
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== "." && part !== "..");
  return parts.length > 0 ? parts.join(path.sep) : "inbox";
}

function cleanTitleSource(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*[-*]\s*(?:\[[ xX]\]\s*)?/, "")
    .replace(/[`*_#[\]()>:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function titleFromNote(body: string): string {
  const explicit = body.match(/(?:^|\n)\s*title\s*:\s*(.+)/i)?.[1];
  const source =
    explicit ??
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ??
    "";
  const title = toTitleCase(cleanTitleSource(source));
  return title || "Quick Note";
}

function bodyWithoutExplicitTitle(body: string): string {
  const stripped = body.replace(/^\s*title\s*:\s*.+(?:\r?\n)?/i, "").trim();
  return stripped || body;
}

function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "quick-note";
}

function uniqueNotePath(folder: string, slug: string): string {
  let candidate = path.join(folder, `${slug}.md`);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = path.join(folder, `${slug}-${counter}.md`);
    counter += 1;
  }
  return candidate;
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

  const quickNotesPath = normalizeQuickNotesPath(config.quickNotesPath);
  const quickNotesDir = path.join(vault, quickNotesPath);
  await mkdir(quickNotesDir, { recursive: true });
  const title = titleFromNote(body);
  const notePath = uniqueNotePath(quickNotesDir, slugify(title));
  const created = new Date().toISOString();
  const noteBody = bodyWithoutExplicitTitle(body);
  const content = [
    "---",
    `created: "${created}"`,
    `captured: "${formatStamp()}"`,
    'source: "twin.md /inbox"',
    "status: inbox",
    "---",
    "",
    `# ${title}`,
    "",
    noteBody,
    ""
  ].join("\n");

  await writeFile(notePath, content, "utf8");

  return {
    ok: true,
    path: notePath,
    message: `caught it. saved to \`${path.relative(vault, notePath)}\`.`
  };
}
