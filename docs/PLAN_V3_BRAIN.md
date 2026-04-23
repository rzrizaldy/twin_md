# twin.md V3 — Wellness Brain & Harness

> **Status:** Plan board — principal review, not yet green-lit for implementation.
> **Inspiration:** [`garrytan/gbrain`](https://github.com/garrytan/gbrain) architecture, bent for *chill / wellness / self-agency* instead of CEO productivity.
> **One-line:** twin.md becomes a tiny, local-first, human-readable **second-brain companion** — the pet is the face, markdown skills are the voice, your own words are the content.

---

## 1. Read-through of gbrain — what to steal, what to ignore

### Steal

- **Two-tree model.** An *agent tree* (replaceable, config + skills + crons, ~100 files) and a *brain tree* (permanent, human-readable markdown, grows forever). Human always wins; the DB is a cache.
- **Thin harness, fat skills.** Personality and behavior live in `SKILL.md` files, not in Rust/TS. Non-engineers can tune the pet by editing markdown.
- **Compiled-truth + timeline** page pattern. Top of a brain page = current best understanding (rewritten freely). Below the separator = append-only evidence trail.
- **Self-wiring graph with zero LLM on writes.** Regex + tiny classifiers extract typed edges on every save (`mentioned`, `felt`, `worked_on`, `appeared_with`).
- **Cron/minion-style chores.** Deterministic scheduled jobs that cost $0 tokens by default — morning prep, evening diary, weekly recap.
- **Contract-first operations.** One file defines an op; it auto-appears in CLI + MCP + tools-json. We already half-do this.
- **`doctor` command.** Honest health check that prints the exact fix command per missing source.

### Ignore (wrong fit for wellness)

- Remote MCP via ngrok + bearer + OAuth. Local-only is the brand.
- 26-skill ambition. Twin starts with **6–8 skills**, no more.
- CRM / email / social-to-brain recipes. Wellness ≠ pipeline.
- Tiered person enrichment (Tier 1/2/3). Replace with **mood enrichment over time**.
- pgvector / Supabase. Too heavy. Use **PGLite** (file-backed Postgres) only when keyword search runs out of rope, and only as a cache.

---

## 2. Target shape — one page

```
~/.claude/twin/                      ← agent tree (replaceable)
  SOUL.md                            ← pet voice + guardrails (markdown-tunable)
  twin.config.json
  twin.md                            ← compiled truth + timeline (today's state)
  twin-state.json                    ← pet scene (unchanged contract)
  cache.db                           ← PGLite, disposable
  skills/
    RESOLVER.md                      ← routes user intent → skill
    mood-checkin/SKILL.md
    diary-compose/SKILL.md
    session-ingest/SKILL.md
    weekly-recap/SKILL.md
    nudge/SKILL.md
    privacy-gate/SKILL.md
    query-me/SKILL.md
    doctor/SKILL.md
  chores/
    morning.cron
    midday.cron
    evening.cron
    weekly.cron

~/twin-brain/                        ← brain tree (permanent, user-readable)
  diary/YYYY-MM-DD.md
  moods/YYYY-MM-DD.md
  observations/YYYY-MM-DD.md         ← append-only, signal-detector writes
  sessions/<project>/<id>.md         ← normalized Claude JSONL
  themes/<slug>.md                   ← recurring topics, auto-generated
  people/<slug>.md                   ← optional; only if user @-mentions
```

- **Everything readable on disk.** PGLite (`~/.claude/twin/cache.db`) is pure cache. Delete it anytime; `twin-md brain sync` rebuilds.
- **`twin.md` stops being a numbers dump.** It becomes the *compiled truth of today* plus a short timeline — the same Karpathy-ish doc the user already knows, just with a bottom half.

---

## 3. Core loops

### 3.1 Signal detector (always-on, cheap)

Runs on every Claude message **in opted-in projects only**. Flash / mini-tier model. Captures:

- mood words (`tired` / `wired` / `quiet` / `steady`),
- entity slugs (`@alice`, `#project-x`),
- deltas (switched project, stuck ≥ 3 turns).

Appends one line to `observations/today.md`. Never blocks chat. Pet reads and decides agency: tap / dim / hide / silent.

### 3.2 Harvest → brain (existing, upgraded)

The current `runTwinHarvest` gains one step:

- Raw sources (Claude JSONL, vault, exports) → `brain/sessions/*` + `brain/observations/*`.
- Roll up into `twin.md` compiled truth + bottom-appended timeline.
- Graph extract on write: `mentioned(alice, session/2026-…)`, `felt(tired, 2026-…)`, `worked_on(project-x, today)`.

### 3.3 Skills (MCP + terminal + desktop share one set)

| Skill | When it fires | What it writes |
|---|---|---|
| `mood-checkin` | morning/evening chore; `log_mood` MCP | `moods/YYYY-MM-DD.md` |
| `diary-compose` | evening chore; `compose_diary` MCP | `diary/YYYY-MM-DD.md` |
| `session-ingest` | new Claude JSONL detected | `brain/sessions/…` + entity edges |
| `weekly-recap` | Sunday 10:00 | `diary/YYYY-Www.md` |
| `query-me` | any "why/when/what did I say about…" | returns **your own quotes** with citations |
| `nudge` | reminder engine picks a tone | — (pet speaks) |
| `privacy-gate` | every outbound call | redacts / refuses |
| `doctor` | `twin-md doctor` | prints health + exact fix commands |

`skills/RESOLVER.md` maps user intent → skill. Claude Desktop, terminal Claude, and the Tauri chat bubble all hit the same resolver so the pet feels the same everywhere.

### 3.4 Chores (zero tokens by default)

- **07:30** morning harvest + optional mood bubble
- **12:00** if `context_switches_24h ≥ 5` → nudge "you've been hopping — anything on your mind?"
- **22:00** diary prompt (silent if user is typing)
- **Sun 10:00** weekly recap

Chores are shell jobs that call the CLI. No LLM in the default path; any skill can opt in to one small model call *only if the privacy tier allows*.

---

## 4. MCP surface (shape of v3)

```
get_twin_status           // existing
refresh_twin              // existing
twin_talk                 // existing — grounded on compiled truth
log_mood(mood, note?)     // append + one-line ack
compose_diary()           // returns 3 prompts grounded in today's harvest
query_me(question)        // hybrid search over brain; citations required
pet_agency(action, why)   // tap / dim / hide / silent — UIs may honor
```

`pet_agency` is the interesting one: it's how the pet is allowed to act on its own without being annoying. Claude clients ignore it; the desktop companion honors it and the web mirror tints the scene.

---

## 5. Install (gbrain-style, 15-min target — not 30)

```bash
npm i -g twin-md                      # or npx, unchanged
twin-md init                          # wizard: species, type A/B, brain path,
                                      #   AI provider, claude dir, privacy tier
twin-md harvest                       # real twin.md on first run (already shipped)
twin-md brain sync                    # build PGLite cache from the brain tree
twin-md watch                         # terminal pet
twin-md web                           # loopback island mirror (already shipped)
twin-md mcp                           # stdio MCP for Claude / terminal Claude
twin-md doctor                        # health check; exact fix commands
```

- Desktop onboarding already covers most of this; we add a **brain path** step and a **privacy tier** step.
- One `CLAUDE.md` line (the Karpathy gist) is still the only required "system prompt" the user has to author.

---

## 6. Personality guardrails (non-negotiable)

1. **Wellness, not productivity.** The pet refuses to make a to-do list. It can name *one* small thing to put down.
2. **Mirror voice.** Every non-trivial response quotes the user's own words (`query-me` is the engine).
3. **Agency low.** Max 3 taps/day. Silence is the default.
4. **Consent-gated capture.** Signal detector only runs in opted-in Claude projects. Everything else is invisible to the pet.
5. **Readable on disk.** Brain is markdown. Cache DB is disposable.
6. **Privacy tier.** Default = all-local. Cloud embeddings only with an explicit per-brain toggle.

---

## 7. Phased roadmap

### Phase 1 — Brain foundation *(~1 week)*

- `~/twin-brain/` layout + `twin-md brain init/sync`.
- PGLite cache; keyword search first. `query_me` MVP.
- Compiled-truth + timeline schema in `twin.md`.

### Phase 2 — Skills + MCP *(~1 week)*

- Ship `mood-checkin`, `diary-compose`, `session-ingest`, `query-me`, `privacy-gate`.
- MCP: `log_mood`, `compose_diary`, `query_me`, `pet_agency`.
- `RESOLVER.md` wired to Claude Desktop + terminal Claude + Tauri bubble.

### Phase 3 — Chores + signal detector + doctor *(~1 week)*

- Morning / midday / evening / weekly chores (extend the daemon).
- Signal-detector hook (opt-in per project).
- `twin-md doctor`.
- Optional: vector search behind `--embed` flag.

### Phase 4 — Only if needed

- PGLite-backed durable job queue (minion-style) for long migrations (e.g. importing a big Obsidian vault).
- **No** remote MCP. **No** OAuth. **No** pgvector.

---

## 8. What ships first, what gets cut

**Ship first (phase-1 tickets):**

- `feat(brain): add ~/twin-brain tree + brain init/sync`
- `feat(core): compiled-truth + timeline twin.md schema`
- `feat(cli): twin-md brain sync / query_me scaffold`
- `feat(mcp): log_mood + compose_diary tools`

**Hold for v3.1:** signal detector (privacy story first), minion queue, vector search.

**Cut permanently:** CRM recipes, remote MCP, tiered person enrichment, 26-skill ambition.

---

## 9. Why this is the right shape

- gbrain's killer move is **markdown-on-disk + retrieval-cache**. That maps cleanly onto twin.md's existing "human-readable single file" — we just generalize the file into a tree.
- *Thin harness, fat skills* means we stop cramming wellness logic into Rust/TS and instead author `SKILL.md` files with the voice we want. Non-engineers can tune the pet's personality.
- Self-wiring means the pet remembers *your* patterns (moods, recurring frictions) — not everyone's. That's what makes it feel like *your* twin.
- Consent-gated capture + privacy tiers + everything-readable-on-disk keeps the wellness / chill promise intact.

---

*Authors: principal review.*
*Next step: open matching plan board and start Phase 1 tickets when approved.*
