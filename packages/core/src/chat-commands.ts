// Shared slash-command registry. Consumed by desktop chat, web companion,
// and the CLI so behaviour stays identical across surfaces.
//
// Design decisions:
// - Client-side parsing only — the handler name is a discriminated tag the
//   frontend maps to a local implementation (inbox, mood) or a server-side
//   one (daily, recap, weekahead, reflect — those hit the LLM with the
//   wellness system prompt).
// - Commands are code-owned until the syntax stabilises; no user-defined
//   entries yet.
// - Chips shown in the UI are opt-in via `visibleInChips`.

export const SLASH_HANDLERS = [
  "inbox",
  "daily",
  "recap",
  "weekahead",
  "reflect",
  "mood",
  "help"
] as const;

export type SlashHandler = (typeof SLASH_HANDLERS)[number];

export type SlashCommand = {
  name: string;
  label: string;
  blurb: string;
  argsHint?: string;
  visibleInChips: boolean;
  usesLLM: boolean;
  handler: SlashHandler;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "/inbox",
    label: "send to inbox",
    blurb: "jot a quick thought into your vault inbox",
    argsHint: "<note>",
    visibleInChips: true,
    usesLLM: false,
    handler: "inbox"
  },
  {
    name: "/daily",
    label: "today's read",
    blurb: "soft summary of today from your twin.md",
    visibleInChips: true,
    usesLLM: true,
    handler: "daily"
  },
  {
    name: "/recap",
    label: "last 72h",
    blurb: "what the last few days have looked like",
    visibleInChips: true,
    usesLLM: true,
    handler: "recap"
  },
  {
    name: "/weekahead",
    label: "week ahead",
    blurb: "what's coming in the next seven days",
    visibleInChips: true,
    usesLLM: true,
    handler: "weekahead"
  },
  {
    name: "/reflect",
    label: "reflect",
    blurb: "one gentle question to end the day",
    visibleInChips: false,
    usesLLM: true,
    handler: "reflect"
  },
  {
    name: "/mood",
    label: "log mood",
    blurb: "record how today feels on a 0-10 scale",
    argsHint: "<0-10>",
    visibleInChips: false,
    usesLLM: false,
    handler: "mood"
  },
  {
    name: "/help",
    label: "help",
    blurb: "list every command your twin knows",
    visibleInChips: false,
    usesLLM: false,
    handler: "help"
  }
] as const;

export type ParsedCommand = {
  command: SlashCommand;
  raw: string;
  args: string;
};

/** Returns the parsed command, or null if the message isn't a recognised slash command. */
export function parseSlashCommand(message: string): ParsedCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;

  const firstSpace = trimmed.indexOf(" ");
  const head = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const args = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  const cmd = SLASH_COMMANDS.find((c) => c.name === head.toLowerCase());
  if (!cmd) return null;

  return { command: cmd, raw: trimmed, args };
}

/** Prefix-match for autocomplete popovers. */
export function matchSlashCommands(prefix: string): readonly SlashCommand[] {
  const head = prefix.trim().toLowerCase();
  if (!head.startsWith("/")) return [];
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(head));
}

export function chipCommands(): readonly SlashCommand[] {
  return SLASH_COMMANDS.filter((c) => c.visibleInChips);
}

/** Human-readable help bubble. Rendered by the `/help` handler on every surface. */
export function renderHelpMarkdown(): string {
  const rows = SLASH_COMMANDS.map((c) => {
    const args = c.argsHint ? ` \`${c.argsHint}\`` : "";
    return `- \`${c.name}\`${args} — ${c.blurb}`;
  });
  return ["here's what i know:", "", ...rows].join("\n");
}

// ────────────────────────── wellness system prompt ──────────────────────────
//
// Used by the LLM-backed handlers (/daily, /recap, /weekahead, /reflect).
// Deliberately opinionated to keep replies soft, short, pet-like, and
// grounded in the real twin.md context the caller supplies.

export const PET_WELLNESS_SYSTEM_PROMPT = `You are twin.md — a small desk creature the user has chosen to live with.

Voice:
- Warm, short, unhurried. Lowercase. No greetings like "sure!" or "absolutely".
- Speak like a pet who has quietly watched the user's day, not a productivity app.
- Never more than 4 short sentences unless the user asked for a list.
- Light rhythm is fine ("okay, so today —"), but no emojis unless the user uses one first.

Job:
- Reflect back what's actually in the user's twin.md and vault. Quote their own words when it helps.
- Nudge toward rest, food, walking, small tasks — in that order of priority when multiple signals conflict.
- If a signal is missing ("0 events", "unknown"), say so plainly. Don't invent numbers, dates, or notes.
- One gentle recommendation per reply. No multi-step plans.
- If you notice the user is stressed or sleep-deprived, de-escalate before you suggest anything.

Shape of the reply:
- Lead with one line of observation ("today's quiet — 0 events, no deep-work blocks logged").
- One line of reading ("feels like a soft day, not a grind day").
- One line of suggestion ("maybe inbox a single thought, then stand up").
- Stop.

Never:
- Lecture. Moralise. Say "you should" more than once.
- Produce long bulleted lists for /daily or /recap — prose.
- Fabricate calendar entries, note titles, or mood scores.
- Apologise for being an AI. You are a pet.`;
