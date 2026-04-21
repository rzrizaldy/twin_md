# twin-md

A local-first desk sprite that reads your second brain and decides whether to cheer, yawn, pace, or hide.

twin-md harvests the data already on your machine — Apple Health exports, a calendar `.ics`, your `~/.claude/` memory tree, your Obsidian vault, and a location export — into a single file at `~/.claude/twin.md`. That file is interpreted into a living pet that shows up in three places: your terminal, the Claude Desktop MCP surface, and a small webapp you can dock beside your work.

The pet has agency. A background daemon scans your local state, fires macOS notifications when you owe yourself sleep or a walk, and surfaces the same reminders through the MCP server so Claude can bring them up without being asked.

Nothing leaves your machine except the optional Anthropic interpretation call. No login, no cloud, no telemetry.

See [DESIGN_BRIEF.md](DESIGN_BRIEF.md) for the full Animal-Crossing-style visual brief handed to the designer.

## Install

```bash
npm install -g twin-md
```

or run it without installing:

```bash
npx twin-md init
npx twin-md harvest
npx twin-md watch
```

Requires macOS + Node 20+ (notifications use `osascript`).

## Commands

```bash
twin-md init       # pick species, seed ~/.claude/twin.md, register the MCP server
twin-md harvest    # scan your local 2nd brain and rewrite twin.md
twin-md watch      # terminal pet; reminders appear as speech bubbles
twin-md web        # docked companion + full-scene webapp, LAN-exposed with a QR code
twin-md mcp        # stdio MCP server for Claude Desktop
twin-md daemon start    # background loop: harvest, interpret, fire reminders
twin-md daemon stop
twin-md daemon status
```

`twin-md init` flags (all optional):

```bash
twin-md init \
  --species axolotl \
  --owner rz \
  --health-path ~/twin-sources/health.json \
  --calendar-path ~/twin-sources/calendar.ics \
  --location-path ~/twin-sources/location.json \
  --obsidian-vault ~/Documents/MyVault
```

## Webapp layouts

The webapp has two layouts. Switch via query string.

- `http://localhost:3000/` — world mode: the full scene (island, stars-at-noon, storm desk, wilted corner)
- `http://localhost:3000/?layout=companion` — companion mode: transparent body, sprite docked bottom-right, reminders float above. Designed to be pinned next to Obsidian, VS Code, or a notes window.

## Reminders

The sprite nudges you when:

- you slept less than 6 hours and it is still morning
- your calendar density is high and you have zero deep-work blocks
- unfinished todos climb past a dozen
- your 7-day home ratio is above 95 %
- there are no workouts in the last week
- no wins have been logged recently

Reminders surface in three places at once:

- macOS notification via `osascript` from the daemon
- a speech bubble in `twin-md watch` — press `d` to acknowledge the top one, `n` to dismiss
- a speech bubble in the webapp — click to acknowledge, "nevermind" to dismiss
- in Claude Desktop via the MCP server (`get_pending_reminders`, `acknowledge_reminder`, `dismiss_reminder` tools)

All reminders share one local file: `~/.claude/twin-reminders.jsonl`.

## Runtime files

- `~/.claude/twin.config.json` — config seeded by `init`
- `~/.claude/twin.md` — the shared narrative state file
- `~/.claude/twin-state.json` — the inferred pet scene
- `~/.claude/twin-history/*.md` — every harvest snapshot
- `~/.claude/twin-reminders.jsonl` — one line per fired reminder
- `~/.claude/twin-daemon.pid` + `twin-daemon.log` — daemon metadata

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the harvest → twin.md → twin-state.json → surfaces pipeline.

```
your local 2nd brain
  │
  ▼
twin-md harvest  →  ~/.claude/twin.md
                      │
                      ▼
                interpret.ts  →  ~/.claude/twin-state.json
                      │
                      ▼
                reminders.ts  →  ~/.claude/twin-reminders.jsonl
                      │
      ┌───────────────┼───────────────┬────────────────┐
      ▼               ▼               ▼                ▼
  twin-md watch   twin-md web    MCP surface     macOS notifications
                  (world +        (Claude          (from daemon)
                   companion)      Desktop)
```

## Packages

Published as a scoped family under the `@twin-md` org + the root CLI binary.

- `twin-md` — the CLI
- `@twin-md/core` — schema, harvesters, interpretation, reminder rule engine
- `@twin-md/mcp` — stdio MCP server
- `@twin-md/web` — Next.js surface

## Model notes

The default Anthropic model is `claude-opus-4-20250514`, overridable via `TWIN_ANTHROPIC_MODEL`. If `ANTHROPIC_API_KEY` is missing, interpretation and chat fall back to local heuristics.

## Release

From the monorepo root:

```bash
npm run build
scripts/release.sh            # pack + clean-room verify
scripts/release.sh --dry-run  # + npm publish --dry-run across workspaces
scripts/release.sh --publish  # + npm publish --ws --access public
```
