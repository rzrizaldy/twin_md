# twin.md — Plan V2: Desktop Companion + Landing

> Supersedes the 3-day hackathon scope in `PLAN.md`. Keeps the local-first monorepo, the `twin.md` → `twin-state.json` contract, and the existing character/mood system. Adds: a **floating desktop companion** (Tauri + Rust) as the primary surface, an **Animal-Crossing-style landing page** (Astro + Tailwind) as the front door, and a roadmap slot for an **ambient world + online playground** later.

---

## 0. What changes vs. V1

| Dimension | V1 (`PLAN.md`) | V2 (this doc) |
|-----------|----------------|---------------|
| Primary surface | Terminal pet (`twin-md watch`) + phone webapp | **Floating desktop companion (Tauri)** |
| Landing | None | **Astro + Tailwind, Animal-Crossing styled** |
| Onboarding | `twin-md init` CLI prompts only | CLI + **landing-page guided flow** linking Karpathy's gist |
| Signals | Apple Health, Calendar, Claude, Obsidian, Location | Same + **macOS Screen Time** + **Claude session activity** + **vault busyness** |
| Agency | macOS notifications via `osascript` | **In-world speech bubbles** on desktop + notifications kept |
| Runtime | Node 20+ only | Node 20+ **+ Tauri 2.x (Rust)** |
| Distribution | `npx twin-md` | `npx twin-md` **+ signed `.dmg` / `.AppImage` for the companion** |

What stays locked: `~/.claude/twin.md`, `~/.claude/twin-state.json`, the harvest → interpret → reminders pipeline, the three species × four moods, the four reminder bubble tones, the design brief in `DESIGN_BRIEF.md`.

---

## 1. Vision recap (one paragraph)

twin.md is a desk creature, not a dashboard. It lives on your desktop in a small transparent window, reads your second brain (Claude `.claude/` tree, Obsidian vault, macOS Screen Time, calendar, health), and mirrors your state back at you — glowing when you're in flow, yawning when you're sleep-deprived, quietly fading when you've been neglecting yourself. It has enough agency to tap on the glass and tell you to take a break. The landing page is how strangers find it and learn to feed it their own context, including how to grow a personal system prompt the Karpathy way. Everything is local-first. The online avatar playground is future work, flagged clearly, not built now.

---

## 2. Repo layout after V2

Current monorepo keeps its four packages and grows two top-level **apps**:

```
twin_md/
├── packages/
│   ├── core/            # (unchanged) schema, harvesters, interpret, reminders, assets
│   ├── cli/             # (unchanged) twin-md CLI, ink terminal UI
│   ├── mcp/             # (unchanged) stdio MCP server
│   └── web/             # (unchanged) Next.js companion+world phone webapp
├── apps/                # NEW — user-facing surfaces outside the CLI
│   ├── desktop/         # NEW — Tauri 2 + Rust floating companion
│   │   ├── src-tauri/   #   Rust backend (filesystem watch, Screen Time bridge)
│   │   └── src/         #   Webview frontend (Vite + vanilla TS + SVG sprites)
│   └── landing/         # NEW — Astro + Tailwind marketing + onboarding
├── scripts/
└── pnpm-workspace.yaml  # add apps/*
```

One monorepo, `pnpm-workspace.yaml` expanded to `packages/*` + `apps/*`. Root `npm run build` gains `build:desktop` and `build:landing` tasks.

---

## 3. Phase 1 — Desktop Companion (the MVP, user picked this)

### 3.1 Why Tauri + Rust

- Transparent, always-on-top, frameless windows are a one-liner in `tauri.conf.json`.
- 10–15 MB binary vs. Electron's ~150 MB. Acceptable to leave running all day.
- Rust can bind macOS APIs (`objc2` crate) for Screen Time + idle detection without a second Swift process.
- Webview reuses the existing SVG sprite pipeline in `packages/core/assets/pets/` — **no art rework**.

### 3.2 Window architecture

Three distinct Tauri windows, created programmatically from `main.rs`:

