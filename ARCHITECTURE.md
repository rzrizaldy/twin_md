# twin.md Architecture

## Core Principle (Tolaria-aligned)

> Filesystem wins. Cache and runtime state are derived and disposable. Conventions replace schemas. Git is the timeline. MCP is how AI reads and writes the brain.

twin.md diverges only in what the user *sees*: the floating pet, SOUL, skills, chores, signal detector. Everything else behind the curtain is Tolaria-compatible so users can open the brain in Tolaria itself.

---

## Two Trees

```
Agent tree  ~/.claude/twin/      ← replaceable code + config
Brain tree  ~/twin-brain/        ← permanent markdown, GIT REPO
```

**Agent tree** (`~/.claude/`) — runtime config and state. Replaced by upgrades.

| File | Purpose |
|---|---|
| `twin.config.json` | Config including `brainPath`, `species`, AI provider |
| `twin.md` | Compiled truth + timeline summary (harvested) |
| `twin-state.json` | Inferred pet state JSON (derived, disposable) |
| `SOUL.md` | Pet personality (user-editable) |
| `skills/` | Skill markdown files (loaded by MCP server) |
| `chores/` | Deterministic cron-style jobs |
| `twin/cache/` | JSON scan cache for brain vault (disposable, regenerated) |

**Brain tree** (`~/twin-brain/` by default) — permanent human-readable markdown, git repo, owned entirely by the user.

| Folder | Contents |
|---|---|
| `diary/` | Daily diary entries (`type: Diary`) |
| `moods/` | Mood check-ins (`type: Mood`) |
| `observations/` | Signal-detector observations from Claude sessions |
| `sessions/` | Summarised chat sessions |
| `themes/` | Recurring patterns |
| `people/` | People notes |
| `type/` | Type definition documents |
| `AGENTS.md` | Canonical guidance for AI agents |
| `CLAUDE.md` | Shim → imports AGENTS.md |

---

## Core Loop

1. Local sources → `twin-md harvest` → `~/.claude/twin.md`
2. `twin.md` → interpret → `~/.claude/twin-state.json`
3. Every surface reads `twin-state.json`
4. Brain notes → AutoGit checkpoint → `~/twin-brain/` (git)

---

## Data Sources

| Source | Path | Used for |
|---|---|---|
| Health JSON | `~/twin-sources/health.json` | Sleep, steps, HRV, workouts |
| Calendar ICS | `~/twin-sources/calendar.ics` | Meeting load, deadlines |
| Claude local memory | `~/.claude/` (`claudeDir`) | Scans `CLAUDE.md`, `MEMORY.md`, `projects/*/sessions/*.jsonl` (last 7 days) |
| Obsidian vault | Configurable in `twin.config.json` | Recent notes, tags, todos |
| Location JSON | `~/twin-sources/location.json` | Home-ratio, novelty |
| Brain vault | `~/twin-brain/` (`brainPath`) | Diary, moods, themes, observations |

---

## Packages

| Package | Role |
|---|---|
| `@twin-md/core` | Schema, harvesters, interpreter, reminder engine, config |
| `@twin-md/brain` | Brain vault: `scanBrain`, `scanBrainCached`, `git.*`, `initBrain` |
| `@twin-md/cli` | CLI (`twin-md init/harvest/brain/pulse/doctor/mcp/web/daemon`) |
| `@twin-md/mcp` | MCP stdio server (14 tools: 9 Tolaria-parity + 5 wellness) |
| `@twin-md/web-lite` | Minimal HTTP mirror server (`/state.json`, `/pulse.json`, pet sprites) |

---

## Brain vault (B1) — JSON cache, not PGLite

The brain uses Tolaria's three-strategy incremental scan:

1. **No cache** → full walk, write `~/.claude/twin/cache/<vault-hash>.json`
2. **Same git HEAD** → `git status --porcelain` → re-parse only dirty files
3. **Different HEAD** → `git diff old..new --name-only` → selective re-parse

