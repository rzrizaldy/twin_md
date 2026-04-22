import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { TwinConfig } from "./config.js";
import type { PetState } from "./interpret.js";
import type { TwinDocument } from "./schema.js";

// English + Indonesian / Bahasa triggers
const TIRED_RE = /tired|exhausted|drained|burnout|cape|capek|lelah|ngantuk|kecapekan/i;
const STRESS_RE = /stress(ed)?|overwhelm|anxious|pusing|overwhelm|stres|panik|pressure/i;
const BEHIND_RE = /behind|falling|late|deadline|ketinggalan|telat|terlambat|nunggak/i;
const WORKING_ON_RE = /working on|going on|lately|this week|today|recent|lagi ngapain|ngerjain apa|lagi ngerjain|seminggu ini|hari ini|belakangan/i;
const GENERAL_RE = /notes|brain|obsidian|todo|task|sleep|energy|health|tidur|tugas|deadline|how.*doing|gimana|kenapa|why/i;

const ALL_TRIGGERS = [TIRED_RE, STRESS_RE, BEHIND_RE, WORKING_ON_RE, GENERAL_RE];

export function isContextQuestion(prompt: string): boolean {
  return ALL_TRIGGERS.some((re) => re.test(prompt));
}

type MilestoneEntry = { name: string; date: string; status: "done" | "inprogress" | "pending" };

type VaultSnapshot = {
  goals: string;
  projects: string;
  inboxTitles: string[];
  conceptSummaries: Array<{ title: string; summary: string }>;
  milestones: MilestoneEntry[];
};

type ClaudeSnapshot = {
  naturalLanguagePrompts: string[];
};

// ── Vault readers ──────────────────────────────────────────────────────────────

async function readVaultSnapshot(vaultPath: string): Promise<VaultSnapshot> {
  const [goals, projects] = await Promise.all([
    tryReadFile(path.join(vaultPath, "1. 🗺️ Areas", "goals", "README.md"), 6000),
    tryReadFile(path.join(vaultPath, "1. 🗺️ Areas", "projects", "README.md"), 4000)
  ]);

  const inboxTitles = await listMarkdownTitles(path.join(vaultPath, "📥 Inbox"));
  const conceptSummaries = await readConceptSummaries(path.join(vaultPath, "2. 🧠 Wiki", "concepts"));
  const milestones = parseMilestones(goals + "\n" + projects);

  return { goals, projects, inboxTitles, conceptSummaries, milestones };
}

async function readConceptSummaries(
  conceptDir: string
): Promise<Array<{ title: string; summary: string }>> {
  try {
    const entries = await readdir(conceptDir);
    const mdFiles = entries.filter((e) => e.endsWith(".md") && !e.startsWith("README")).slice(0, 8);

    const results = await Promise.all(
      mdFiles.map(async (filename) => {
        const title = filename.replace(/^Concept - /, "").replace(/\.md$/, "");
        const content = await tryReadFile(path.join(conceptDir, filename), 300);
        // Extract first non-frontmatter line that looks like a definition
        const lines = content.split("\n").filter((l) => !l.startsWith("---") && !l.startsWith("#") && l.trim().length > 20);
        const summary = lines[0]?.trim().slice(0, 120) ?? "";
        return { title, summary };
      })
    );
    return results.filter((r) => r.title.length > 0);
  } catch {
    return [];
  }
}

// ── Claude history readers ─────────────────────────────────────────────────────

