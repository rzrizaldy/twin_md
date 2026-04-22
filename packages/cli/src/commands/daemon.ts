import { spawn } from "node:child_process";
import { readFile, writeFile, unlink, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  appendReminderLedger,
  ensureSeedTwin,
  evaluateReminders,
  getClaudeDir,
  getPendingReminders,
  interpretTwinDocument,
  readCurrentTwinDocument,
  readReminderLedger,
  readTwinConfigOrDefault,
  runTwinHarvest,
  writePetState,
  type Reminder,
  type TwinConfig
} from "@twin-md/core/server";

const DEFAULT_INTERVAL_MINUTES = 15;

type DaemonSubcommand = "start" | "stop" | "status" | "run";

export type DaemonOptions = {
  interval?: number;
  once?: boolean;
  foreground?: boolean;
};

function getDaemonPidPath(): string {
  return path.join(getClaudeDir(), "twin-daemon.pid");
}

function getDaemonLogPath(): string {
  return path.join(getClaudeDir(), "twin-daemon.log");
}

export async function runDaemonCommand(
  subcommand: DaemonSubcommand,
  options: DaemonOptions = {}
): Promise<void> {
  switch (subcommand) {
    case "start":
      await startDaemon(options);
      return;
    case "stop":
      await stopDaemon();
      return;
    case "status":
      await statusDaemon();
      return;
    case "run":
      await runLoop(options);
      return;
    default:
      throw new Error(`Unknown daemon subcommand: ${subcommand}`);
  }
}

async function startDaemon(options: DaemonOptions): Promise<void> {
  const existing = await readPidFile();
  if (existing && isAlive(existing)) {
    console.log(`twin daemon already running (pid ${existing}).`);
    return;
  }

  if (options.foreground) {
    await runLoop(options);
    return;
  }

  await mkdir(getClaudeDir(), { recursive: true });

  const entry = process.argv[1];
  const args = [entry, "daemon", "run"];
  if (options.interval !== undefined) {
    args.push("--interval", String(options.interval));
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, TWIN_DAEMON_CHILD: "1" }
  });

  child.unref();

  if (!child.pid) {
    throw new Error("failed to spawn twin daemon");
  }

  await writePidFile(child.pid);
  console.log(`twin daemon started (pid ${child.pid}).`);
  console.log(`logs: ${getDaemonLogPath()}`);
  console.log(`stop it with: twin daemon stop`);
}

async function stopDaemon(): Promise<void> {
  const pid = await readPidFile();
  if (!pid) {
    console.log("twin daemon is not running (no pid file).");
    return;
  }

  if (!isAlive(pid)) {
    console.log(`twin daemon was not alive (pid ${pid}); clearing pid file.`);
    await clearPidFile();
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`sent SIGTERM to twin daemon (pid ${pid}).`);
  } catch (error) {
    console.error(
      `failed to stop twin daemon (pid ${pid}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    if (!isAlive(pid)) {
      break;
    }
    await sleep(200);
  }

  await clearPidFile();
  console.log("twin daemon stopped.");
}

async function statusDaemon(): Promise<void> {
  const pid = await readPidFile();
  if (!pid) {
    console.log("twin daemon: stopped.");
    return;
  }

  if (!isAlive(pid)) {
    console.log(`twin daemon: stale pid ${pid} (process not alive).`);
    return;
  }

  const pending = getPendingReminders(await readReminderLedger());
  console.log(`twin daemon: running (pid ${pid}).`);
  console.log(`logs: ${getDaemonLogPath()}`);
  console.log(`pending reminders: ${pending.length}`);
  for (const reminder of pending.slice(-5)) {
    console.log(`  - [${reminder.tone}] ${reminder.title} :: ${reminder.body}`);
  }
}

async function runLoop(options: DaemonOptions): Promise<void> {
  const intervalMs =
    Math.max(1, options.interval ?? DEFAULT_INTERVAL_MINUTES) * 60_000;

  // If we are the detached child, claim the pid file.
  if (process.env.TWIN_DAEMON_CHILD === "1") {
    await writePidFile(process.pid);
  }

  let stopping = false;
  const stop = async () => {
    stopping = true;
    await clearPidFile().catch(() => undefined);
    await logLine(`twin daemon stopping (pid ${process.pid})`);
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  await logLine(
    `twin daemon loop started (pid ${process.pid}, interval ${intervalMs / 60_000}min)`
  );

  while (!stopping) {
    try {
      const config = await readTwinConfigOrDefault();
      const result = await tick(config);
      await logLine(
        `tick: state=${result.state.state} fresh_reminders=${result.fresh.length} pending=${result.pendingCount}`
      );
    } catch (error) {
      await logLine(
        `tick failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
      );
    }

    if (options.once) {
      break;
    }

    await sleep(intervalMs);
  }

  await clearPidFile().catch(() => undefined);
}

type TickResult = {
  state: { state: string };
  fresh: Reminder[];
  pendingCount: number;
};

async function tick(config: TwinConfig): Promise<TickResult> {
  // Harvest fresh state.
  let document;
  let state;
  try {
    const harvest = await runTwinHarvest(config);
    document = harvest.document;
    state = harvest.state;
  } catch {
    // Fallback: read current document + interpret without full harvest (e.g. sources missing).
    document = await readCurrentTwinDocument(config).catch(() =>
      ensureSeedTwin(config)
    );
    state = await interpretTwinDocument(document, config);
    await writePetState(state);
  }

  const existing = await readReminderLedger();
  const fresh = evaluateReminders({
    document,
    state,
    now: new Date(),
    existing
  });

  if (fresh.length > 0) {
    await appendReminderLedger(fresh);
    for (const reminder of fresh) {
      await fireNotification(reminder).catch(async (error) => {
        await logLine(
          `notification failed for ${reminder.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }
  }

  const pending = getPendingReminders([...existing, ...fresh]);
  return { state, fresh, pendingCount: pending.length };
}

async function fireNotification(reminder: Reminder): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  const title = `twin · ${reminder.title}`;
  const body = reminder.body;
  const subtitle = `state: ${reminder.state}`;
  const script = [
    "display notification",
    escapeAppleScript(body),
    "with title",
    escapeAppleScript(title),
    "subtitle",
    escapeAppleScript(subtitle)
  ].join(" ");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`osascript exited with code ${code}`));
      }
    });
  });
}

function escapeAppleScript(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function writePidFile(pid: number): Promise<void> {
  await mkdir(getClaudeDir(), { recursive: true });
  await writeFile(getDaemonPidPath(), `${pid}\n`, "utf8");
}

async function readPidFile(): Promise<number | null> {
  try {
    const raw = await readFile(getDaemonPidPath(), "utf8");
    const pid = Number(raw.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function clearPidFile(): Promise<void> {
  try {
    await unlink(getDaemonPidPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function logLine(message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    await mkdir(getClaudeDir(), { recursive: true });
    await appendFile(getDaemonLogPath(), line);
  } catch {
    // swallow; the daemon must never crash on logging
  }
}
