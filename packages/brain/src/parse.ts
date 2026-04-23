/**
 * Parse a single markdown file into a BrainEntry.
 * Uses gray-matter for frontmatter, then extracts links and body metadata.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { BrainEntry } from "./types.js";

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const H1_RE = /^#\s+(.+)$/m;
const SYSTEM_KEY_RE = /^_/;

function extractWikilinks(text: string): string[] {
  const links: string[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const raw = m[1]!.split("|")[0]!.trim();
    if (raw) links.push(raw);
  }
  return links;
}

function extractRelationships(frontmatter: Record<string, unknown>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (SYSTEM_KEY_RE.test(key)) continue;
    const values = Array.isArray(value) ? value : [value];
    const links: string[] = [];
    for (const v of values) {
      if (typeof v !== "string") continue;
      const found = extractWikilinks(v);
      links.push(...found);
    }
    if (links.length > 0) result[key] = links;
  }
  return result;
}

function scalarProperties(frontmatter: Record<string, unknown>): Record<string, string> {
  const skip = new Set(["type", "aliases", "status", "date", "mood", "felt",
    "mentioned", "worked_on", "belongs_to", "related_to"]);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (SYSTEM_KEY_RE.test(key)) continue;
    if (skip.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = String(value);
    }
  }
  return result;
}

function strVal(fm: Record<string, unknown>, key: string): string | null {
  const v = fm[key];
  return typeof v === "string" && v ? v : null;
}

function strList(fm: Record<string, unknown>, key: string): string[] {
  const v = fm[key];
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

export function parseMdFile(filePath: string): BrainEntry {
  const raw = readFileSync(filePath, "utf8");
  const { data: fm, content: body } = matter(raw);
  const frontmatter = fm as Record<string, unknown>;

  let stat: { mtimeMs: number; birthtimeMs: number } | null = null;
  try {
    stat = statSync(filePath);
  } catch {
    stat = null;
  }

  const h1 = H1_RE.exec(body);
  const stem = path.basename(filePath, ".md");
  const title = h1 ? h1[1]!.trim() : stem;

  const bodyWords = body.trim().split(/\s+/).filter(Boolean).length;
  const snippetText = body.replace(/#+\s/g, "").trim().slice(0, 160) || null;

  return {
    path: filePath,
    filename: path.basename(filePath),
    title,
    type: strVal(frontmatter, "type"),
    aliases: strList(frontmatter, "aliases"),
    relationships: extractRelationships(frontmatter),
    outgoingLinks: extractWikilinks(body),
    status: strVal(frontmatter, "status"),
    modifiedAt: stat?.mtimeMs ?? null,
    createdAt: stat?.birthtimeMs ?? null,
    wordCount: bodyWords,
    snippet: snippetText,
    properties: scalarProperties(frontmatter)
  };
}
