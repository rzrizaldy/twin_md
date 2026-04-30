# twin.md Architecture

## Principle

Filesystem wins. Runtime state is derived and disposable. The user's Markdown
vault remains the long-term memory, and MCP is the bridge for AI clients that
need to inspect or act on local state.

## Trees

Runtime state lives under `~/.claude/` by default:

| File | Purpose |
|---|---|
| `twin.config.json` | Local config: vault path, quick-notes path, brain fallback path, species, provider |
| `twin.md` | Harvested context summary |
| `twin-state.json` | Derived pet state read by desktop surfaces |
| `twin-reminders.jsonl` | Reminder ledger |
| `twin-actions.jsonl` | Desktop action queue |
| `twin-history/` | Harvest snapshots |

When `obsidianVaultPath` is configured, that vault is the primary notes root for
retrieval, quick notes, and MCP note tools. The optional brain vault lives at
`~/twin-brain/` by default and is ordinary Markdown in git; it is used as a
fallback/internal notes root when no Obsidian or Markdown vault is configured.

## Core Loop

1. Local sources are harvested into `~/.claude/twin.md`.
2. `twin.md` is interpreted into `~/.claude/twin-state.json`.
3. The Tauri desktop app watches those local files and updates the pet/chat UI.
4. Approved desktop actions are queued locally and resolved through the MCP
   bridge or local agent subprocess.
5. `/inbox` creates a titled Markdown note under the configured
   `quickNotesPath` inside the selected vault.

All long-running terminal UI/background CLI surfaces were removed in `v0.9.2`.
Refreshes are explicit: desktop onboarding/tray actions or one-shot source CLI
commands call `harvest`.

## Packages

| Package | Role |
|---|---|
| `@twin-md/core` | Schema, config, harvesters, interpreter, reminders, action queue |
| `@twin-md/brain` | Markdown brain vault scanning, cache, and git helpers |
| `twin-md` | Source CLI: `init`, `harvest`, `mcp`, `brain`, `pulse`, `doctor`, `action` |
| `@twin-md/mcp` | Stdio MCP server for Claude Desktop/local agent tooling |
| `@twin-md/desktop` | Tauri 2 desktop app and chat surface |
| `@twin-md/landing` | Astro landing site for GitHub Pages |

## Desktop Runtime

The app is a Tauri shell with a vanilla TypeScript webview. Rust owns filesystem
watchers, window/tray behavior, credentials, provider calls, and native desktop
handoffs. The webview owns companion/chat/onboarding UI.

The desktop app reads and emits:

- `~/.claude/twin-state.json`
- `~/.claude/twin-reminders.jsonl`
- configured vault `.twin-md/` profile/session files
- configured vault quick-notes folder, for titled `/inbox` captures

The app writes only local runtime/profile/action data. It does not publish or
sync user content remotely.

## MCP Surface

The MCP server is stdio-only. It exposes:

- Twin state and reminder tools: `get_twin_status`, `refresh_twin`,
  `get_pending_reminders`, `acknowledge_reminder`, `dismiss_reminder`,
  `twin_talk`
- Action queue tools for approved desktop handoff
- Brain/vault tools such as `brain_context`, `list_notes`, `search_notes`,
  `open_note`, `create_note`, `append_to_note`, `link_notes`, and
  `query_me`

These tools resolve the configured Obsidian/Markdown vault first. Claude Desktop
starts MCP explicitly from its config. The repo no longer starts an ambient CLI
watcher or daemon.

## Source Commands

```bash
node packages/cli/dist/bin.js init
node packages/cli/dist/bin.js harvest
node packages/cli/dist/bin.js mcp
node packages/cli/dist/bin.js brain init
node packages/cli/dist/bin.js brain sync
node packages/cli/dist/bin.js brain status
node packages/cli/dist/bin.js pulse
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js action list
```

## Release Contract

Public distribution is a GitHub Release containing:

- macOS DMG
- `SHA256SUMS.txt`
- release notes with validation commands

npm publishing is intentionally not part of the closeout release path.