1. **`companion`** — 320×320 px, transparent, frameless, always-on-top, skip-taskbar. Contains the sprite. Default docked bottom-right; draggable; position persisted.
2. **`bubble`** — spawned on demand above the companion when a reminder fires or the user clicks the pet. Transparent, click-through-except-bubble, auto-dismiss per the 45 s rule from `DESIGN_BRIEF.md` §6.
3. **`chat`** — 420×540 px, normal chrome, hidden until the user double-clicks the pet. This is the "nudge and talk" surface. Streams from Anthropic through the same prompt path as `twin-md mcp twin_talk`.

A fourth optional window, `world`, is deferred to Phase 3 (ambient world).

### 3.3 Rust backend responsibilities (`apps/desktop/src-tauri/`)

| Module | Job |
|--------|-----|
| `state.rs` | Watch `~/.claude/twin-state.json` via `notify` crate. Debounce 200 ms. Emit Tauri event `twin://state-changed` with parsed struct. |
| `brain.rs` | Poll `~/.claude/` recursively every 60 s for session files; compute a "busyness" score (files touched last 10 min). |
| `vault.rs` | From config, watch the Obsidian vault path; count edits in the last 30 min. Same event bus. |
| `screentime.rs` | macOS only: `objc2` bridge to `NSWorkspace` frontmost-app + `IOHIDIdleTime` for idle seconds. Windows/Linux → stub that returns `None`, flagged `cfg(target_os = "macos")`. |
| `companion.rs` | Owns the `CompanionState` struct: mood, energy, stress, glow, fatigue. Recomputed whenever any source emits. Written to `~/.claude/twin-state.json` so the CLI, MCP, and webapp see the same state. |
| `ipc.rs` | Tauri commands callable from the webview: `get_state`, `dismiss_bubble`, `open_chat`, `trigger_harvest`, `set_companion_position`. |
| `lifecycle.rs` | Launch-at-login (Tauri autostart plugin), single-instance lock, clean shutdown. |

**Key rule:** the Rust side never *creates* the narrative state from scratch. It either (a) reads `twin-state.json` that `twin-md harvest` / the daemon wrote, or (b) shells out to `twin-md harvest` as a child process when stale (> 10 min). That preserves the single-source-of-truth guarantee in `ARCHITECTURE.md`.

### 3.4 Webview frontend (`apps/desktop/src/`)

- Plain Vite + TypeScript, no framework needed at this scale.
- Imports sprite SVGs from `packages/core/assets/pets/{species}/{mood}/*.svg` via a build-time copy step.
- Breath loop: 2200 ms `ease-in-out` between `breath-a.svg` and `breath-b.svg`, per design tokens §8.
- Blink: every 4–7 s (randomized) swap to `blink.svg` for 120 ms.
- Bubble pop: 220 ms spring, reuses the four bubble SVGs (`bubbles/{soft,groggy,clipped,quiet}.svg`).
- Drag: whole window is `tauri://drag-region` so the user grabs the pet.
- Double-click: emits `open_chat` to Rust → Rust opens chat window.
- Hover state: subtle tilt toward cursor (6° max, spring-damped).

### 3.5 macOS Screen Time integration (fatigue signal)

Screen Time raw data lives in `~/Library/Application Support/Knowledge/knowledgeC.db` (SQLite, requires Full Disk Access). For a v1 we do **not** touch that file. Instead:

- Poll `IOHIDIdleTime` every 15 s → seconds since last input.
- Track `NSWorkspace.frontmostApplication` → app switch count per minute.
- Derive two metrics: `idle_gap_minutes` and `context_switches_per_hour`.
- Feed both into `companion.rs`'s fatigue score.

If the user grants Full Disk Access later, a stretch module can read `knowledgeC.db` for a richer signal. Keep this behind a `--full-disk` flag in the CLI.

### 3.6 IPC with the rest of twin-md

The desktop companion is a **reader**, not a duplicator, of twin-md state:

```
                  writes                        reads
twin-md harvest ────────▶ ~/.claude/twin.md ◀──── apps/desktop Rust (optional)
                          ~/.claude/twin-state.json ◀──── apps/desktop Rust (required)
                          ~/.claude/twin-reminders.jsonl ◀── apps/desktop Rust (required)
                          
apps/desktop Rust writes:
  ~/.claude/twin.companion.json   # window position, species selection, last shown bubble
```