Cache is **disposable** — deleted or corrupted caches trigger a full rescan. No database server. PGLite is explicitly deferred; plain JSON cache + grep-style search is sufficient until proven otherwise.

---

## Convention vocabulary (B2)

See [`docs/BRAIN_CONVENTIONS.md`](docs/BRAIN_CONVENTIONS.md) for the full field vocabulary. The short version:

- `type:` — entity type (Mood, Diary, Session, Theme, Person, Observation, Type)
- `status:` — open | resolved | steady | spiky
- `date:` — ISO date badge
- `mood:` — tired | wired | quiet | steady | anxious | bright
- Any field with `[[wikilinks]]` values → relationship
- `_*` fields → system-internal, excluded from `BrainEntry.properties`

No field names are hardcoded in source code. Convention, not configuration.

---

## MCP surface (B3) — 14 tools at the ceiling

Tolaria-parity tools (read + write brain):
```
brain_context          open_note              create_note
append_to_note         edit_note_frontmatter  delete_note
link_notes             list_notes             search_notes
```

Existing twin.md tools (kept):
```
get_twin_status        get_pending_reminders  acknowledge_reminder
dismiss_reminder       refresh_twin           twin_talk
```

Wellness-specific tools (wellness layer):
```
log_mood               compose_diary          query_me (citations mandatory)
pet_agency
```

Transport: stdio only. Registered into `~/.claude/mcp.json` and `~/.cursor/mcp.json`.

---

## AutoGit (B4)

The daemon's tick function calls `autoGitCheckpoint` after each harvest:
- Checks `git status --porcelain` on the brain vault
- If any `.md` files are dirty: `git add -A && git commit -m "Updated N note(s)"`
- No remote push by default
- `twin-md pulse` prints git activity grouped by day
- `/pulse.json` in web-lite exposes the same data to the mirror

---

## CLI agent subprocess (B5)

Bubble chat priority order:
1. Detect installed `claude` or `codex` CLI (`ai_agents::detect_cli_agent`)
2. If found: spawn with `--mcp-config` injecting the twin-md MCP server → no API keys stored in the app
3. If not found or CLI fails: fall back to direct API-key call via `provider.rs`

---

## Sprite canonicalization (Track A)

Build-time resolver in each app's `stage-assets.mjs`:
- For every `*.png` in `public/pets/{species}/{mood}/`
- If `*-reference.png` exists alongside it → overwrite canonical `*.png` with the reference version
- Runtime code loads a single `/{species}/{mood}/{frame}.png` — zero branches, zero `onerror`

web-lite resolves reference-first at request time in `safePetPath` (reads from `@twin-md/core/assets/`).

---

## Operational Flow

```
twin-md init          # writes twin.config.json, seeds twin.md, runs initial harvest
twin-md brain init    # creates ~/twin-brain/ as a git repo, seeds type definitions
twin-md harvest       # reads local sources → twin.md → twin-state.json
twin-md harvest -w    # continuous mode (chokidar watcher)
twin-md brain sync    # rebuild brain cache
twin-md brain status  # git status + cache freshness
twin-md brain remote add <url>  # optional remote (system git credentials)
twin-md pulse         # git activity grouped by day
twin-md doctor        # health check + exact fix suggestions
twin-md web           # start web-lite mirror (:4730)
twin-md mcp           # start stdio MCP server
twin-md daemon start  # background tick (harvest + reminders + autogit)
```

---

## Design-State Mapping

Four scene states, driven by heuristics on `twin.md` signals:

| State | Pet | Scene |
|---|---|---|
| `healthy` | dancing | sunny island |
| `sleep_deprived` | yawning | stars at noon |
| `stressed` | pacing | storm room |
| `neglected` | quiet | gray nook |

Mapping lives in `packages/core/src/interpret.ts`, not in frontend theme code.
