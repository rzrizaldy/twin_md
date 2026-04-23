import { appendBuddyMemory, getLastGreetingTs } from "./memory.js";
import type { ClaudeHarvestResult } from "../harvest/claude.js";

const GREETING_COOLDOWN_HOURS = 3;

export interface GreetContext {
  claudeHarvest: ClaudeHarvestResult;
  obsidianTodos?: string[];
  ownerName?: string;
}

export async function shouldGreet(): Promise<boolean> {
  const lastTs = await getLastGreetingTs();
  if (!lastTs) return true;
  const elapsed = (Date.now() - new Date(lastTs).getTime()) / (1000 * 60 * 60);
  return elapsed >= GREETING_COOLDOWN_HOURS;
}

export function composeGreeting(ctx: GreetContext): string {
  const { claudeHarvest, obsidianTodos = [], ownerName } = ctx;
  const { recentLastUserMsg, stuckThreads, longSessionStreak } = claudeHarvest;

  const name = ownerName ? ` ${ownerName}` : "";

  if (longSessionStreak >= 3) {
    return `hey${name}. you've had deep sessions three days running — are you pacing yourself?`;
  }

  if (stuckThreads.length > 0) {
    const thread = stuckThreads[0];
    return `hey${name}. i saw the \`${thread}\` thread come up again — still on it, or swapping gears?`;
  }

  if (recentLastUserMsg) {
    const preview = recentLastUserMsg.slice(0, 80).replace(/\n/g, " ");
    return `hey${name}. last thing i noticed you asking: "${preview}" — how's that going?`;
  }

  if (obsidianTodos.length > 0) {
    return `hey${name}. there are ${obsidianTodos.length} open todos in your vault. one of them feeling louder than the others?`;
  }

  return `hey${name}. quiet morning. anything surfacing?`;
}

export async function recordGreeting(body: string, sessionId?: string): Promise<void> {
  await appendBuddyMemory({
    kind: "greeting",
    body,
    source: "claude",
    sessionId,
    tags: ["proactive"],
  });
}