async function readClaudeSnapshot(claudeDir: string): Promise<ClaudeSnapshot> {
  // history.jsonl has first-message display text for each session
  const historyPath = path.join(claudeDir, "history.jsonl");
  const raw = await tryReadFile(historyPath, 8000);

  const naturalLanguagePrompts: string[] = [];

  if (raw) {
    const lines = raw.split("\n").filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { display?: string };
        const text = entry.display?.trim() ?? "";
        if (
          text.length > 8 &&
          text.length < 300 &&
          !text.startsWith("/") &&
          !text.startsWith("I am running") &&
          !text.startsWith("<") &&
          !text.includes("Base directory for this skill")
        ) {
          naturalLanguagePrompts.push(text);
          if (naturalLanguagePrompts.length >= 12) break;
        }
      } catch {
        // skip
      }
    }
  }

  // Also scan the most recent 3 project session files for human messages
  try {
    const projectDir = path.join(claudeDir, "projects", "-Users-rzrizaldy");
    const sessionFiles = await getMostRecentJsonlFiles(projectDir, 3);

    for (const sf of sessionFiles) {
      const sfRaw = await tryReadFile(sf, 30000);
      const sfLines = sfRaw.split("\n").filter(Boolean);
      for (const line of sfLines) {
        try {
          const e = JSON.parse(line) as { message?: { role?: string; content?: unknown } };
          const msg = e.message;
          if (!msg || (msg.role !== "human" && msg.role !== "user")) continue;

          let text = "";
          if (Array.isArray(msg.content)) {
            for (const c of msg.content as Array<{ type?: string; text?: string }>) {
              if (c.type === "text") text += c.text ?? "";
            }
          } else if (typeof msg.content === "string") {
            text = msg.content;
          }

          text = text.trim();
          if (
            text.length > 10 &&
            text.length < 300 &&
            !text.startsWith("/") &&
            !text.startsWith("<") &&
            !text.includes("Base directory for this skill") &&
            !text.includes("Caveat:")
          ) {
            naturalLanguagePrompts.push(text);
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // project dir may not exist
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of naturalLanguagePrompts) {
    const key = p.slice(0, 60).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }

  return { naturalLanguagePrompts: deduped.slice(0, 15) };
}

async function getMostRecentJsonlFiles(dir: string, count: number): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    const jsonlFiles = entries.filter((e) => e.endsWith(".jsonl"));

    const withMtime = await Promise.all(
      jsonlFiles.map(async (f) => {
        const fp = path.join(dir, f);
        try {
          const s = await stat(fp);
          return { fp, mtime: s.mtimeMs };
        } catch {
          return { fp, mtime: 0 };
        }
      })
    );

    return withMtime
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, count)
      .map((x) => x.fp);
  } catch {
    return [];
  }
}

// ── Parsers ────────────────────────────────────────────────────────────────────

function parseMilestones(combined: string): MilestoneEntry[] {
  const results: MilestoneEntry[] = [];
  // Match markdown table rows: | Name | Date | Status emoji |
  const tableRowRe = /\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/g;
  let m: RegExpExecArray | null;

  while ((m = tableRowRe.exec(combined)) !== null) {
    const [, rawName, rawDate, rawStatus] = m;
    if (!rawName || rawName.toLowerCase().includes("milestone") || rawName.trim().startsWith("-")) continue;

    const name = rawName.replace(/[*_`#]/g, "").trim();
    const date = rawDate.replace(/[*_`]/g, "").trim();
    const statusStr = rawStatus.trim();

    let status: MilestoneEntry["status"] = "pending";
    if (/✅|done|completed|submitted|passed|graded/i.test(statusStr)) status = "done";
    else if (/⚠️|🔄|in progress|ongoing|working/i.test(statusStr)) status = "inprogress";

    if (name && name.length > 3 && name.length < 80 && !name.toLowerCase().includes("target date")) {
      results.push({ name, date, status });
    }
  }

  return results;
}

