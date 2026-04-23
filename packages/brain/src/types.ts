/**
 * Core types for @twin-md/brain — mirrors Tolaria's VaultEntry almost verbatim.
 * Convention: frontmatter `_*` keys are system-internal and excluded from `properties`.
 */

export interface BrainEntry {
  /** Absolute path to the markdown file. */
  path: string;
  /** Basename including `.md` extension. */
  filename: string;
  /** First H1 heading text, or stem of filename if none. */
  title: string;
  /** `type:` frontmatter — Mood | Diary | Session | Theme | Person | Observation | Type | null */
  type: string | null;
  /** `aliases:` frontmatter list. */
  aliases: string[];
  /**
   * Any frontmatter key whose value(s) contain `[[wikilinks]]`.
   * Keys: felt, mentioned, worked_on, belongs_to, related_to, or any user-defined key.
   * Values: resolved wikilink targets (stripped of `[[` `]]`).
   */
  relationships: Record<string, string[]>;
  /** All `[[wikilinks]]` found in the document body (not frontmatter). */
  outgoingLinks: string[];
  /** `status:` frontmatter — open | resolved | steady | spiky | null */
  status: string | null;
  /** Last-modified unix ms (from fs.stat). */
  modifiedAt: number | null;
  /** Creation unix ms (from fs.stat birthtime, may equal modifiedAt). */
  createdAt: number | null;
  /** Word count of the body text (post-frontmatter). */
  wordCount: number;
  /** First ~160 chars of body text for quick previews. */
  snippet: string | null;
  /**
   * Scalar frontmatter properties not captured by the typed fields above.
   * `_*` system keys are excluded entirely — they are data, not user content.
   */
  properties: Record<string, string>;
}

/** On-disk cache format written to `~/.claude/twin/cache/<vault-hash>.json`. */
export interface BrainCache {
  /** Schema version — bump to force full rescan when BrainEntry shape changes. */
  schemaVersion: 1;
  /** Git HEAD SHA at time of last write (used to diff against current HEAD). */
  gitHead: string | null;
  /** ISO timestamp of last write. */
  writtenAt: string;
  /** Map from absolute file path → BrainEntry. */
  entries: Record<string, BrainEntry>;
}

export const BRAIN_CACHE_SCHEMA_VERSION = 1 as const;
