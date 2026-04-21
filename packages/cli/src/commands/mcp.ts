import { startTwinMcpServer } from "@twin/mcp";

export async function runMcpCommand(): Promise<void> {
  await startTwinMcpServer();
}
