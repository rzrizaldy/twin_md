import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  acknowledgeReminder,
  dismissReminder,
  getPendingReminders,
  getTwinMdPath,
  interpretTwinDocument,
  listTwinActionsByStatus,
  readCurrentTwinDocument,
  readCurrentTwinState,
  readReminderLedger,
  readTwinConfigOrDefault,
  runReminderSweep,
  runTwinHarvest,
  speakWithTwin,
  updateTwinAction,
  writePetState
} from "@twin-md/core/server";
import {
  scanBrainCached,
  parseMdFile,
  gitCommit
} from "@twin-md/brain";
import matter from "gray-matter";

function resolveBrainPath(config: { brainPath?: string }): string {
  return config.brainPath ?? path.join(os.homedir(), "twin-brain");
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeAbsPath(brainPath: string, notePath: string): string | null {
  const abs = path.isAbsolute(notePath)
    ? notePath
    : path.join(brainPath, notePath);
  if (!abs.startsWith(brainPath)) return null;
  return abs;
}

function patchFrontmatter(filePath: string, patch: Record<string, unknown>): void {
  const raw = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const { data, content } = matter(raw);
  const updated = { ...data, ...patch };
  writeFileSync(filePath, matter.stringify(content, updated), "utf8");
}

export async function startTwinMcpServer(): Promise<void> {
  const config = await readTwinConfigOrDefault();
  const brainPath = resolveBrainPath(config);

  const server = new McpServer(
    { name: "twin-md", version: "0.5.0" },
    {
      instructions: [
        "Use brain_context to orient yourself — it returns recent notes, entity types, and pet state.",
        "Use get_twin_status to inspect the pet and see pending reminders/actions.",
        "If brain_context or get_twin_status returns pendingTwinActions, execute them with your tools and then call resolve_twin_action.",
        "If it returns twinActionsNeedingApproval, tell the user to approve from terminal first; do not execute those yet.",
        "Surface pending reminders to the user in plain language when relevant.",
        "Use acknowledge_reminder(id) when the user agrees to act on a reminder.",
        "Use dismiss_reminder(id) when the user waves one off.",
        "Use refresh_twin after local source changes.",
        "twin_talk speaks in mirror voice from the local twin.md state.",
        "Use get_pending_twin_actions to see requests the desktop pet wants Claude Desktop to execute with its own tools.",
        "After acting, call resolve_twin_action so the pet can show the result.",
        "query_me must always cite the exact note paths that support the answer.",
        "Never write _* fields unless seeding a type definition."
      ].join(" ")
    }
  );

  // ── Tolaria-parity tools ──────────────────────────────────────────────────

  server.registerTool(
    "brain_context",
    {
      title: "Brain Context",
      description:
        "Return orientation context: entity types, 20 most recently modified notes, config files, and current pet state. Call this first when entering a new conversation.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      const entries = await scanBrainCached(brainPath).catch(() => []);
      const sorted = [...entries].sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
      const recent = sorted.slice(0, 20).map((e) => ({
        path: e.path,
        title: e.title,
        type: e.type,
        status: e.status,
        modifiedAt: e.modifiedAt
      }));

      const entityTypes = [...new Set(entries.map((e) => e.type).filter(Boolean))];

      const document = await readCurrentTwinDocument(config).catch(() => null);
      const state = document
        ? await readCurrentTwinState().catch(
            async () => interpretTwinDocument(document, config)
          )
        : null;

      const output = {
        brainPath,
        entityTypes,
        totalNotes: entries.length,
        recentNotes: recent,
        configFiles: [
          path.join(os.homedir(), ".claude", "twin.config.json"),
          path.join(brainPath, "AGENTS.md")
        ],
        petState: state,
        pendingTwinActions: listTwinActionsByStatus(["pending"]),
        twinActionsNeedingApproval: listTwinActionsByStatus(["needs_approval"])
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "open_note",
    {
      title: "Open Note",
      description: "Read the full contents of a note by path.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute or brainPath-relative path to the .md file")
      })
    },
    async ({ path: notePath }) => {
      const abs = safeAbsPath(brainPath, notePath);
      if (!abs) return { content: [{ type: "text", text: "Invalid path" }], isError: true };
      if (!existsSync(abs)) return { content: [{ type: "text", text: "Note not found" }], isError: true };
      const raw = readFileSync(abs, "utf8");
      const entry = parseMdFile(abs);
      const output = { path: abs, raw, entry };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "create_note",
    {
      title: "Create Note",
      description: "Create a new markdown note with optional frontmatter type.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute or brainPath-relative path for the new note"),
        title: z.string().min(1).describe("H1 heading for the note"),
        type: z.string().optional().describe("type: frontmatter value (Mood, Diary, Session, etc.)"),
        body: z.string().optional().describe("Markdown body content after the heading"),
        frontmatter: z.record(z.string(), z.unknown()).optional().describe("Additional frontmatter fields")
      })
    },
    async ({ path: notePath, title, type, body, frontmatter }) => {
      const abs = safeAbsPath(brainPath, notePath);
      if (!abs) return { content: [{ type: "text", text: "Invalid path" }], isError: true };
      if (existsSync(abs)) return { content: [{ type: "text", text: "Note already exists — use append_to_note or edit_note_frontmatter" }], isError: true };
      mkdirSync(path.dirname(abs), { recursive: true });
      const fm: Record<string, unknown> = {
        date: isoDate(),
        ...(type ? { type } : {}),
        ...(frontmatter ?? {})
      };
      const content = `# ${title}\n\n${body ?? ""}`;
      writeFileSync(abs, matter.stringify(content, fm), "utf8");
      const entry = parseMdFile(abs);
      return {
        content: [{ type: "text", text: JSON.stringify({ created: abs, entry }, null, 2) }],
        structuredContent: { created: abs, entry }
      };
    }
  );

  server.registerTool(
    "append_to_note",
    {
      title: "Append to Note",
      description: "Append text to an existing note.",
      inputSchema: z.object({
        path: z.string().min(1),
        text: z.string().min(1).describe("Markdown text to append")
      })
    },
    async ({ path: notePath, text }) => {
      const abs = safeAbsPath(brainPath, notePath);
      if (!abs) return { content: [{ type: "text", text: "Invalid path" }], isError: true };
      if (!existsSync(abs)) return { content: [{ type: "text", text: "Note not found" }], isError: true };
      const existing = readFileSync(abs, "utf8");
      writeFileSync(abs, existing.trimEnd() + "\n\n" + text + "\n", "utf8");
      return { content: [{ type: "text", text: `Appended ${text.length} chars to ${abs}` }] };
    }
  );

  server.registerTool(
    "edit_note_frontmatter",
    {
      title: "Edit Note Frontmatter",
      description: "Patch frontmatter fields of a note. Merges with existing frontmatter.",
      inputSchema: z.object({
        path: z.string().min(1),
        patch: z.record(z.string(), z.unknown()).describe("Frontmatter fields to set (merged)")
      })
    },
    async ({ path: notePath, patch }) => {
      const abs = safeAbsPath(brainPath, notePath);
      if (!abs) return { content: [{ type: "text", text: "Invalid path" }], isError: true };
      if (!existsSync(abs)) return { content: [{ type: "text", text: "Note not found" }], isError: true };
      patchFrontmatter(abs, patch as Record<string, unknown>);
      return { content: [{ type: "text", text: `Updated frontmatter in ${abs}` }] };
    }
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete Note",
      description: "Delete a note from the brain vault. Irreversible (git history preserves it).",
      inputSchema: z.object({
        path: z.string().min(1),
        confirm: z.literal(true).describe("Must be true to confirm deletion")
      })
    },
    async ({ path: notePath }) => {
      const abs = safeAbsPath(brainPath, notePath);
      if (!abs) return { content: [{ type: "text", text: "Invalid path" }], isError: true };
      if (!existsSync(abs)) return { content: [{ type: "text", text: "Note not found" }], isError: true };
      const { unlinkSync } = await import("node:fs");
      unlinkSync(abs);
      return { content: [{ type: "text", text: `Deleted ${abs}` }] };
    }
  );

  server.registerTool(
    "link_notes",
    {
      title: "Link Notes",
      description: "Add a wikilink relationship from source note to target note via a frontmatter field.",
      inputSchema: z.object({
        source_path: z.string().min(1),
        property: z.string().min(1).describe("Frontmatter key to add the link to (e.g. related_to, mentioned)"),
        target_title: z.string().min(1).describe("Title (or filename stem) of the target note to link")
      })
    },
    async ({ source_path, property, target_title }) => {
      const abs = safeAbsPath(brainPath, source_path);
      if (!abs) return { content: [{ type: "text", text: "Invalid path" }], isError: true };
      if (!existsSync(abs)) return { content: [{ type: "text", text: "Source note not found" }], isError: true };
      const raw = readFileSync(abs, "utf8");
      const { data, content } = matter(raw);
      const link = `[[${target_title}]]`;
      const existing = data[property];
      if (Array.isArray(existing)) {
        if (!existing.includes(link)) existing.push(link);
        data[property] = existing;
      } else if (typeof existing === "string" && existing !== "") {
        data[property] = [existing, link];
      } else {
        data[property] = link;
      }
      writeFileSync(abs, matter.stringify(content, data), "utf8");
      return { content: [{ type: "text", text: `Linked [[${target_title}]] via ${property} in ${abs}` }] };
    }
  );

  server.registerTool(
    "list_notes",
    {
      title: "List Notes",
      description: "List notes in the brain vault, optionally filtered by type.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        type_filter: z.string().optional().describe("Filter to notes with this type: value"),
        sort: z.enum(["modified", "created", "title"]).optional().default("modified")
      })
    },
    async ({ type_filter, sort }) => {
      let entries = await scanBrainCached(brainPath).catch(() => []);
      if (type_filter) entries = entries.filter((e) => e.type === type_filter);
      if (sort === "title") entries.sort((a, b) => a.title.localeCompare(b.title));
      else if (sort === "created") entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      else entries.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
      const output = entries.map((e) => ({
        path: e.path,
        title: e.title,
        type: e.type,
        status: e.status,
        modifiedAt: e.modifiedAt,
        snippet: e.snippet
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: { notes: output, total: output.length }
      };
    }
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search Notes",
      description: "Full-text search over brain note titles and snippets.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional().default(10)
      })
    },
    async ({ query, limit }) => {
      const entries = await scanBrainCached(brainPath).catch(() => []);
      const q = query.toLowerCase();
      const matches = entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.snippet ?? "").toLowerCase().includes(q) ||
          e.filename.toLowerCase().includes(q)
      );
      const top = matches.slice(0, limit).map((e) => ({
        path: e.path,
        title: e.title,
        type: e.type,
        snippet: e.snippet,
        modifiedAt: e.modifiedAt
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(top, null, 2) }],
        structuredContent: { results: top, total: matches.length }
      };
    }
  );

  // ── Existing twin.md tools (kept) ─────────────────────────────────────────

  server.registerTool(
    "get_pending_twin_actions",
    {
      title: "Get Pending Twin Actions",
      description:
        "List action requests created by the desktop pet for Claude Desktop to handle with its own tools/MCP/computer-use access.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      const actions = listTwinActionsByStatus(["pending"]);
      return {
        content: [{ type: "text", text: JSON.stringify({ actions }, null, 2) }],
        structuredContent: { actions }
      };
    }
  );

  server.registerTool(
    "get_twin_actions_needing_approval",
    {
      title: "Get Twin Actions Needing Approval",
      description:
        "List desktop pet action requests that exist but are blocked until the user approves them in terminal.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      const actions = listTwinActionsByStatus(["needs_approval"]);
      return {
        content: [{ type: "text", text: JSON.stringify({ actions }, null, 2) }],
        structuredContent: { actions }
      };
    }
  );

  server.registerTool(
    "resolve_twin_action",
    {
      title: "Resolve Twin Action",
      description:
        "Mark a desktop pet action request done/failed/needs_user and attach the result Claude Desktop observed.",
      inputSchema: z.object({
        id: z.string().min(1),
        status: z.enum(["done", "failed", "needs_user"]),
        result: z.string().min(1).describe("Short user-facing result for the pet/chat UI"),
        details: z.record(z.string(), z.unknown()).optional()
      })
    },
    async ({ id, status, result, details }) => {
      try {
        updateTwinAction(id, (request) => ({
          ...request,
          status,
          result,
          details: details ?? null,
          resolvedAt: new Date().toISOString()
        }));
      } catch {
        return {
          content: [{ type: "text", text: `No pending twin action found for id ${id}` }],
          isError: true
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ id, status, result }, null, 2) }],
        structuredContent: { id, status, result }
      };
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
        pendingReminders,
        pendingTwinActions: listTwinActionsByStatus(["pending"]),
        twinActionsNeedingApproval: listTwinActionsByStatus(["needs_approval"])
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
        "List reminders the sprite has fired but the user has not acknowledged or dismissed.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      const pendingReminders = getPendingReminders(await readReminderLedger());
      return {
        content: [{ type: "text", text: JSON.stringify({ pendingReminders }, null, 2) }],
        structuredContent: { pendingReminders }
      };
    }
  );

  server.registerTool(
    "acknowledge_reminder",
    {
      title: "Acknowledge Reminder",
      description: "Mark a reminder acknowledged when the user agrees to act on it.",
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
      description: "Mark a reminder dismissed when the user waves it off without acting.",
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
      inputSchema: z.object({ prompt: z.string().min(1) })
    },
    async ({ prompt }) => {
      const document = await readCurrentTwinDocument(config);
      const state =
        (await readCurrentTwinState()) ??
        (await interpretTwinDocument(document, config));
      const reply = await speakWithTwin(document, state, prompt, config);
      return {
        content: [{ type: "text", text: reply }],
        structuredContent: { reply, state }
      };
    }
  );

  // ── Wellness-specific tools ───────────────────────────────────────────────

  server.registerTool(
    "log_mood",
    {
      title: "Log Mood",
      description:
        "Append a mood check-in to moods/YYYY-MM-DD.md in the brain vault. Creates the file if it doesn't exist.",
      inputSchema: z.object({
        mood: z
          .enum(["tired", "wired", "quiet", "steady", "anxious", "bright"])
          .describe("How you're feeling right now"),
        note: z.string().optional().describe("Optional free-text note about the mood")
      })
    },
    async ({ mood, note }) => {
      const today = isoDate();
      const notePath = path.join(brainPath, "moods", `${today}.md`);
      mkdirSync(path.dirname(notePath), { recursive: true });

      const timestamp = new Date().toISOString();
      const entry = `\n## ${timestamp}\n\nmood: **${mood}**${note ? `\n\n${note}` : ""}\n`;

      if (!existsSync(notePath)) {
        const fm = { type: "Mood", date: today, mood };
        writeFileSync(notePath, matter.stringify(`# Mood ${today}`, fm) + entry, "utf8");
      } else {
        const existing = readFileSync(notePath, "utf8");
        writeFileSync(notePath, existing.trimEnd() + "\n" + entry, "utf8");
      }

      await gitCommit(brainPath, `mood: ${mood} — ${today}`).catch(() => {});

      return {
        content: [{ type: "text", text: `Logged mood '${mood}' to ${notePath}` }],
        structuredContent: { path: notePath, mood, date: today }
      };
    }
  );

  server.registerTool(
    "compose_diary",
    {
      title: "Compose Diary",
      description:
        "Generate three grounding reflection prompts and a stub diary entry for today. Does not write — returns the prompts for the user to fill in.",
      annotations: { readOnlyHint: true }
    },
    async () => {
      const document = await readCurrentTwinDocument(config).catch(() => null);
      const today = isoDate();
      const notePath = path.join(brainPath, "diary", `${today}.md`);

      const prompts = [
        "What was one moment today that felt real or important?",
        "What drained you? What gave you energy?",
        "What's one thing you want to remember about today?"
      ];

      const stub = `---
type: Diary
date: ${today}
status: open
---

# Diary ${today}

${prompts.map((p, i) => `## ${i + 1}. ${p}\n\n`).join("")}`;

      const output = {
        suggestedPath: notePath,
        prompts,
        stub,
        state: document ? "twin.md loaded" : "no twin.md yet"
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "query_me",
    {
      title: "Query Me",
      description:
        "Answer a question about the user grounded in their brain notes. Citations are mandatory — every claim must reference the exact note path that supports it.",
      inputSchema: z.object({
        question: z.string().min(1).describe("A question about the user's patterns, history, or state")
      })
    },
    async ({ question }) => {
      const q = question.toLowerCase();
      const entries = await scanBrainCached(brainPath).catch(() => []);

      const relevant = entries
        .filter(
          (e) =>
            e.title.toLowerCase().includes(q.slice(0, 20)) ||
            (e.snippet ?? "").toLowerCase().includes(q.slice(0, 20)) ||
            (e.type && ["Diary", "Mood", "Observation", "Theme"].includes(e.type))
        )
        .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))
        .slice(0, 15);

      const context = relevant
        .map((e) => `[${e.path}]\nTitle: ${e.title}\nType: ${e.type ?? "?"}\n${e.snippet ?? ""}`)
        .join("\n\n---\n\n");

      const output = {
        question,
        contextNotes: relevant.map((e) => ({ path: e.path, title: e.title, type: e.type })),
        instruction:
          "Answer the question using ONLY the context notes above. " +
          "Every factual claim must include a citation in the form [path/to/note.md]. " +
          "If there is insufficient evidence, say so explicitly.",
        context
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "pet_agency",
    {
      title: "Pet Agency",
      description:
        "Control the pet's visibility or interaction mode. Actions: tap (animate attention), dim (reduce opacity), hide (hide window), silent (mute reminders for N minutes).",
      inputSchema: z.object({
        action: z.enum(["tap", "dim", "hide", "silent"]),
        why: z.string().optional().describe("Reason for the action (logged)"),
        silent_minutes: z
          .number()
          .int()
          .min(1)
          .max(480)
          .optional()
          .describe("For 'silent': how many minutes to mute reminders")
      })
    },
    async ({ action, why, silent_minutes }) => {
      const output = {
        action,
        why: why ?? null,
        silent_minutes: action === "silent" ? (silent_minutes ?? 60) : null,
        note: "The Tauri desktop companion honors pet_agency events via the state bus. " +
          "If neither surface is running, the action is recorded only."
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
