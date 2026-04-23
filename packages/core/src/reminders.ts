import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ensureParentDir, getClaudeDir } from "./paths.js";
import type { PetState } from "./interpret.js";
import type { TwinDocument } from "./schema.js";

export const REMINDER_TONES = ["soft", "groggy", "clipped", "quiet"] as const;
export type ReminderTone = (typeof REMINDER_TONES)[number];

export const REMINDER_TIERS = ["nudge", "idle"] as const;
export type ReminderTier = (typeof REMINDER_TIERS)[number];

export const REMINDER_RULES = [
  "sleep_debt_morning",
  "calendar_crowded_no_deep_work",
  "todos_climbing",
  "home_ratio_high",
  "workouts_zero",
  "no_wins_logged",
  "idle_healthy",
  "idle_sleep_deprived",
  "idle_stressed",
  "idle_neglected",
  "claude_session_over_120m",
  "tone_shift_negative",
  "mood_streak_low"
] as const;
export type ReminderRuleId = (typeof REMINDER_RULES)[number];

export const ReminderSchema = z.object({
  id: z.string(),
  ruleId: z.enum(REMINDER_RULES),
  tier: z.enum(REMINDER_TIERS),
  tone: z.enum(REMINDER_TONES),
  state: z.enum(["healthy", "sleep_deprived", "stressed", "neglected"]),
  title: z.string(),
  body: z.string(),
  firedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  cooldownMinutes: z.number()
});

export type Reminder = z.infer<typeof ReminderSchema>;

const TONE_BY_STATE: Record<PetState["state"], ReminderTone> = {
  healthy: "soft",
  sleep_deprived: "groggy",
  stressed: "clipped",
  neglected: "quiet"
};

const COOLDOWN_MINUTES: Record<ReminderRuleId, number> = {
  sleep_debt_morning: 180,
  calendar_crowded_no_deep_work: 120,
  todos_climbing: 360,
  home_ratio_high: 720,
  workouts_zero: 720,
  no_wins_logged: 720,
  idle_healthy: 90,
  idle_sleep_deprived: 60,
  idle_stressed: 45,
  idle_neglected: 90,
  claude_session_over_120m: 120,
  tone_shift_negative: 480,
  mood_streak_low: 1440
};

export function getTwinRemindersPath(): string {
  return path.join(getClaudeDir(), "twin-reminders.jsonl");
}

type RuleInput = {
  document: TwinDocument;
  state: PetState;
  now: Date;
  existing: Reminder[];
};

type RuleCandidate = {
  ruleId: ReminderRuleId;
  tier: ReminderTier;
  title: string;
  body: string;
};

type Rule = (input: RuleInput) => RuleCandidate | null;

export function evaluateReminders(input: RuleInput): Reminder[] {
  const state = input.state.state;
  const tone = TONE_BY_STATE[state];
  const candidates = RULES.map((rule) => rule(input)).filter(
    (candidate): candidate is RuleCandidate => candidate !== null
  );

  const fresh: Reminder[] = [];
  for (const candidate of candidates) {
    if (isOnCooldown(candidate.ruleId, input.existing, input.now)) {
      continue;
    }

    fresh.push({
      id: randomUUID(),
      ruleId: candidate.ruleId,
      tier: candidate.tier,
      tone,
      state,
      title: candidate.title,
      body: candidate.body,
      firedAt: input.now.toISOString(),
      acknowledgedAt: null,
      dismissedAt: null,
      cooldownMinutes: COOLDOWN_MINUTES[candidate.ruleId]
    });
  }

  return fresh;
}

function isOnCooldown(
  ruleId: ReminderRuleId,
  existing: Reminder[],
  now: Date
): boolean {
  const cooldown = COOLDOWN_MINUTES[ruleId];
  const cutoff = now.getTime() - cooldown * 60_000;
  return existing.some((reminder) => {
    if (reminder.ruleId !== ruleId) {
      return false;
    }
    const fired = Date.parse(reminder.firedAt);
    if (Number.isNaN(fired)) {
      return false;
    }
    return fired >= cutoff;
  });
}

