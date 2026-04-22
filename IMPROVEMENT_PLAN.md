# twin.md — Improvement Plan (V2.1)

> Concrete, file-level improvements on top of the live code in this repo. Anchored on what actually exists (checked Apr 22, 2026), not on `PLAN_V2.md`'s ideal scaffold. Five tracks: sprites, chat UI, localhost web, onboarding, floating bubbles.

---

## 0. Current-state diagnosis

What the repo is today:

- `apps/desktop/` — Tauri shell with `companion`, `bubble`, `chat`, `onboarding` windows. Rust backend talks to `~/.claude/twin-state.json` and streams from Anthropic directly.
- `apps/landing/` — Astro site with `/meet`, `/install`, `/how-it-works`, `/build-your-context`, `/world`.
- `packages/core/assets/pets/{axolotl,cat,slime}/{healthy,sleep_deprived,stressed,neglected}/*.svg` — all 3 species × 4 moods present.
- `packages/web/app/components/TwinPhoneShell.tsx` — world + companion webapp layouts, polls `/api/state` every 3 s.

What's off:

1. **Sprites were traced from PNG via `imagetracer.js 1.2.6`** — every SVG begins `<svg viewBox="0 0 1024 1024" ... desc="Created with imagetracer.js version 1.2.6">` and contains thousands of near-white fragment paths with `fill="rgb(251,252,252)" opacity="0"`. These are not clean vectors. A single breath frame is hundreds of KB. The "background" is the original raster white floor, shattered into zero-opacity noise.
2. **Chat bubble wraps but can still overflow.** `apps/desktop/src/styles.css:271-279` has `max-width: 80%; word-wrap: break-word;` but no `overflow-wrap: anywhere` and no `min-width: 0` on the flex child, so long URLs / code blocks punch through on narrow windows.
3. **Localhost web has no character integration in "world" mode beyond a floating SVG and CSS-shape backdrops.** No Sims-style status bars; only a whisper row of three pills. The sprite is pasted on, the scene is pasted on.
4. **Onboarding is three fields: species, name, vault.** `apps/desktop/onboarding.html` has no brief, no Obsidian fallback, no `.claude/` confirmation, no API-key step, no provider or model selector. `chat.rs` hardcodes Anthropic (`"claude-sonnet-4-6"`) — Gemini and OpenAI paths don't exist.
5. **Bubble window does not gate on activity.** `apps/desktop/src/bubble.ts` auto-dismisses after 45 s but there's no suppression when the user is idle / away / screen is locked — bubbles fire regardless of whether the human is actually at the machine.

Each of the five tracks below fixes exactly one of those.

---

## 1. Track A — Sprite cleanup (graphics)

**Goal:** proper, colorful, clean-background SVG sprites. No text inside the SVG. No background fragments. Under 20 KB per frame.

**Why re-vectorize rather than patch:** the current trace is a lossy re-render of a raster PNG. Postprocessing can strip the zero-opacity background shards but cannot fix the jagged outlines or the missing color fills — those require a proper vector pass.

**Option 1 — rebuild from reference PNGs** *(recommended)*
- Input: the `*-reference.png` files already in the repo (e.g. `packages/core/assets/pets/axolotl/healthy/breath-a-reference.png`).
- Tool: Inkscape's "Trace Bitmap → Brightness Steps" with 4–6 scans (body, blush, outline, eye, glow), or Adobe Illustrator Image Trace → "3 Colors" preset, then manual cleanup.
- Palette locked to `DESIGN_BRIEF.md` §3 (body / accent / outline per species). No white background — transparent artboard.
- No `<text>` elements, no embedded `<image>` hrefs, no `data:image/png;base64` payloads.
- Export: single-artboard SVG, 256×256, `viewBox="0 0 256 256"`, text converted to paths if any lettering is used.

**Option 2 — automated cleanup pass** *(fallback if manual re-vector is too slow)*
- Add `scripts/clean-sprite.mjs` that runs `svgo` with a custom config removing:
  - paths where `opacity="0"`
  - paths where `fill` is in the range `rgb(245-255, 245-255, 245-255)` (near-white background shards)
  - `desc`, `metadata`, empty `<g>`
- Then palette-remap remaining fills to the species tokens via a lookup table.
- Output still won't be clean enough for Animal-Crossing quality — treat this as a stopgap only.

**Deliverables (Track A):**
- New pipeline script at `scripts/generate-pet-sprites-v2.mjs` (replacing the current one).
- Per-sprite size budget: ≤ 20 KB gzipped.
- One acceptance sprite (`axolotl/healthy/breath-a.svg`) re-done first and reviewed; if it passes the silhouette test at 32×32, roll out to the other 11 combinations.
- Delete the `*-reference.png` files after re-vector to cut repo weight, or move them to `packages/core/assets/.sources/`.

