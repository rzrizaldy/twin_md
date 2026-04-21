import type { TwinConfig } from "../config.js";
import type { TwinSection } from "../schema.js";
import { safeReadText } from "./shared.js";

type CalendarEvent = {
  summary: string;
  start: Date | null;
  end: Date | null;
};

export async function harvestCalendarSignals(
  config: TwinConfig
): Promise<TwinSection> {
  const text = await safeReadText(config.calendarPath);
  if (!text) {
    return {
      events_today: 0,
      deep_work_blocks: 0,
      next_deadline: "untracked",
      density_score: 0
    };
  }

  const events = parseIcs(text);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const todaysEvents = events.filter((event) => {
    if (!event.start) {
      return false;
    }
    return event.start >= startOfDay && event.start <= endOfDay;
  });

  const deepWorkBlocks = todaysEvents.filter((event) => {
    const durationMinutes =
      event.start && event.end ? (event.end.getTime() - event.start.getTime()) / 60000 : 0;
    const title = event.summary.toLowerCase();
    return durationMinutes >= 90 || /deep work|focus|maker|coding|writing/u.test(title);
  }).length;

  const nextDeadline = events
    .filter((event) => event.start && event.start >= now)
    .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
    .find((event) => /deadline|submit|due|exam|presentation/u.test(event.summary.toLowerCase()));

  const todayMinutes = todaysEvents.reduce((total, event) => {
    if (!event.start || !event.end) {
      return total;
    }
    return total + Math.max(0, (event.end.getTime() - event.start.getTime()) / 60000);
  }, 0);

  return {
    events_today: todaysEvents.length,
    deep_work_blocks: deepWorkBlocks,
    next_deadline: nextDeadline
      ? `${nextDeadline.summary} — ${nextDeadline.start?.toISOString().slice(0, 10)}`
      : "untracked",
    density_score: Number(Math.min(1, todayMinutes / (8 * 60) + todaysEvents.length / 10).toFixed(2))
  };
}

function parseIcs(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const summary = extractField(block, "SUMMARY") ?? "Untitled";
    const start = parseIcsDate(extractField(block, "DTSTART"));
    const end = parseIcsDate(extractField(block, "DTEND"));
    events.push({ summary, start, end });
  }

  return events;
}

function extractField(block: string, fieldName: string): string | null {
  const regex = new RegExp(`^${fieldName}(?:;[^:]+)?:([^\\n\\r]+)$`, "m");
  const match = block.match(regex);
  return match?.[1]?.trim() ?? null;
}

function parseIcsDate(input: string | null): Date | null {
  if (!input) {
    return null;
  }

  if (/^\d{8}$/u.test(input)) {
    return new Date(
      `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}T00:00:00`
    );
  }

  if (/^\d{8}T\d{6}Z$/u.test(input)) {
    return new Date(
      `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}T${input.slice(9, 11)}:${input.slice(11, 13)}:${input.slice(13, 15)}Z`
    );
  }

  if (/^\d{8}T\d{6}$/u.test(input)) {
    return new Date(
      `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}T${input.slice(9, 11)}:${input.slice(11, 13)}:${input.slice(13, 15)}`
    );
  }

  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}
