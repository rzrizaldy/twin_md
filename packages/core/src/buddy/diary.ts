import path from "node:path";
import fs from "node:fs/promises";
import { appendBuddyMemory, readRecentBuddyMemory } from "./memory.js";

interface DiaryOptions {
  vaultPath: string;
  diaryEnabled?: boolean;
}

export async function appendBuddyDiary(
  entry: string,
  opts: DiaryOptions
): Promise<void> {
  if (opts.diaryEnabled === false) return;

  const today = new Date().toISOString().slice(0, 10);
  const notePath = path.join(opts.vaultPath, "daily-notes", `${today}.md`);
  const time = new Date().toTimeString().slice(0, 5);

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  const line = `\n- ${time} — ${entry}`;

  // Check if the diary section header already exists today
  let existing = "";
  try {
    existing = await fs.readFile(notePath, "utf8");
  } catch { /* file doesn't exist yet */ }

  if (!existing.includes("## twin-buddy diary")) {
    await fs.appendFile(notePath, `\n\n## twin-buddy diary\n`, "utf8");
  }

  await fs.appendFile(notePath, line, "utf8");

  // Also record in buddy memory
  await appendBuddyMemory({
    kind: "observation",
    body: entry,
    source: "claude",
    tags: ["diary"],
  });
}

export async function writeDailyClosingNote(opts: DiaryOptions): Promise<void> {
  const memories = await readRecentBuddyMemory(1);
  const todayObs = memories.filter((m) => m.kind === "observation" && m.tags?.includes("diary"));

  if (!todayObs.length) return;

  const wins = todayObs.filter((m) => /(shipped|done|completed|win|finished)/i.test(m.body));
  const todos = todayObs.filter((m) => /(todo|unfinished|pending)/i.test(m.body));

  const closingLine = [
    wins.length ? `${wins.length} win${wins.length > 1 ? "s" : ""}` : null,
    todos.length ? `${todos.length} unfinished thread${todos.length > 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  if (closingLine) {
    await appendBuddyDiary(`closing note: ${closingLine}.`, opts);
  }
}