**Acceptance:**
- Open the SVG in a browser: only the creature is visible, background is transparent, no ghostly white halos.
- Grep the SVG: zero `<text>`, zero `<image>`, zero `data:image`.
- File under 20 KB.

---

## 2. Track B — Chat UI overflow (desktop + web)

**Goal:** no text ever escapes a chat bubble, on any window width, for any content (long URLs, code, pasted errors, CJK runs).

**Desktop fix — `apps/desktop/src/styles.css`:**
Update `.chat-bubble` (currently lines 271–279):

```css
.chat-bubble {
  max-width: min(80%, 360px);     /* cap absolute width, not just % */
  padding: 10px 14px;
  border-radius: 14px;
  line-height: 1.45;
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;        /* replace legacy word-wrap */
  word-break: normal;             /* let anywhere handle edge cases */
  hyphens: auto;
}

.chat-log {
  min-width: 0;                   /* flex child must allow shrink */
}
```

Also add a scrolling container rule for inline code blocks that should scroll rather than wrap:

```css
.chat-bubble pre,
.chat-bubble code {
  max-width: 100%;
  overflow-x: auto;
  white-space: pre;
}
```

**Web fix — `packages/web/app/globals.css`:**
Same rules applied to `.reply-card` and `.dialogue-bubble` (already defined but not width-capped in the `companion` layout).

**Markdown rendering (stretch):** `chat.ts` currently renders replies as plain text. Swap to `marked` + `DOMPurify` so code fences survive the overflow rules above.

**Acceptance:**
- Paste a 400-character URL — wraps cleanly, no horizontal scroll on the window.
- Paste 10 lines of code — scrolls horizontally inside a `<pre>`, bubble stays within its column.
- Resize the chat window to 280 px wide — still no overflow.

---

## 3. Track C — Localhost web: Sims-style status bars + colorful sprite

**Goal:** the `/` (world mode) route of the Next.js webapp feels like a living Sims panel with three status bars mirroring the harvested signals, driven by the clean sprites from Track A.

**Three status bars (design):**

| Bar | Source field | Low / mid / high copy |
|-----|--------------|-----------------------|
| **energy** | `state.energy` (0–100) | "running on fumes" / "awake enough" / "fully charged" |
| **focus** | derived: `100 − stress` | "scattered" / "holding it" / "locked in" |
| **knowledge** | derived from `document.sections.claude_memory_signals.recent_topics.length` + `obsidian_signals.recent_tags.length`, capped 0–100 | "quiet brain" / "buzzing" / "overflowing" |

All three already exist in state or can be computed client-side from `/api/state`. No backend change required for the MVP.

**Component: `packages/web/app/components/SimsStatusRail.tsx`** (new)
- Three vertical progress bars, AC-style chunky stems with a floating label above each.
- Bars fill with the species accent color; background bar uses `var(--outline)` at 10% opacity.
- Small icon above each bar: ⚡ / 🎯 / 📚 (SVG, not emoji, for crispness).
- `data-level="low|mid|high"` attribute drives a subtle shake/shine when a bar crosses a threshold.

**Integration in `TwinPhoneShell.tsx`:**
- Mount `<SimsStatusRail ... />` inside `world-stage` on the right side, absolutely positioned so it reads as part of the scene not a separate dashboard.
- Swap the current `dangerouslySetInnerHTML={{ __html: deferredState.svg }}` to an `<img src="/pets/{species}/{state}/breath-a.svg">` + `<img ... breath-b.svg>` CSS-faded pair. This both uses the new Track A sprites and drops a perf hit (parsing inlined SVGs on every state change).
- Scene backdrops (`SceneBackdrop`) stay — they complement the creature rather than competing with a status dashboard.

**Mood-to-palette map** remains in CSS custom properties so the bars tint with the current state (`--state-accent`), reinforcing the mood across the whole rail.

**Acceptance:**
- Open `/` — sprite is the new clean SVG, three status bars animate to their harvested values on load (0 → value over 600 ms).
- Edit `~/.claude/twin.md` to bump `steps_today` → within 3 s (next poll) the `energy` bar visibly rises.
- `/?layout=companion` — status rail is hidden; only the sprite + bubbles show (companion mode stays minimal).

---

## 4. Track D — Onboarding rewrite

**Goal:** a first-run flow that a stranger can complete in under 3 minutes, on a machine with no `.claude/`, no Obsidian, and no API key configured.

