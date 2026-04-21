# twin.md — 3-Day Hackathon Build Plan (Local-First)

## Context
Build **twin.md**: a digital pet that mirrors your real life by reading a single `twin.md` file (health, calendar, Claude memory, Obsidian, location). **Local-first** — the whole thing runs on your Mac as an `npm` package. The pet literally **lives inside Claude CLI** (terminal-rendered), plus a lightweight webapp you open on your phone for the richer visual. Watch is the dream surface; phone webapp is the MVP stand-in. Timeline: 3 days.

**Why local-first (not Vercel):**
- `twin.md` is *your* file. Keeping it in `~/.claude/` means no cloud round-trip, no OAuth gymnastics, no "whose server is this" question.
- The demo story lands harder: "`npx twin`, and your pet is now breathing in your terminal." No deploy URL, no login.
- All data sources (Apple Health export, Obsidian vault, `~/.claude/`, calendar ICS) are already on the presenter's disk. Shipping them to a server is pure overhead.
- Webapp is a tiny Next.js dev server (`pnpm dev` on `localhost:3000`) exposed over LAN so the phone can hit it during demo. No hosting needed.

---

## Core Architecture

```
  SOURCES                     INGEST              STATE              SURFACES
─────────────              ──────────          ──────────         ──────────────
Apple Health  ────┐
(Shortcuts JSON)  │
                  │
Google Calendar ──┤
(ICS file)        │
                  │                                                 1. Claude CLI
Claude memory ────┤     twin harvest          ~/.claude/               (MCP server:
(~/.claude/       │     (local Node      ──▶    twin.md                 pet renders
 project tree)    │      CLI,                      │                    as ASCII +
                  │      modular                  ▼                    speaks in
Obsidian vault ───┤      harvesters)         twin interpret            chat)
(configurable     │                          (Claude Opus →
 vault path)      │                           PetState JSON)        2. `twin` CLI
                  │                              │                     (standalone
Location ─────────┘                              ▼                     terminal pet,
(Timeline export)                          ~/.claude/                  live-updates)
                                           twin-state.json
                                                                    3. Phone webapp
                                                                       (Next.js on
                                                                        localhost:3000,
                                                                        LAN-exposed,
                                                                        rich SVG pet)

 Pet visual generation (Day 1, static assets):
   Gemini 2.5  ──▶  SVG sprite sheets per species × mood  ──▶  bundled in npm pkg
   Gemini 2.5  ──▶  ASCII pet variants for terminal surface    (same species, 4 moods)
   Claude      ──▶  mirror-voice personality prompts           (shipped in repo)
```

Key principle: **`~/.claude/twin.md` is the single source of truth.** All three surfaces re-read the same local file. No database, no server state. Everything ships as one `npm` package.

---

## Distribution

Ship as **one npm package: `twin`** (scoped `@twin/cli` if needed).

```
npx twin init        # picks species, seeds twin.md, writes Claude MCP config
npx twin harvest     # pulls all sources into ~/.claude/twin.md
npx twin watch       # live terminal pet, re-renders on twin.md change
npx twin web         # starts phone webapp on localhost:3000 + prints LAN URL/QR
npx twin mcp         # stdio MCP server (registered automatically by `init`)
```

One install, one binary, every surface. Runs entirely offline except for the Claude API call (interpret + chat).

---

## Data Sources

1. **Apple Health** — iOS Shortcut exports sleep, HRV, steps, workouts to `~/twin-sources/health.json` on schedule.
2. **Google Calendar** — user drops a `.ics` subscription URL or export file. No OAuth for MVP.
3. **Claude memory** — harvester walks `~/.claude/` recursively, reads `CLAUDE.md`s, memory files, session summaries. Summarizes tone/topics/wins/frictions via Claude.
4. **Obsidian vault** — configurable vault path. Parses daily notes + recently modified notes (tags, unfinished TODOs, last reflection).
5. **Location** — Apple/Google Timeline export JSON. Home-ratio + novelty.

All funnel into the twin.md schema.

---

## Stack

