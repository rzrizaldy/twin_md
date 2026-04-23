import { Command } from "commander";
import { runDaemonCommand } from "./commands/daemon.js";
import { runHarvestCommand } from "./commands/harvest.js";
import { runInitCommand } from "./commands/init.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runWatchCommand } from "./commands/watch.js";
import { runWebCommand } from "./commands/web.js";
import {
  runBrainInitCommand,
  runBrainSyncCommand,
  runBrainStatusCommand,
  runBrainRemoteAddCommand,
  runPulseCommand,
  runDoctorCommand
} from "./commands/brain.js";

const program = new Command();

program
  .name("twin-md")
  .description("Local-first twin.md pet for terminal, MCP, and phone surfaces")
  .version("0.1.0");

program
  .command("init")
  .description("seed twin config, twin.md, and Claude Desktop MCP wiring")
  .option("--species <species>", "pet species")
  .option("--owner <owner>", "owner label")
  .option("--obsidian-vault <path>", "obsidian vault path")
  .option("--health-path <path>", "health json path")
  .option("--calendar-path <path>", "calendar ics path")
  .option("--location-path <path>", "location json path")
  .option("--provider <name>", "ai provider (anthropic | openai | gemini)")
  .option("--model <name>", "model id for the chosen provider")
  .option("--api-key <key>", "api key for the chosen provider")
  .action(runInitCommand);

program
  .command("harvest")
  .description("harvest local sources into twin.md")
  .option("-w, --watch", "re-harvest when Claude dir, vault, or export files change")
  .action(runHarvestCommand);
program.command("watch").description("render the terminal pet and watch twin files").action(runWatchCommand);
program
  .command("web")
  .description("start the island web mirror (web-lite on loopback by default)")
  .option("--port <port>", "port to bind", "4730")
  .option("--host <host>", "bind address (use 0.0.0.0 for LAN + QR)", "127.0.0.1")
  .option("--next", "legacy: run Next.js app from @twin-md/web instead")
  .option("--dev", "with --next: force next dev even if .next exists")
  .action(runWebCommand);
program.command("mcp").description("start the stdio MCP server").action(runMcpCommand);

const daemon = program
  .command("daemon")
  .description("background sprite daemon that harvests, infers state, and fires reminders");

daemon
  .command("start")
  .description("start the daemon detached in the background")
  .option("--interval <minutes>", "minutes between ticks", (value) => Number(value))
  .option("--foreground", "run in the foreground instead of detaching")
  .action((options: { interval?: number; foreground?: boolean }) =>
    runDaemonCommand("start", options)
  );

daemon
  .command("stop")
  .description("stop the running daemon")
  .action(() => runDaemonCommand("stop"));

daemon
  .command("status")
  .description("print daemon status and recent pending reminders")
  .action(() => runDaemonCommand("status"));

daemon
  .command("run")
  .description("internal: run the daemon loop in the current process")
  .option("--interval <minutes>", "minutes between ticks", (value) => Number(value))
  .option("--once", "run one tick then exit")
  .action((options: { interval?: number; once?: boolean }) =>
    runDaemonCommand("run", options)
  );

// ── Brain vault commands ──────────────────────────────────────────────────────

const brain = program
  .command("brain")
  .description("manage the twin-brain git vault");

brain
  .command("init")
  .description("create and git-init the brain vault, seed type definitions")
  .option("--path <path>", "path for the new vault (default: ~/twin-brain)")
  .option("--from <path>", "use an existing folder as the vault (skips existing files)")
  .option("--no-git", "skip git init (for testing)")
  .action((opts: { path?: string; from?: string; noGit?: boolean }) =>
    runBrainInitCommand(opts)
  );

brain
  .command("sync")
  .description("force full cache rebuild for the brain vault")
  .action(runBrainSyncCommand);

brain
  .command("status")
  .description("show git status and cache freshness for the brain vault")
  .action(runBrainStatusCommand);

brain
  .command("remote")
  .description("manage the brain vault's git remote")
  .addCommand(
    new Command("add")
      .description("add or update the origin remote (provider-agnostic; no OAuth stored)")
      .argument("<url>", "git remote URL")
      .action((url: string) => runBrainRemoteAddCommand(url))
  );

program
  .command("pulse")
  .description("show brain vault git activity grouped by day")
  .option("--limit <n>", "max commits to show", (v) => Number(v), 50)
  .action((opts: { limit?: number }) => runPulseCommand(opts));

program
  .command("doctor")
  .description("check health of all twin.md sources and the brain vault, print fixes")
  .action(runDoctorCommand);

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
