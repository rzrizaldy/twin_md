import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  getTwinMdPath,
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readTwinConfigOrDefault,
  runTwinHarvest,
  speakWithTwin,
  writePetState
} from "@twin/core";

export async function startTwinMcpServer(): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const server = new McpServer(
    { name: "twin-md", version: "0.1.0" },
    {
      instructions:
        "Use get_twin_status to inspect the pet. Use refresh_twin after local source changes. twin_talk speaks in mirror voice from the local twin.md state."
    }
  );

  server.registerTool(
    "get_twin_status",
    {
      title: "Get Twin Status",
      description: "Return the current twin pet state and twin.md path.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      const document = await readCurrentTwinDocument(config);
      const state =
        (await readCurrentTwinState()) ??
        (await interpretTwinDocument(document, config));
      await writePetState(state);

      const output = {
        twinMdPath: getTwinMdPath(),
        state
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "refresh_twin",
    {
      title: "Refresh Twin",
      description: "Harvest local sources and refresh twin.md plus pet state."
    },
    async () => {
      const result = await runTwinHarvest(config);
      const output = {
        twinMdPath: result.twinMdPath,
        statePath: result.statePath,
        snapshotPath: result.snapshotPath,
        state: result.state
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "twin_talk",
    {
      title: "Twin Talk",
      description: "Ask the mirror-pet a question grounded in the current twin.md state.",
      inputSchema: z.object({
        prompt: z.string().min(1)
      })
    },
    async ({ prompt }) => {
      const document = await readCurrentTwinDocument(config);
      const state =
        (await readCurrentTwinState()) ??
        (await interpretTwinDocument(document, config));
      const reply = await speakWithTwin(document, state, prompt, config);

      return {
        content: [{ type: "text", text: reply }],
        structuredContent: {
          reply,
          state
        }
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
