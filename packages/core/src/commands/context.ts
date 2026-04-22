// Build the factual context snippet that LLM-backed slash commands prepend
// to the user message. Keeps the LLM grounded in actual twin.md sections.

import type { TwinDocument, TwinSection } from "../schema.js";

function coerce(section: TwinSection | undefined, key: string): string {
  if (!section) return "unknown";
  const value = section[key];
  if (value === null || value === undefined) return "unknown";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  return String(value);
}

export function buildDailyContext(doc: TwinDocument): string {
  const health = doc.sections.health;
  const calendar = doc.sections.calendar;
  const now = doc.sections.now;
  const obs = doc.sections.obsidian_signals;

  return [
    `today: ${new Date().toISOString().slice(0, 10)}`,
    `sleep: ${coerce(health, "sleep_hours")}h`,
    `steps: ${coerce(health, "steps")}`,
    `hrv: ${coerce(health, "hrv_ms")}ms`,
    `calendar events today: ${coerce(calendar, "events_today")}`,
    `next event: ${coerce(calendar, "next_event")}`,
    `open tasks: ${coerce(obs, "open_tasks")}`,
    `active projects: ${coerce(obs, "active_projects")}`,
    `current mood: ${coerce(now, "mood")}`
  ].join("\n");
}

export function buildRecapContext(doc: TwinDocument): string {
  const health = doc.sections.health;
  const memory = doc.sections.claude_memory_signals;
  const obs = doc.sections.obsidian_signals;

  return [
    `recap window: last 72h`,
    `recent topics: ${coerce(memory, "recent_topics")}`,
    `memories touched: ${coerce(memory, "memory_count")}`,
    `closed tasks (7d): ${coerce(obs, "closed_tasks_7d")}`,
    `avg sleep (3d): ${coerce(health, "sleep_hours_3d_avg")}`,
    `mood trend: ${coerce(doc.sections.now, "mood_trend")}`
  ].join("\n");
}

export function buildWeekAheadContext(doc: TwinDocument): string {
  const cal = doc.sections.calendar;
  const obs = doc.sections.obsidian_signals;
  return [
    `week ahead window: next 7 days`,
    `events next 7d: ${coerce(cal, "events_next_7d")}`,
    `next event: ${coerce(cal, "next_event")}`,
    `active goals: ${coerce(obs, "active_goals")}`,
    `deadlines next 7d: ${coerce(obs, "deadlines_next_7d")}`
  ].join("\n");
}

export function buildReflectContext(doc: TwinDocument): string {
  const now = doc.sections.now;
  const obs = doc.sections.obsidian_signals;
  return [
    `today: ${new Date().toISOString().slice(0, 10)}`,
    `mood today: ${coerce(now, "mood")}`,
    `last reflection: ${coerce(obs, "last_reflection")}`,
    `open tasks: ${coerce(obs, "open_tasks")}`
  ].join("\n");
}