No network between Tauri and the Node CLI. All coordination is via the `~/.claude/` filesystem, which is already the contract.

### 3.7 Chat surface

The chat window reuses the exact prompt the MCP server uses for `twin_talk`:

- System prompt: the current `twin.md` (prompt-cached via Anthropic's cache-control).
- User turn: whatever the user types.
- Streaming response rendered with a typewriter effect in the pet's bubble style.
- If `ANTHROPIC_API_KEY` is not set → fall back to a local heuristic line from `interpret.ts`, same as the rest of the app.

### 3.8 Onboarding flow triggered from the companion (first launch)

1. Detect `~/.claude/twin.config.json` is missing.
2. Spawn a temporary modal window: "let's meet your twin." Species picker (axolotl / cat / slime), owner name, Obsidian vault picker (native file dialog).
3. Shell out to `twin-md init --species <x> --owner <y> --obsidian-vault <z>`.
4. Shell out to `twin-md harvest`.
5. Link out to the landing page's **/build-your-context** section that wraps Karpathy's gist (see §4.3).
6. Close modal, summon the companion into its docked position.

### 3.9 Phase-1 deliverables & definition of done

- `apps/desktop` builds on macOS 13+; ships a universal `.dmg` via `tauri-cli`.
- `companion` window renders the right sprite for the current mood within 1 s of a `twin-state.json` write.
- Reminders from `twin-md daemon` surface as bubble windows with the §6 motion spec.
- Double-click → chat → streaming reply works with a real API key.
- Launch-at-login toggle in the tray menu.
- First-run onboarding completes on a clean Mac in under 2 minutes.
- No leaked processes on quit (verified via `ps` before/after).

### 3.10 Phase-1 non-goals (explicit)

- Windows/Linux polish. Tauri will compile, but Screen Time stubs out and we do not demo those platforms.
- Custom sprite animation editor.
- Voice input.
- Multi-pet households.
- Online playground (Phase 3 only).

---

## 4. Phase 2 — Landing page (Astro + Tailwind)

### 4.1 Why Astro

- Static HTML output fits "local-first, no hosting drama" — can be served from GitHub Pages or the user's own machine with `astro preview`.
- Islands architecture lets specific sections (the species picker, the sprite preview) be interactive React/Vanilla components without shipping a framework for the whole page.
- Ships zero JS by default, which matches the Animal-Crossing "slow, warm, low-energy" vibe.

### 4.2 Routes

| Route | Purpose |
|-------|---------|
| `/` | Hero: breathing axolotl on an island, tagline, "install" CTA. |
| `/meet` | Species bio cards (axolotl / cat / slime), same SVG assets as the app. |
| `/how-it-works` | The harvest → twin.md → scene pipeline diagram. Pulls text from `ARCHITECTURE.md`. |
| `/install` | `npx twin-md init`, then `brew install twin-md-companion` (future), then the `.dmg` download. |
| `/build-your-context` | **Walkthrough of Karpathy's gist** on building your own personal system prompt; links to the original; shows how to drop the result into `~/.claude/CLAUDE.md`. |
| `/world` | Teaser for the online playground; explicitly says "coming later". |

### 4.3 Karpathy gist integration

Target URL: `https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f` (linked, not scraped).

`/build-your-context` presents the gist's essence in three short panels:

1. **Observe yourself for a week** — daily notes, tags, commits, conversations.
2. **Condense into a system prompt** — who you are, how you work, what you want.
3. **Drop it in `~/.claude/CLAUDE.md`** — twin.md will harvest it automatically.

A copyable starter template with placeholders (`{{role}}`, `{{values}}`, `{{current_focus}}`) ships as a downloadable `CLAUDE.md` file on the page.

### 4.4 Design system

- Reuses `packages/core/assets/tokens.json`.
- Fonts: Fraunces (display), Inter Tight (body), JetBrains Mono (code).
- Palette: Animal-Crossing-warm pastels (`#fff8d2` cream, `#c4f2cb` mint, `#ffd6e5` pink) with `#473643` outline.
- Illustrations: same SVG sprites from `packages/core/assets/pets/`, placed on simple island backgrounds from `packages/core/assets/scenes/sunny_island/`.
- One hand-drawn wobble on headings via SVG filter, to match the "somebody made it" principle in `DESIGN_BRIEF.md` §11.

### 4.5 Phase-2 deliverables & DoD

- `apps/landing` builds a fully static `dist/` with `astro build`.
- Lighthouse ≥ 95 on performance and accessibility.
- No tracking, no analytics, no cookies.
- Dark mode via `prefers-color-scheme` (cozy night palette, not inverted).
- CI deploys `dist/` to GitHub Pages on every `main` push.

---

## 5. Phase 3 — Ambient world + online playground (future, do not build yet)

Flagged clearly so the design holds space without code. Two sub-phases:

1. **Local ambient world** — a fourth Tauri window (`world`) that shows the full scene from `DESIGN_BRIEF.md` §4 in a larger transparent surface. User toggles it from the tray. Still 100% local.
2. **Online playground** — avatars meet in a shared browser world (think `gather.town` × `Neko Atsume`). Requires a server, auth, and CRDT room sync. Out of scope for this plan; captured in a future `PLAN_V3_WORLD.md`.

Landing page `/world` tells visitors this is coming later, with a newsletter-free mailing-list-free "check back" note to keep with the no-accounts ethos.

---

## 6. Integration milestones (sequential, not parallel)

| Week | Focus | Exit criterion |
|------|-------|----------------|
| 1 | Tauri scaffold + state.rs watching `twin-state.json` | Companion window renders the current mood sprite, updates live on `twin.md` edits. |
| 2 | screentime.rs + companion.rs fatigue score | Fatigue score visibly changes the mood after 10 min of idle vs. 10 min of heavy switching. |
| 3 | Bubble window + reminders wiring + chat window | Daemon-fired reminder appears as bubble; double-click opens chat; streaming reply works. |
| 4 | Onboarding modal + launch-at-login + DMG packaging | Clean-Mac install flow under 2 minutes; `.dmg` is signed and notarized. |
| 5 | Astro landing skeleton + `/meet`, `/install`, `/how-it-works` | Landing builds, Lighthouse green, links to the DMG. |
| 6 | `/build-your-context` + downloadable CLAUDE.md template | Karpathy workflow is walkable in under 10 minutes by a friend who has never seen the project. |
| 7 | Verification + polish | Full flow: land → download → onboard → companion live with real personal data, no CLI touch required. |

Weeks are rough units, not calendar-locked; user is coding, not this plan.

---

## 7. Critical files to create (by package)

**`apps/desktop/`**

- `src-tauri/Cargo.toml` — deps: `tauri ^2`, `notify ^7`, `serde`, `serde_json`, `objc2` (mac), `tokio`, `directories`
- `src-tauri/tauri.conf.json` — three window configs, `macOSPrivateApi: true` for transparency, allowlist scoped to `~/.claude/` and the Obsidian vault path
- `src-tauri/src/main.rs`, `state.rs`, `brain.rs`, `vault.rs`, `screentime.rs`, `companion.rs`, `ipc.rs`, `lifecycle.rs`
- `src/main.ts` — webview entry
- `src/companion.ts` — sprite loop
- `src/bubble.ts` — bubble window entry
- `src/chat.ts` — chat window entry
- `src/styles.css` — tokens-driven styles
- `vite.config.ts`
- `package.json`

**`apps/landing/`**

- `astro.config.mjs`
- `tailwind.config.ts`
- `src/pages/{index,meet,how-it-works,install,build-your-context,world}.astro`
- `src/components/{SpeciesCard,BreathingSprite,IslandHero,KarpathyGist}.astro`
- `src/layouts/CozyLayout.astro`
- `public/claude-starter.md` — downloadable template
- `package.json`

**Monorepo root**

- `pnpm-workspace.yaml` — add `apps/*`
- `package.json` — add `build:desktop`, `build:landing`, `dev:desktop`, `dev:landing` scripts
- `.github/workflows/release-desktop.yml` — Tauri build matrix (macOS-only for v1)
- `.github/workflows/deploy-landing.yml` — Astro → Pages

---

## 8. Risks, decisions needed, and fallbacks

### 8.1 Decisions to lock before coding

1. **DMG signing + notarization** — needs an Apple Developer ID ($99/yr). Alternative: ship unsigned and ask users to `xattr -d com.apple.quarantine`. Decide now because week-4 DMG work blocks on this.
2. **Do we keep `packages/web` (Next.js phone webapp)?** Recommend: yes, but demote to "phone mirror" in the README. The Tauri app is the primary surface.
3. **Full Disk Access for Screen Time** — prompt on first launch or hide behind a flag? Recommend: hide behind `--full-disk` to keep onboarding friction near zero.
4. **Anthropic API key handling** — env var only, or a settings UI inside the chat window? Recommend: both, with `keytar` for OS keychain storage.

### 8.2 Risks

- **`objc2` learning curve in `screentime.rs`** — fallback: write the Screen Time bridge as a tiny Swift helper binary shelled out from Rust. Keeps Rust readable; costs one extra binary.
- **Tauri window transparency flicker on macOS** — known issue on Intel Macs pre-Ventura. Fallback: ship a feature-flagged opaque background.
- **`notify` on network-mounted Obsidian vaults** — filesystem events are unreliable over iCloud Drive. Fallback: 30 s poll loop in parallel, marked as a separate code path.
- **Karpathy gist evolves** — we link to it; content drift is fine. We also ship our own condensed walkthrough on `/build-your-context`, so the page stays useful even if the gist moves.
- **Landing page never feeling "Animal Crossing enough"** — risk of ending up generic pastel SaaS. Mitigation: copy the `DESIGN_BRIEF.md` §11 "do not over-polish" rule into the landing's design lint.

---

## 9. Verification (before shipping anything)

Reused discipline from V1, adapted:

1. **Clean-Mac rehearsal** — wipe `~/.claude/`, install DMG, click through onboarding, run for one full workday, confirm mood shifts visibly through the day.
2. **Offline mode** — disable Wi-Fi, confirm the companion still breathes, bubbles still fire via the heuristic path, chat window degrades gracefully.
3. **Landing Lighthouse** — perf + a11y ≥ 95 on mobile; no layout shift.
4. **Onboarding timer** — stopwatch from landing-page visit to companion visible on desktop. Target: ≤ 5 minutes.
5. **State consistency** — edit `twin.md` by hand; confirm CLI, MCP, webapp, **and the Tauri companion** all reflect the change within 1 s.
6. **Karpathy walkthrough usability test** — one friend, zero prior context, times how long it takes them to produce a usable `CLAUDE.md`.

---

## 10. What this plan does not answer

- Exact sprite motion curves beyond what `DESIGN_BRIEF.md` §8 already specifies.
- Subscription / monetization model. (Implicitly: none. Local tool, MIT license.)
- Plugin system for user-contributed species. (Nice to have, not in V2.)
- Mobile companion (iOS widget, Apple Watch complication). (Stretch, defer.)
- Any choice that belongs in `PLAN_V3_WORLD.md` (server, sync, auth, avatar identity).

Anything above that needs a call, call it. Anything below stays on paper until the code catches up.

---

**Validation Metadata:**

- **Red Team Passed:** 3/3 — (Q1) verified Tauri 2.x supports `transparent` + `alwaysOnTop` + `decorations: false` in `tauri.conf.json`; (Q2) caught that Windows/Linux lack Screen Time and scoped macOS-first explicitly; (Q3) surfaced the unstated assumption that the Tauri companion should *read* `twin-state.json` rather than duplicate state, making the Node→Rust contract explicit.
- **Self-Correction:** Originally had the Tauri app running its own harvesters in Rust — corrected to a pure-reader model so the existing `ARCHITECTURE.md` single-source-of-truth invariant holds. Also corrected "Screen Time via `knowledgeC.db`" to "`IOHIDIdleTime` + `NSWorkspace` for v1, `knowledgeC.db` as a flagged stretch" after remembering Full Disk Access friction.
- **Confidence:** 0.86
- **Limiting Factor:** Accuracy on macOS-specific details (Screen Time API surface, `objc2` binding ergonomics) — these are verifiable but not verified in this pass; week-2 spike should confirm before committing to the `IOHIDIdleTime` path.