- **Runtime**: Node 20+ on macOS. Plain `pnpm` / `npm` workspace.
- **AI**:
  - **Claude Opus 4.7** (`claude-opus-4-7`) via Anthropic SDK directly (or AI SDK in the webapp). Two calls: interpret (twin.md → PetState) and chat (mirror voice).
  - **Gemini 2.5** — one-shot generation of pet SVG + ASCII sprites on Day 1. Static assets bundled in package.
- **CLI UI**: `ink` (React for terminal) for `twin watch`. Renders ASCII pet with breathing/blink animation.
- **MCP server**: `@modelcontextprotocol/sdk` stdio transport. Registered in `~/Library/Application Support/Claude/claude_desktop_config.json` by `twin init`.
- **Webapp**: Next.js 15 App Router, runs `pnpm dev` locally. Tailwind + shadcn. LAN-exposed via `next dev -H 0.0.0.0`. Reads `~/.claude/twin-state.json` directly from disk via a server action.
- **Storage**: plain files under `~/.claude/` — `twin.md`, `twin-state.json`, `twin-history/` (dated snapshots for before/after demo).
- **File watching**: `chokidar` → `twin watch` and the webapp both react to `twin.md` changes within 1s.

No Vercel. No hosting. No accounts.

---

## twin.md Schema

```markdown
---
updated: 2026-04-23T09:14:00+07:00
species: axolotl
owner: rz
---

# twin.md

## health
- sleep_last_night: 5h 12m
- sleep_7d_avg: 6h 02m
- steps_today: 1240
- hrv_7d: declining
- workouts_7d: 1

## calendar
- events_today: 7
- deep_work_blocks: 0
- next_deadline: "Claude hackathon submission — 2026-04-24"
- density_score: 0.87

## location
- home_ratio_7d: 0.91
- novelty_score: low

## claude_memory_signals
- recent_topics: [hackathon, stress, demo prep]
- tone_7d: anxious, determined
- wins: shipped twin.md schema
- frictions: sleep debt, no movement

## obsidian_signals
- daily_note_streak: 12
- recent_tags: [#hackathon, #health, #goals-q2]
- unfinished_todos: 14
- last_reflection: "need to sleep more, stop context switching"

## now
- mood_self_report: null
- context: "Day 2 of hackathon, demo in 36h"
```

`interpret.ts` → Claude → `PetState { mood, energy, stress, glow, species, message }` → written to `~/.claude/twin-state.json`.

---

## Day-by-Day Plan

### Day 1 — npm package + pipeline + pet assets
**Goal: `npx twin harvest` writes a real `twin.md`; pet renders static from it.**

1. **Scaffold monorepo** — pnpm workspace, packages: `cli`, `mcp`, `web`, `core` (shared schema + harvesters + interpret).
2. **Pet asset generation (parallel track)** — Gemini prompt: *"SVG sprite of a {species} in {mood}, 256×256, pastel, expressive eyes"* → 3 species × 4 moods = 12 SVGs. Plus ASCII-art variants for terminal. Hand-polish for 2h in Figma. Commit under `packages/core/assets/`.
3. **Schema** → `core/src/schema.ts` (zod): frontmatter + sections + parser + serializer.
4. **Harvesters** — `core/src/harvest/{health,calendar,claude,obsidian,location}.ts`. Each is a pure `(config) → Partial<TwinMd>` function. Merger writes `~/.claude/twin.md` and snapshots to `~/.claude/twin-history/`.
5. **Interpret** — `core/src/interpret.ts`: Claude Opus 4.7 call, structured output → `PetState` → writes `~/.claude/twin-state.json`.
6. **`twin` binary** — commander-based CLI: `init`, `harvest`, `watch` (stub), `web` (stub), `mcp` (stub).

**End of Day 1**: `npx twin init && npx twin harvest` produces a real twin.md on presenter's machine. Cat the file — it looks like them.

### Day 2 — All three surfaces live
**Goal: pet breathes in terminal, speaks in Claude app, and appears on the phone.**

