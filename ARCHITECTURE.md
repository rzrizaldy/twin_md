# twin.md Backend Architecture

## Core Loop

The system is intentionally local-first. Everything important resolves through one file:

1. Local sources are harvested into `~/.claude/twin.md`
2. `twin.md` is interpreted into `~/.claude/twin-state.json`
3. Every surface reads that same local state

That means the pet scene is not hand-managed in the frontend. The frontend is just a renderer for state inferred from your local life signals.

## Data Sources

The current implementation expects local exports or local folders instead of OAuth-heavy integrations:

- Health JSON export
  - example path: `~/twin-sources/health.json`
  - used for sleep, steps, HRV, workouts
- Calendar ICS file
  - example path: `~/twin-sources/calendar.ics`
  - used for meeting load, event density, upcoming deadlines
- Claude local memory tree
  - path: `~/.claude/`
  - scans `CLAUDE.md`, `MEMORY.md`, summaries, and nearby notes
- Obsidian vault
  - configurable path in `twin.config.json`
  - reads recent notes, tags, unfinished todos, and reflection lines
- Location JSON export
  - example path: `~/twin-sources/location.json`
  - used for home-ratio and novelty cues

## Harvest Layer

Implementation lives in [packages/core/src/harvest](/Users/rzrizaldy/CodeFolder/twin_md/packages/core/src/harvest/index.ts).

Each source adapter returns one section of the document:

- `health.ts`
- `calendar.ts`
- `claude.ts`
- `obsidian.ts`
- `location.ts`

`runTwinHarvest()` merges those sections into one structured document and writes:

- `~/.claude/twin.md`
- `~/.claude/twin-history/<timestamp>.md`

## Single Source Of Truth

`twin.md` is the shared narrative state file.

It keeps sections like:

- `health`
- `calendar`
- `location`
- `claude_memory_signals`
- `obsidian_signals`
- `now`

This file is meant to be readable, editable, and portable. If you change it by hand, the pet can re-interpret from that same file.

## Inference Layer

Implementation lives in [packages/core/src/interpret.ts](/Users/rzrizaldy/CodeFolder/twin_md/packages/core/src/interpret.ts).

The interpreter reads `twin.md` and produces a richer pet scene object:

```json
{
  "state": "sleep_deprived",
  "environment": "stars_at_noon",
  "animation": "yawning",
  "caption": "Stars At Noon",
  "scene": "The sky never quite finished waking up...",
  "message": "I am trying to be brave, but my eyelids are losing the argument."
}
```

The interpreter currently works in two modes:

- Heuristic mode
  - always available
  - computes energy, stress, glow, then chooses one of four narrative states
- Anthropic mode
  - enabled when `ANTHROPIC_API_KEY` is present
  - refines the same state object but still preserves the local-first flow

## Frontend Connection

The frontend does not calculate the pet scene on its own.

It reads the already-inferred state:

- [packages/web/app/api/state/route.ts](/Users/rzrizaldy/CodeFolder/twin_md/packages/web/app/api/state/route.ts)
  - reads `twin.md`
  - loads or regenerates `twin-state.json`
  - returns `{ document, state }`
- [packages/web/app/components/TwinPhoneShell.tsx](/Users/rzrizaldy/CodeFolder/twin_md/packages/web/app/components/TwinPhoneShell.tsx)
  - polls `/api/state`
  - renders the scene from `state`, `environment`, and `animation`
  - does not display raw dashboard numbers

So the backend-to-frontend contract is:

`sources -> twin.md -> twin-state.json -> scene renderer`

## Claude / MCP Connection

Implementation lives in [packages/mcp/src/index.ts](/Users/rzrizaldy/CodeFolder/twin_md/packages/mcp/src/index.ts).

The MCP server exposes three tools:

- `get_twin_status`
- `refresh_twin`
- `twin_talk`

This lets Claude Desktop read the same local pet state and speak from it without duplicating business logic.

## Terminal Connection

Implementation lives in [packages/cli/src/ui/TwinWatchApp.tsx](/Users/rzrizaldy/CodeFolder/twin_md/packages/cli/src/ui/TwinWatchApp.tsx).

`twin watch` watches:

- `~/.claude/twin.md`
- `~/.claude/twin-state.json`

If `twin.md` changes, it re-interprets the scene and updates the terminal pet.

## Operational Flow

Typical lifecycle:

1. `twin init`
   - writes `twin.config.json`
   - seeds `twin.md`
   - registers the MCP server in Claude Desktop config
2. `twin harvest`
   - reads local sources
   - rewrites `twin.md`
   - writes `twin-state.json`
3. `twin web`
   - starts the phone-friendly scene renderer
4. `twin watch`
   - keeps the terminal pet synchronized

## Design-State Mapping

The backend currently maps all life signals into these four scene states:

- `healthy`
  - dancing pet, sun, flowers, lush island
- `sleep_deprived`
  - yawning pet, stars still visible in daytime
- `stressed`
  - pacing pet, storm room, papers on the floor
- `neglected`
  - quiet pet, wilted plants, gray corner

That mapping lives in the inference layer, not in the frontend theme code.