const RULES: Rule[] = [
  // Sleep debt in the morning
  ({ document, now }) => {
    const hours = durationToHours(document.sections.health.sleep_last_night);
    if (hours <= 0 || hours >= 6) {
      return null;
    }
    if (now.getHours() > 11) {
      return null;
    }
    const rounded = Math.round(hours * 10) / 10;
    return {
      ruleId: "sleep_debt_morning",
      tier: "nudge",
      title: "rough night?",
      body: `${rounded}h of sleep. can we slow down for the first hour.`
    };
  },

  // Calendar crowded + zero deep-work blocks
  ({ document }) => {
    const density = numberValue(document.sections.calendar.density_score);
    const deep = numberValue(document.sections.calendar.deep_work_blocks);
    if (density < 0.8 || deep > 0) {
      return null;
    }
    return {
      ruleId: "calendar_crowded_no_deep_work",
      tier: "nudge",
      title: "block 90 minutes",
      body: "the calendar is packed and there is zero deep-work space. pick one."
    };
  },

  // Todos climbing (we compare against history markers in existing reminders if available)
  ({ document }) => {
    const todos = numberValue(document.sections.obsidian_signals.unfinished_todos);
    if (todos < 12) {
      return null;
    }
    return {
      ruleId: "todos_climbing",
      tier: "nudge",
      title: "pick one todo",
      body: `${todos} unfinished in the vault. one of them, right now, is enough.`
    };
  },

  // Living inside for a week
  ({ document }) => {
    const ratio = Number(document.sections.location.home_ratio_7d);
    if (!Number.isFinite(ratio) || ratio < 0.95) {
      return null;
    }
    return {
      ruleId: "home_ratio_high",
      tier: "nudge",
      title: "go outside",
      body: "your feet have barely touched anywhere new this week."
    };
  },

  // No workouts 7d
  ({ document }) => {
    const workouts = numberValue(document.sections.health.workouts_7d);
    if (workouts > 0) {
      return null;
    }
    return {
      ruleId: "workouts_zero",
      tier: "nudge",
      title: "small walk?",
      body: "zero workouts logged this week. even a loop around the block counts."
    };
  },

  // No wins logged
  ({ document }) => {
    const wins = String(document.sections.claude_memory_signals.wins ?? "").trim();
    if (wins && !/none|untracked/i.test(wins)) {
      return null;
    }
    return {
      ruleId: "no_wins_logged",
      tier: "nudge",
      title: "name one win",
      body: "nothing logged as a win lately. even a small one resets the room."
    };
  },

  // State-tier idle chatter
  ({ state }) => {
    switch (state.state) {
      case "healthy":
        return {
          ruleId: "idle_healthy",
          tier: "idle",
          title: "still blooming",
          body: "the room is warm. let's keep the rhythm."
        };
      case "sleep_deprived":
        return {
          ruleId: "idle_sleep_deprived",
          tier: "idle",
          title: "just checking",
          body: "still groggy over here. water helps more than another tab."
        };
      case "stressed":
        return {
          ruleId: "idle_stressed",
          tier: "idle",
          title: "one at a time",
          body: "paper on the floor. one sheet. finish, then the next."
        };
      case "neglected":
        return {
          ruleId: "idle_neglected",
          tier: "idle",
          title: "…hi",
          body: "the corner is quiet. come back with one small thing."
        };
      default:
        return null;
    }
  },

  // Buddy: long Claude session passthrough template
  // Fired externally when harvestClaudeSessions detects a session with durationMinutes > 120.
  // This rule is a no-op in the normal sweep; callers inject directly via appendReminderLedger.
  () => null,

  // Buddy: tone shift — fired when recent claude tone is anxious/negative
  ({ document }) => {
    const tone = String(document.sections.claude_memory_signals.tone_7d ?? "").toLowerCase();
    if (!/(anxious|stressed|overloaded)/u.test(tone)) {
      return null;
    }
    return {
      ruleId: "tone_shift_negative",
      tier: "nudge",
      title: "noticed something",
      body: "your recent sessions have felt heavy. want to name what's underneath?"
    };
  },

  // Buddy: mood log streak low
  ({ document }) => {
    const mood = document.sections.now.mood_self_report;
    const score = typeof mood === "number" ? mood : Number(String(mood ?? "").replace(/[^\d]/g, ""));
    if (!Number.isFinite(score) || score > 4) {
      return null;
    }
    return {
      ruleId: "mood_streak_low",
      tier: "nudge",
      title: "low mood logged",
      body: "your last mood log was low. want to /reflect for a minute?"
    };
  }
];

export async function readReminderLedger(): Promise<Reminder[]> {
  const file = getTwinRemindersPath();
  try {
    const raw = await readFile(file, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return ReminderSchema.parse(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((reminder): reminder is Reminder => reminder !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function appendReminderLedger(entries: Reminder[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const file = getTwinRemindersPath();
  await ensureParentDir(file);
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await appendFile(file, lines);
}

export async function rewriteReminderLedger(entries: Reminder[]): Promise<void> {
  const file = getTwinRemindersPath();
  await ensureParentDir(file);
  await mkdir(path.dirname(file), { recursive: true });
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(file, body ? body + "\n" : "");
}

export function getPendingReminders(entries: Reminder[]): Reminder[] {
  return entries.filter(
    (reminder) => !reminder.acknowledgedAt && !reminder.dismissedAt
  );
}

export async function runReminderSweep(
  document: TwinDocument,
  state: PetState,
  now = new Date()
): Promise<{ fresh: Reminder[]; all: Reminder[] }> {
  const existing = await readReminderLedger();
  const fresh = evaluateReminders({ document, state, now, existing });
  if (fresh.length > 0) {
    await appendReminderLedger(fresh);
  }
  return { fresh, all: [...existing, ...fresh] };
}

export async function acknowledgeReminder(
  id: string,
  now = new Date()
): Promise<Reminder | null> {
  const entries = await readReminderLedger();
  let updated: Reminder | null = null;
  const next = entries.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }
    updated = { ...entry, acknowledgedAt: now.toISOString() };
    return updated;
  });
  if (!updated) {
    return null;
  }
  await rewriteReminderLedger(next);
  return updated;
}

export async function dismissReminder(
  id: string,
  now = new Date()
): Promise<Reminder | null> {
  const entries = await readReminderLedger();
  let updated: Reminder | null = null;
  const next = entries.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }
    updated = { ...entry, dismissedAt: now.toISOString() };
    return updated;
  });
  if (!updated) {
    return null;
  }
  await rewriteReminderLedger(next);
  return updated;
}

function durationToHours(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }
  const hours = text.match(/(\d+(?:\.\d+)?)\s*h/u);
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*m/u);
  if (hours || minutes) {
    return Number(hours?.[1] ?? 0) + Number(minutes?.[1] ?? 0) / 60;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  const numeric = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}
