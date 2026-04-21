import { Command } from "commander";
import { runHarvestCommand } from "./commands/harvest.js";
import { runInitCommand } from "./commands/init.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runWatchCommand } from "./commands/watch.js";
import { runWebCommand } from "./commands/web.js";

const program = new Command();

program
  .name("twin")
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
  .action(runInitCommand);

program.command("harvest").description("harvest local sources into twin.md").action(runHarvestCommand);
program.command("watch").description("render the terminal pet and watch twin files").action(runWatchCommand);
program.command("web").description("start the phone web surface").option("--port <port>", "port to bind", "3000").action(runWebCommand);
program.command("mcp").description("start the stdio MCP server").action(runMcpCommand);

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