1. **`twin watch` (Claude CLI surface #1)** — ink-rendered ASCII pet, subtle animation loop, chokidar watches `twin-state.json`. Renders one-line mirror message below pet.
2. **`twin mcp` (Claude app surface)** — tools:
   - `get_twin_status` → current PetState + message + ASCII snapshot
   - `twin_talk(prompt)` → streams mirror-voice reply (cached twin.md in system prompt via Anthropic prompt caching)
   - `refresh_twin` → triggers harvest
   - `twin init` writes the Claude desktop config entry automatically.
3. **`twin web` (phone surface)** — Next.js app, `next dev -H 0.0.0.0`. Home route reads `~/.claude/twin-state.json` server-side, hydrates `<Pet />` (SVG sprite + Framer Motion breathing). `/api/chat` uses AI SDK `streamText`. On start, CLI prints LAN URL + QR code so phone can scan straight to it.
4. **Live reload** — all surfaces react to `twin.md` edits within 1s (chokidar on CLI, server-sent events on webapp).

**End of Day 2**: edit `twin.md` manually → pet changes in terminal, in Claude app, and on your phone, simultaneously.

### Day 3 — Demo polish + stretch
1. **Species picker** in `twin init` — axolotl / cat / slime.
2. **Breathing/blink motion** polish (terminal frames + web Framer Motion).
3. **Before/after view** on web — `twin-history/` snapshots, 7-day strip of pet moods.
4. **Verification pass** (Vercel verification skill discipline even though we're not on Vercel):
   - Clean-room install: `npm pack` → install into fresh dir → run through `init/harvest/watch/web/mcp` end-to-end
   - Claude app picks up MCP tools from fresh config
   - Phone on hackathon Wi-Fi can reach LAN webapp
5. **Pitch write-up** — reuse the refined paragraph from conversation history.

**Stretch**: Scriptable-based Apple Watch complication pinging the LAN endpoint. Cut ruthlessly if Day 3 slips.

---

## Critical Files

- `packages/cli/src/bin.ts` — `twin` entrypoint, commander setup
- `packages/cli/src/commands/{init,harvest,watch,web,mcp}.ts`
- `packages/core/src/schema.ts` — zod + markdown parser/serializer
- `packages/core/src/harvest/*.ts` — per-source harvesters
- `packages/core/src/interpret.ts` — Claude Opus → PetState
- `packages/core/assets/pets/{species}/{mood}.{svg,txt}` — Gemini-generated sprites + ASCII
- `packages/mcp/src/server.ts` — stdio MCP server, tool definitions
- `packages/web/app/page.tsx` — phone-friendly pet + life context
- `packages/web/app/api/chat/route.ts` — AI SDK chat with cached twin.md
- `~/.claude/twin.md`, `~/.claude/twin-state.json`, `~/.claude/twin-history/` — on user's disk

---

## Patterns to lean on

- **Ink** for terminal UI — trivial animation loop, handles resize, feels premium.
- **Anthropic prompt caching** on the twin.md block in chat (same block every turn).
- **chokidar** for cross-surface live reload.
- **commander + prompts** for a `twin init` flow that feels polished.
- **QR-code-terminal** so phone onboarding during demo is one scan.

---

## Risks + fallbacks

- **Apple Health access** — committed Shortcuts-JSON path from Day 1. No Claude-app permission dependency.
- **Google Calendar** — ICS file path, no OAuth. Pre-exported for demo.
- **MCP registration on demo laptop** — `twin init` writes config; have a backup demo video if it fails live.
- **Gemini SVG quality** — 2h hand-polish budget Day 1 afternoon.
- **LAN access on hackathon Wi-Fi** — fallback: `ngrok http 3000` for the webapp if conference Wi-Fi blocks AP isolation. Pre-test.
- **Obsidian schemas vary** — parser targets daily-notes plugin convention only; documented.

---

## Verification (before demo)

1. Fresh machine simulation: `npm pack` → install into empty dir → full flow works.
2. `npx twin init` picks species, writes Claude config, seeds twin.md.
3. `npx twin harvest` → real twin.md reflects presenter's actual day.
4. `npx twin watch` → ASCII pet breathing in terminal; edit `twin.md` → pet state visibly changes within 1s.
5. Claude app: `get_twin_status` tool returns same state. `twin_talk` replies in first-person mirror voice, references an Obsidian line.
6. `npx twin web` → scan QR on phone → pet visible in browser; chat works.
7. Run the whole flow on demo laptop + demo Wi-Fi **once**, not just at home.
