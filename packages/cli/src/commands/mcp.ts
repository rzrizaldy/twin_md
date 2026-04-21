import { startTwinMcpServer } from "@twin-md/mcp";

export async function runMcpCommand(): Promise<void> {
  await startTwinMcpServer();
}
