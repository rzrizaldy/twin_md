# twin.md

Local-first mirror pet that reads `~/.claude/twin.md`, interprets it into `twin-state.json`, and renders across:

- terminal via `twin watch`
- Claude Desktop via `twin mcp`
- phone web UI via `twin web`

## Workspace Layout

- `packages/core`: schema, harvesters, interpretation, pet rendering
- `packages/cli`: `twin` binary and terminal experience
- `packages/mcp`: stdio MCP server
- `packages/web`: Next.js phone surface

## Quick Start

```bash
npm install
npm run build
./packages/cli/dist/bin.js init
./packages/cli/dist/bin.js harvest
./packages/cli/dist/bin.js watch
./packages/cli/dist/bin.js web --port 3000
```

Optional source flags for `init`:

```bash
./packages/cli/dist/bin.js init \
  --species axolotl \
  --owner rz \
  --health-path ~/twin-sources/health.json \
  --calendar-path ~/twin-sources/calendar.ics \
  --location-path ~/twin-sources/location.json \
  --obsidian-vault ~/Documents/MyVault
```

## Runtime Files

- `~/.claude/twin.config.json`
- `~/.claude/twin.md`
- `~/.claude/twin-state.json`
- `~/.claude/twin-history/*.md`

## Milestones

### Milestone 1

- monorepo scaffold
- schema parser and serializer
- local file paths and config
- harvest pipeline for health, calendar, Claude memory, Obsidian, and location
- heuristic plus Anthropic-backed interpretation fallback

### Milestone 2

- compiled `twin` CLI with `init`, `harvest`, `watch`, `web`, `mcp`
- terminal pet with live file watching
- MCP server with `get_twin_status`, `refresh_twin`, and `twin_talk`
- Next.js phone UI polling the same local state

### Milestone 3

Still lightweight compared with the original hackathon plan:

- pet art is generated in code instead of bundled sprite sheets
- live web updates currently use polling, not SSE
- `twin web` starts Next dev mode; packaging a production start path is the next hardening step
- source adapters are heuristic and expect local exports, not OAuth integrations

## Model Notes

The default Anthropic model is `claude-opus-4-20250514`, overridable with `TWIN_ANTHROPIC_MODEL`. If `ANTHROPIC_API_KEY` is missing, interpretation and chat fall back to local heuristics.