function extractOpenTodos(combined: string): string[] {
  const lines = combined.split("\n");
  return lines
    .filter((l) => /- \[ \]/.test(l))
    .map((l) => l.replace(/- \[ \]\s*/, "").replace(/[*_`]/g, "").trim())
    .filter((l) => l.length > 4 && l.length < 100)
    .slice(0, 5);
}

// ── Reply builders ─────────────────────────────────────────────────────────────

function buildTiredReply(
  doc: TwinDocument,
  state: PetState,
  vault: VaultSnapshot,
  claude: ClaudeSnapshot
): string {
  const { health } = doc.sections;
  const sleep = health.sleep_last_night as string;
  const avg = health.sleep_7d_avg as string;
  const hrv = health.hrv_7d as string;
  const steps = health.steps_today as number;
  const workouts = health.workouts_7d as number;

  const parts: string[] = [];

  // Health signals
  if (sleep !== "unknown" && sleep !== "0" && sleep) {
    parts.push(`Tidur semalam: ${sleep}`);
  } else {
    parts.push("Sleep data belum ditrack — ga bisa tau persis recovery lo");
  }
  if (avg !== "unknown" && avg) parts.push(`Rata-rata 7 hari: ${avg}`);
  if (hrv !== "unknown" && hrv) parts.push(`HRV: ${hrv} (indikator stress fisik)`);
  if (steps > 0) parts.push(`${steps} langkah hari ini — badan udah gerak`);
  else parts.push("Hampir ga ada gerakan hari ini");
  if (workouts === 0) parts.push("Ga ada workout minggu ini — badan butuh olahraga");

  // Active work pressure
  const inprogress = vault.milestones.filter((m) => m.status === "inprogress");
  if (inprogress.length > 0) {
    parts.push(
      `${inprogress.length} hal masih jalan: ${inprogress.map((m) => m.name).join(", ")}`
    );
  }

  const openTodos = extractOpenTodos(vault.goals + vault.projects);
  if (openTodos.length > 0) {
    parts.push(`Open tasks:\n  ${openTodos.join("\n  ")}`);
  }

  const obs = doc.sections.obsidian_signals;
  if ((obs.unfinished_todos as number) > 0) {
    parts.push(`${obs.unfinished_todos} unfinished todos di vault`);
  }
  if ((obs.daily_note_streak as number) === 0) {
    parts.push("Daily note streak break — rutinitas lagi drift");
  }

  // Recent mental load from Claude
  const recentWork = claude.naturalLanguagePrompts
    .filter((p) => !p.startsWith("/") && p.length > 15)
    .slice(0, 3);
  if (recentWork.length > 0) {
    parts.push(`Otak lo lagi dipakai buat:\n  ${recentWork.join("\n  ")}`);
  }

  const { tone_7d } = doc.sections.claude_memory_signals;
  if (tone_7d && tone_7d !== "neutral") {
    parts.push(`Tone minggu ini: ${tone_7d}`);
  }

  return `Ini yang bisa gue baca dari lo:\n\n${parts.map((p) => `• ${p}`).join("\n")}`;
}

function buildStressReply(
  doc: TwinDocument,
  state: PetState,
  vault: VaultSnapshot,
  claude: ClaudeSnapshot
): string {
  const cal = doc.sections.calendar;
  const parts: string[] = [];

  const events = cal.events_today as number;
  const deepWork = cal.deep_work_blocks as number;
  const density = cal.density_score as number;
  const deadline = cal.next_deadline as string;

  if (events > 5) parts.push(`${events} event hari ini — context switching berat`);
  else if (events > 0) parts.push(`${events} event di kalender hari ini`);
  if (deepWork === 0 && events > 0) parts.push("Ga ada deep work block — waktu fokus abis buat meeting");
  if (density > 7) parts.push(`Density kalender: ${density}/10 — padet banget`);
  if (deadline && deadline !== "untracked") parts.push(`Deadline terdekat: ${deadline}`);

  const inprogress = vault.milestones.filter((m) => m.status === "inprogress");
  if (inprogress.length > 0) {
    parts.push(`Masih jalan: ${inprogress.map((m) => `${m.name} (${m.date})`).join(", ")}`);
  }

  if (vault.inboxTitles.length > 1) {
    parts.push(`Inbox belum diberesin: ${vault.inboxTitles.length} item pending`);
  }

  const openTodos = extractOpenTodos(vault.goals + vault.projects);
  if (openTodos.length > 0) {
    parts.push(`Open todos:\n  ${openTodos.join("\n  ")}`);
  }

  if (claude.naturalLanguagePrompts.length > 4) {
    parts.push(
      `Context switching banyak — banyak thread berbeda:\n  ${claude.naturalLanguagePrompts.slice(0, 3).join("\n  ")}`
    );
  }

  if (parts.length === 0) {
    return `${state.message} — stress signals ga keliatan jelas. Coba connect calendar atau health source dulu.`;
  }

  return `Sumber stress yang keliatan:\n\n${parts.map((p) => `• ${p}`).join("\n")}`;
}

function buildWorkingOnReply(
  doc: TwinDocument,
  vault: VaultSnapshot,
  claude: ClaudeSnapshot
): string {
  const mem = doc.sections.claude_memory_signals;
  const topics = (mem.recent_topics as string[]).filter(Boolean);
  const wins = mem.wins as string;
  const frictions = mem.frictions as string;

  const parts: string[] = [];

  // Active milestones
  const active = vault.milestones.filter((m) => m.status === "inprogress");
  const recent = vault.milestones.filter((m) => m.status === "done").slice(-3);
  if (active.length > 0) {
    parts.push(`Lagi jalan:\n  ${active.map((m) => `${m.name} — ${m.date}`).join("\n  ")}`);
  }
  if (recent.length > 0) {
    parts.push(`Baru kelar:\n  ${recent.map((m) => m.name).join(", ")}`);
  }

  // Claude work
  if (topics.length > 0) {
    parts.push(`Topik di Claude belakangan: ${topics.slice(0, 5).join(", ")}`);
  }
  if (claude.naturalLanguagePrompts.length > 0) {
    parts.push(
      `Yang baru lo tanyain ke Claude:\n  ${claude.naturalLanguagePrompts.slice(0, 4).join("\n  ")}`
    );
  }

  // Vault knowledge
  if (vault.conceptSummaries.length > 0) {
    const summaries = vault.conceptSummaries.slice(0, 4).map((c) => c.title).join(", ");
    parts.push(`Konsep di notes: ${summaries}`);
  }

  if (vault.inboxTitles.length > 0) {
    parts.push(`Inbox: ${vault.inboxTitles.join(", ")}`);
  }

  if (wins) {
    const winLine = wins.split("\n").filter(Boolean)[0];
    if (winLine) parts.push(`Win terakhir: ${winLine.replace(/^[-*`\s]+|`/g, "").trim()}`);
  }

  if (frictions) {
    const frictionLine = frictions.split("\n").filter(Boolean)[0];
    if (frictionLine) parts.push(`Hambatan: ${frictionLine.replace(/^[-*`\s]+|`/g, "").trim()}`);
  }

  if (parts.length === 0) return "Belum cukup context nih. Coba pake Claude lebih sering sama vault yang konek.";

  return parts.join("\n\n");
}

function buildGenericContextReply(
  doc: TwinDocument,
  state: PetState,
  vault: VaultSnapshot,
  claude: ClaudeSnapshot
): string {
  const parts: string[] = [`Status: ${state.state} — ${state.caption}`];

  const mem = doc.sections.claude_memory_signals;
  const topics = (mem.recent_topics as string[]).filter(Boolean);
  if (topics.length > 0) parts.push(`Topik minggu ini: ${topics.join(", ")}`);

  if (claude.naturalLanguagePrompts.length > 0) {
    parts.push(`Sesi terakhir:\n  ${claude.naturalLanguagePrompts.slice(0, 3).join("\n  ")}`);
  }

  const inprogress = vault.milestones.filter((m) => m.status === "inprogress");
  if (inprogress.length > 0) {
    parts.push(`Masih jalan: ${inprogress.map((m) => m.name).join(", ")}`);
  }

  const obs = doc.sections.obsidian_signals;
  if (obs.last_reflection) {
    const r = obs.last_reflection as string;
    if (!r.includes("No vault") && !r.includes("No Obsidian")) {
      parts.push(`Refleksi terakhir di notes: "${r}"`);
    }
  }

  return parts.join("\n\n");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function tryReadFile(filePath: string, maxBytes = 1000): Promise<string> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.slice(0, maxBytes);
  } catch {
    return "";
  }
}

async function listMarkdownTitles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((e) => e.endsWith(".md") && !e.startsWith("README"))
      .map((e) => e.replace(/\.md$/, ""))
      .slice(0, 12);
  } catch {
    return [];
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function contextualReply(
  doc: TwinDocument,
  state: PetState,
  prompt: string,
  config: TwinConfig
): Promise<string> {
  const [vault, claude] = await Promise.all([
    config.obsidianVaultPath
      ? readVaultSnapshot(config.obsidianVaultPath)
      : Promise.resolve<VaultSnapshot>({
          goals: "",
          projects: "",
          inboxTitles: [],
          conceptSummaries: [],
          milestones: []
        }),
    readClaudeSnapshot(config.claudeDir)
  ]);

  if (TIRED_RE.test(prompt)) {
    return buildTiredReply(doc, state, vault, claude);
  }

  if (STRESS_RE.test(prompt) || BEHIND_RE.test(prompt)) {
    return buildStressReply(doc, state, vault, claude);
  }

  if (WORKING_ON_RE.test(prompt)) {
    return buildWorkingOnReply(doc, vault, claude);
  }

  return buildGenericContextReply(doc, state, vault, claude);
}
