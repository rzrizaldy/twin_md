import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  acknowledgeReminder,
  dismissReminder,
  getPendingReminders,
  getTwinMdPath,
  interpretTwinDocument,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readReminderLedger,
  readTwinConfigOrDefault,
  runReminderSweep,
  runTwinHarvest,
  speakWithTwin,
  writePetState
} from "@twin-md/core/server";

export async function startTwinMcpServer(): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const server = new McpServer(
    { name: "twin-md", version: "0.1.0" },
    {
      instructions: [
        "Use get_twin_status to inspect the pet and see pending reminders.",
        "Surface pending reminders to the user in plain language when relevant.",
        "Use acknowledge_reminder(id) when the user agrees to act on a reminder.",
        "Use dismiss_reminder(id) when the user waves one off.",
        "Use refresh_twin after local source changes.",
        "twin_talk speaks in mirror voice from the local twin.md state."
      ].join(" ")
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

      const sweep = await runReminderSweep(document, state);
      const pendingReminders = getPendingReminders(sweep.all);

      const output = {
        twinMdPath: getTwinMdPath(),
        state,
        pendingReminders
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "get_pending_reminders",
    {
      title: "Get Pending Reminders",
      description:
        "List reminders the sprite has fired but the user has not acknowledged or dismissed. Surface these proactively.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      const pendingReminders = getPendingReminders(await readReminderLedger());
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ pendingReminders }, null, 2)
          }
        ],
        structuredContent: { pendingReminders }
      };
    }
  );

  server.registerTool(
    "acknowledge_reminder",
    {
      title: "Acknowledge Reminder",
      description:
        "Mark a reminder acknowledged when the user agrees to act on it.",
      inputSchema: z.object({ id: z.string().min(1) })
    },
    async ({ id }) => {
      const reminder = await acknowledgeReminder(id);
      const output = { reminder, ok: reminder !== null };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "dismiss_reminder",
    {
      title: "Dismiss Reminder",
      description:
        "Mark a reminder dismissed when the user waves it off without acting.",
      inputSchema: z.object({ id: z.string().min(1) })
    },
    async ({ id }) => {
      const reminder = await dismissReminder(id);
      const output = { reminder, ok: reminder !== null };
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
