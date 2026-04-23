import { NextRequest, NextResponse } from "next/server";
import { readTwinConfigOrDefault } from "@twin-md/core/server";
import fs from "node:fs/promises";
import path from "node:path";

interface Turn {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

interface LogBody {
  sessionId: string;
  turns: Turn[];
}

export async function POST(request: NextRequest) {
  try {
    const body: LogBody = await request.json();
    const { sessionId, turns } = body;

    const config = await readTwinConfigOrDefault().catch(() => null);
    const vaultPath = config?.obsidianVaultPath;
    if (!vaultPath) {
      return NextResponse.json({ ok: false, error: "vault not configured" }, { status: 200 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const notePath = path.join(vaultPath, "daily-notes", `${today}.md`);

    // Build the transcript block
    const startTs = turns[0]?.ts ?? new Date().toISOString();
    const endTs = turns[turns.length - 1]?.ts ?? startTs;
    const startTime = new Date(startTs).toTimeString().slice(0, 5);
    const endTime = new Date(endTs).toTimeString().slice(0, 5);

    const lines = [
      `\n## twin-chat · ${startTime}-${endTime} · session ${sessionId}`,
      ...turns.map((t) => {
        const who = t.role === "user" ? "me" : "twin";
        return `> **${who}**: ${t.content.trim()}`;
      }),
      "",
    ];

    const block = lines.join("\n");

    // Ensure daily-notes dir exists
    await fs.mkdir(path.dirname(notePath), { recursive: true });

    // Append to daily note
    await fs.appendFile(notePath, block, "utf8");

    return NextResponse.json({ ok: true, written: notePath });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
