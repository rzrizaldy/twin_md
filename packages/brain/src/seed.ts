/**
 * Brain vault seeder — runs on `twin-md brain init`.
 * Creates the tree layout, git-inits, writes AGENTS.md + CLAUDE.md shim,
 * and seeds the six type definition documents.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gitInit, gitCommit } from "./git.js";

const DIRS = [
  "diary",
  "moods",
  "observations",
  "sessions",
  "themes",
  "people",
  "type"
] as const;

const AGENTS_MD = `# AGENTS.md

This is your twin-brain — a plain-text, git-backed second brain owned entirely by you.

## What lives here

| Folder | Contents |
|---|---|
| \`diary/\` | Daily diary entries (one file per day, type: Diary) |
| \`moods/\` | Mood check-ins (type: Mood) |
| \`observations/\` | Signal-detector observations from Claude sessions |
| \`sessions/\` | Summarised chat sessions |
| \`themes/\` | Recurring patterns or long-running threads |
| \`people/\` | People notes |
| \`type/\` | Type definitions — these define the vocabulary |

## Conventions

See \`docs/BRAIN_CONVENTIONS.md\` in the twin.md repo for the full field vocabulary.
Key fields: \`type:\`, \`status:\`, \`date:\`, \`mood:\`, \`felt:\`, \`mentioned:\`, \`worked_on:\`, \`belongs_to:\`, \`related_to:\`.
System fields (\`_icon\`, \`_color\`, etc.) are hidden from view — don't delete them.

## Privacy

Nothing here leaves your machine unless you explicitly run \`twin-md brain remote add <url>\`.
`;

const CLAUDE_MD = `<!-- This file intentionally short — canonical guidance is in AGENTS.md. -->
@import AGENTS.md
`;

const TYPE_DOCS: Array<{ slug: string; label: string; icon: string; color: string; order: number; description: string }> = [
  {
    slug: "mood",
    label: "Mood",
    icon: "🌤",
    color: "#fbbf24",
    order: 1,
    description: "A mood check-in. How you felt at a point in time."
  },
  {
    slug: "diary",
    label: "Diary",
    icon: "📖",
    color: "#a78bfa",
    order: 2,
    description: "A diary entry. Reflection, what happened, how it felt."
  },
  {
    slug: "session",
    label: "Session",
    icon: "💬",
    color: "#38bdf8",
    order: 3,
    description: "A summarised Claude session or work session."
  },
  {
    slug: "theme",
    label: "Theme",
    icon: "🧵",
    color: "#34d399",
    order: 4,
    description: "A recurring pattern, long-running thread, or area of life."
  },
  {
    slug: "person",
    label: "Person",
    icon: "🧑",
    color: "#f472b6",
    order: 5,
    description: "A person note — someone you interact with or think about."
  },
  {
    slug: "observation",
    label: "Observation",
    icon: "🔍",
    color: "#94a3b8",
    order: 6,
    description: "An observation captured by the signal detector from a Claude session."
  }
];

function typeDoc(t: typeof TYPE_DOCS[number]): string {
  return `---
type: Type
_icon: "${t.icon}"
_color: "${t.color}"
_order: ${t.order}
_sidebar_label: "${t.label}"
---

# ${t.label}

${t.description}
`;
}

const GITIGNORE = `# twin-md system cache (never versioned — it's regenerated on each sync)
.DS_Store
`;

export interface BrainInitOptions {
  brainPath: string;
  /** If true, skip git init (for testing). */
  noGit?: boolean;
  /** If true, skip seeding files that already exist. */
  skipExisting?: boolean;
}

export interface BrainInitResult {
  brainPath: string;
  created: boolean;
  files: string[];
}

export async function initBrain(opts: BrainInitOptions): Promise<BrainInitResult> {
  const { brainPath, noGit = false } = opts;
  const created = !existsSync(brainPath);

  mkdirSync(brainPath, { recursive: true });
  for (const dir of DIRS) {
    mkdirSync(path.join(brainPath, dir), { recursive: true });
  }

  const files: string[] = [];

  function write(rel: string, content: string) {
    const full = path.join(brainPath, rel);
    if (opts.skipExisting && existsSync(full)) return;
    writeFileSync(full, content, "utf8");
    files.push(rel);
  }

  write("AGENTS.md", AGENTS_MD);
  write("CLAUDE.md", CLAUDE_MD);
  write(".gitignore", GITIGNORE);

  for (const t of TYPE_DOCS) {
    write(`type/${t.slug}.md`, typeDoc(t));
  }

  if (!noGit) {
    await gitInit(brainPath);
    if (files.length > 0) {
      await gitCommit(brainPath, "twin-md brain init — scaffold vault");
    }
  }

  return { brainPath, created, files };
}