**New flow (6 steps, replacing the current 3-field form):**

1. **Brief** — one paragraph: "twin.md is a desk creature that mirrors your state. It reads your Claude sessions and your second brain, and occasionally tells you to take a break. Everything stays on your machine." One illustration (the healthy axolotl, Track A clean version).
2. **Species + name** — current picker plus owner field, unchanged from today's `onboarding.html`.
3. **`.claude/` directory** — auto-detect `~/.claude/` (exists on Mac once the user has run Claude Code or Claude Desktop once). Show a green checkmark with the resolved path. Fallback: "we'll create it for you" button that `mkdir -p`s the directory.
4. **Obsidian vault** — branching:
   - **"I have a vault"** → current folder picker, plus note: "we'll read daily notes, tags, and unfinished todos — nothing leaves your disk."
   - **"What's Obsidian?"** → in-app explainer card (3 lines) + "start one now" button that creates `~/twin-second-brain/` with a seed `daily-notes/` folder and a `README.md`. Point twin-md at the new folder. Also link to obsidian.md for when they want the real app.
   - **"Skip"** → mark `obsidianVaultPath: null`; Claude session harvesting still runs.
5. **AI provider + API key**:
   - Provider radio: **Anthropic** (default) / **OpenAI** / **Google Gemini**.
   - Model dropdown, populated from the chosen provider:
     - Anthropic: `claude-opus-4-6`, `claude-sonnet-4-6` (default), `claude-haiku-4-5`
     - OpenAI: `gpt-5`, `gpt-5-mini`, `gpt-4.1`
     - Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`
   - API key field (masked), with "where do I get this?" pop-over linking to each provider's keys page.
   - "Save to Keychain" checkbox (default on) — stored via `keytar` equivalent on Rust side (`keyring-rs` crate).
   - "Skip for now" option that disables chat but keeps the mirror working (the heuristic path in `interpret.ts` already covers this).
6. **Summon** — big button. Runs `init` + `harvest` + opens companion window.

**File-level changes:**

| File | Change |
|------|--------|
| `apps/desktop/onboarding.html` | Expand to 6 steps; swap to wizard layout (step indicator top, next/back bottom). |
| `apps/desktop/src/onboarding.ts` | Wizard state machine; validation per step; calls new Rust commands. |
| `apps/desktop/src-tauri/src/ipc.ts` (new commands) | `ensure_claude_dir()`, `create_starter_vault(path)`, `save_provider_credentials({ provider, model, api_key, store_in_keychain })`, `list_models(provider)`. |
| `apps/desktop/src-tauri/Cargo.toml` | Add `keyring = "3"` for cross-platform keychain storage. |
| `apps/desktop/src-tauri/src/provider.rs` (new) | Abstraction over Anthropic / OpenAI / Gemini SSE endpoints. Replaces the hardcoded Anthropic path in `chat.rs`. |
| `apps/desktop/src-tauri/src/chat.rs` | Read provider + model + key from config or keychain; dispatch to `provider.rs`. |
| `packages/core/src/config.ts` | Extend `TwinConfig` with `aiProvider: "anthropic" | "openai" | "gemini"`, `aiModel: string`, `aiKeyStorage: "env" | "keychain" | "config"`. |
| `packages/cli/src/commands/init.ts` | Mirror the same provider/model/key prompts for the CLI-only path. |

**Provider endpoint contracts (for `provider.rs`):**

- Anthropic: `POST https://api.anthropic.com/v1/messages`, header `x-api-key`, streaming SSE — already implemented in `chat.rs`.
- OpenAI: `POST https://api.openai.com/v1/chat/completions`, header `Authorization: Bearer ...`, `stream: true` → SSE with `data: {...}\n\n` frames.
- Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={key}` → SSE.

Each returns text deltas; `chat.rs` just consumes an `AsyncStream<String>` from `provider.rs` and emits `twin://chat-token` the same way it does today.

**Acceptance:**
- Run `twin-md-companion` on a fresh Mac (no `~/.claude/`, no Obsidian, no API key) — completes onboarding, lands on a breathing companion.
- Switch provider from Anthropic to Gemini and send a message — reply streams back in the bubble.
- Delete `~/.claude/twin.config.json` and re-launch — onboarding runs again cleanly.

---

## 5. Track E — Floating desktop: bubble activity gating

**Goal:** bubbles only appear when the user is at the machine and the screen is live. No bubbles when locked, idle, on lunch, in a call, or screen-sharing.

**Activity model (Rust-side):**

Add `apps/desktop/src-tauri/src/presence.rs` that tracks:

| Signal | Source | Check interval |
|--------|--------|----------------|
| `idle_seconds` | `IOHIDIdleTime` via `objc2` (macOS) | every 10 s |
| `screen_locked` | `CGSessionCopyCurrentDictionary` → `CGSSessionScreenIsLocked` | every 10 s |
| `screen_sharing` | `CGDisplayStreamCreate` presence probe | every 10 s |
| `do_not_disturb` | Focus mode via `NSUserDefaults` read of `com.apple.controlcenter` | every 30 s |

Compose into a single `Presence` enum: `Active | Idle | Locked | Busy`.

**Gating rules for bubble emission:**

| Presence | New reminder? | Existing bubble? |
|----------|---------------|------------------|
| `Active` | show immediately | let countdown run |
| `Idle` (> 3 min) | queue, don't show | fade to 40% opacity, pause countdown |
| `Locked` | queue, don't show | hide window; re-show on unlock if < 15 min old |
| `Busy` (DnD or screen-sharing) | queue, don't show | hide window; never auto-re-show (respect) |

**Queue location:** `~/.claude/twin-reminders.jsonl` already exists; add a `presence_status` field to each entry on emit. On presence transition back to `Active`, emit queued reminders with a 2 s stagger (never 5 bubbles at once).

**File-level changes:**

| File | Change |
|------|--------|
| `apps/desktop/src-tauri/src/presence.rs` | New: the four probes above. |
| `apps/desktop/src-tauri/src/windows.rs` | Before spawning a bubble window, call `presence::can_emit()`. |
| `apps/desktop/src-tauri/src/main.rs` | Subscribe to presence transitions; flush queue on `Idle → Active` / `Locked → Active`. |
| `apps/desktop/src/bubble.ts` | Pause the 45 s auto-dismiss timer when `document.hidden` is true (window minimized). |

**Privacy note:** `CGDisplayStreamCreate` probe is read-only — it detects if *something* is capturing the screen, never what. Documented in the settings page.

**Acceptance:**
- Leave the Mac idle for 5 minutes — a reminder fires during idle, no bubble appears, entry is in the queue.
- Touch the trackpad — bubble appears within 2 s.
- Lock the screen — no bubbles. Unlock within 15 min — queued bubbles fire, staggered.
- Turn on Do Not Disturb — bubbles disappear; queued ones do not auto-show on DnD off (user opens them from the tray menu).

---

## 6. Ordering & dependencies

Recommended order (roughly one track per working session):

1. **Track A (sprites)** — unlocks every other visual. Do the axolotl-healthy pilot, get sign-off, then batch the remaining 11.
2. **Track B (chat overflow)** — tiny CSS patch, ship it same session as Track A to free up user headspace.
3. **Track D (onboarding)** — biggest code surface. Needs Track A sprites for its illustrations and Track B for its chat preview step. Blocks Track E's "quiet hours" UI.
4. **Track C (Sims bars)** — pure web polish, depends on Track A sprites for the hero image swap.
5. **Track E (presence gating)** — landlock-free, do it last since it depends on Rust plumbing added in Track D's `provider.rs` refactor (shared async runtime usage).

Nothing in this plan touches `packages/core/src/schema.ts` or the harvest contract. The `~/.claude/twin-state.json` shape is unchanged; all fixes are presentation, onboarding, or client-side gating.

---

## 7. Non-goals for V2.1

- New species, new moods, new scenes.
- Online playground (`/world` teaser stays a teaser).
- Mobile companion.
- Custom sprite editor.
- Plugin-system for user-contributed providers.

Anything here slides to V2.2 or `PLAN_V3_WORLD.md`.

---

**Validation Metadata:**

- **Red Team Passed:** 3/3 — (Q1) verified the `imagetracer.js` claim by reading the live SVG header and confirming thousands of zero-opacity near-white fragments; (Q2) caught that `.chat-log` flex parent needs `min-width: 0` or the bubble still overflows even with `max-width` set on the child; (Q3) surfaced the unstated assumption that `keytar` works in Tauri and corrected to `keyring-rs` (native Rust crate, no Node dependency).
- **Self-Correction:** Dropped the earlier assumption that `word-wrap: break-word` alone handles long tokens — it doesn't for unbreakable runs; corrected to `overflow-wrap: anywhere` plus `min-width: 0` on the flex parent.
- **Confidence:** 0.88
- **Limiting Factor:** Accuracy on macOS presence APIs — `CGSSessionScreenIsLocked` + `CGDisplayStreamCreate` are real but deprecation status varies by macOS version; a quick spike on Sonoma/Sequoia should confirm before coding Track E.
