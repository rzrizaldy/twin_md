---
name: twin-md V3 — Karpathy ship
overview: "Ship like Karpathy / OpenClaw: one mental model, zero fragile localhost by default, README + GitHub Pages first. Web companion (web-lite) is explicitly Animal Crossing–caliber—layered scenes, idle life, bold restrained copy—without twee slang. Then inline bubble chat, models, buddy depth."
todos:
  - id: ac_copy_voice
    content: "Track AC: voice + microcopy guide (bold, plain English; ban list for twee/cringe); apply to web-lite + landing snippets"
    status: pending
  - id: ac_scene_pipeline
    content: "Track AC: web-lite serves composite SVG scenes from packages/core/assets/scenes/{env}/composite.svg; map state.environment; parallax layers"
    status: pending
  - id: ac_pet_stage
    content: "Track AC: pet sprite stage — same URL scheme as desktop /pets/{species}/{state}/breath-a|b.png, 2.2s breath loop, blink cadence, optional turn-3q on hover"
    status: pending
  - id: ac_weather_ui
    content: "Track AC: state-linked overlays (healthy sparkles, storm rain, sleep stars, neglected fog) — CSS/SVG particles, not copy"
    status: pending
  - id: ac_shell_chrome
    content: "Track AC: device chrome — soft rounded rect, subtle shadow, drag-safe margins; optional hide chrome flag in query"
    status: pending
  - id: ac_state_hud
    content: "Track AC: minimal HUD — caption + one-line message from twin-state.json only; optional collapsed 'signals' drawer (last updated, no dashboard grid)"
    status: pending
  - id: ac_motion_budget
    content: "Track AC: motion spec — prefers-reduced-motion respects instant state cut; else 300ms cross-fade scene, parallax drift < 8px"
    status: pending
  - id: doctrine_readme
    content: "README v1: hero link to GH Pages, npm i -g + npx one-liner, 4 commands only, no essay above the fold"
    status: pending
  - id: l_gh_pages_min
    content: "Track L: Astro base /twin_md/, deploy workflow, landing = hero + install strip + link to repo README (not a second manual)"
    status: pending
  - id: l_install_strip
    content: "Track L: index + install pages — max 3 copy-paste blocks (global, npx, from source); delete verbose tutorial sections"
    status: pending
  - id: web_kill_localhost_default
    content: "Track W (new): remove default open_web_companion → localhost:3000; optional mirror only when user runs twin-md web"
    status: pending
  - id: web_lite_server
    content: "Track W: replace Next.js as default mirror with packages/web-lite — node:http static + GET /state.json (read twin-state.json from disk); ~1 file, no App Router"
    status: pending
  - id: k_models
    content: "Track K: Flash/Mini matrix in provider.rs + models-catalog.ts (unchanged intent)"
    status: pending
  - id: k_onboarding_copy
    content: "Track K: onboarding step 4 — tier badges + one sentence why flash/mini"
    status: pending
  - id: m_delete_chat_window
    content: "Track M: delete chat.html + src/chat.ts; tray/chat window gone"
    status: pending
  - id: m_inline_bubble
    content: "Track M: companion inline bubble + Rust stream only; session log append via Rust IPC to vault .md (no POST from browser)"
    status: pending
  - id: m_expand_optional
    content: "Track M: expand opens twin-md web (web-lite URL printed in tray) OR file:// doc — never hard-require Next"
    status: pending
  - id: n_deep_claude_harvest
    content: "Track N: session JSONL harvest + buddy memory (unchanged intent; after W+M ship)"
    status: pending
  - id: n_buddy_rest
    content: "Track N: greet, diary, reminders, slash /buddy — batch after core ship"
    status: pending
isProject: false
---

# twin.md V3 — Improvement Plan (Karpathy / OpenClaw lane)

**Doctrine (read this first).** OpenClaw wins because the loop is obvious: *agent, tools, one config, ship.* twin.md’s loop must be equally boring:

1. **Harvest** → `~/.claude/twin.md`
2. **Interpret** → `~/.claude/twin-state.json`
3. **Render** → terminal / tray pet / optional browser mirror

No “open localhost” as a hidden step. No Next.js essay for a mirror. **The desktop app never depends on another dev server running.** Browser mirror is **opt-in**: user runs `twin-md web` (or opens GitHub Pages for marketing only).

**New concept (vs OpenClaw):** not a coding agent — a **local wellness mirror**: one readable markdown file, one JSON scene, pet that nudges from *your* Claude + Obsidian signals. Same discipline: small surface area, clear files, CLI-first.

---

## 0. What’s wrong today (user feedback)

| Problem | Root cause | Fix direction |
|--------|------------|---------------|
| Localhost serving “still off” | Tray/onboarding opens browser to `http://localhost:3000` while Next dev isn’t running | **Stop defaulting to localhost.** Ship **web-lite** mirror inside CLI or static assets; desktop talks to disk + Rust only |
| Web “too verbose” | `packages/web` is full Next App Router + API routes for state/chat | **Default mirror = thin static UI + one JSON endpoint** (or static file copy of `twin-state.json` refreshed by CLI). Next becomes **optional** or **deleted** from happy path |
| Unclear install | README buries npm; landing duplicates a novel | **README above the fold:** install link + 3 commands. **Landing:** same strip + link to repo |

---

## Track R — README + GitHub Pages (ship first)

### R.1 README (prodigy bar)

Top of [README.md](README.md) before anything else:

- Title + one sentence
- **Live:** `https://rzrizaldy.github.io/twin_md/`
- **Install (pick one):**
  - `npm install -g twin-md`
  - `npx twin-md init` (no global)
- **Run:** `twin-md harvest` → `twin-md watch` (and one line for desktop if applicable)
- Link: “Full CLI reference” anchor below the fold — not inline

No architecture diagram above the fold.

### R.2 GitHub Pages

- [apps/landing/astro.config.mjs](apps/landing/astro.config.mjs): `site: https://rzrizaldy.github.io`, `base: '/twin_md/'`
- Workflow: [.github/workflows/pages.yml](.github/workflows/pages.yml) builds `apps/landing` only
- **Landing content:** **minimal**
  - Hero + 3 commands (copy buttons)
  - “From source” single code block (clone + `pnpm i` + `pnpm --filter …`)
  - Link **“Docs live in the repo README”** — do not maintain two long tutorials

### Acceptance

- New visitor: README or site → running `npx twin-md init` in &lt; 60 s of reading
- `rzrizaldy.github.io/twin_md/` works with base path (assets, internal links)

---

## Track W — Kill localhost default; web-lite mirror

### W.1 Product rule

- **Desktop (Tauri):** never opens `http://localhost:3000` unless user has explicitly started a mirror **and** we verify TCP open (or use configured URL)
- **Default “open in browser”** (if kept): GitHub Pages marketing URL **or** `file://` help — not local Next

### W.2 `packages/web-lite` (new, small server — fat **experience**, thin **stack**)

Replace the **default** `twin-md web` implementation:

- Single process: `node dist/server.js` (or bun) — **one entry file**; static assets live in `packages/web-lite/public/` (HTML/CSS/JS modules), not a framework
- Serves:
  - `GET /` → **Island view** (see **Track AC** below): full scene + pet stage + minimal HUD
  - `GET /state.json` → read `~/.claude/twin-state.json` (+ tiny metadata: `updated`, optional `sourceUpdated`); poll every **4s** from client with `If-None-Match` or last-modified to avoid churn
  - `GET /scenes/:id.svg` → **pass-through** to repo `packages/core/assets/scenes/.../composite.svg` (or pre-copied into `public/scenes/` at build) — **no** CSS fake orbs in the happy path
- **No** chat API on server v1 — chat stays in desktop Rust stream; mirror shows **state + atmosphere**; one line of helper text: *“Replies live in the desktop pet.”* (sentence case, see Track AC)

**Line-count discipline:** cap *framework* surface (no Next, no React for v1). Do **not** cap *art* — AC quality comes from assets + motion spec, not from bundle size theater.

Optional v2: `POST /append-log` only if we add auth token on loopback — **prefer Rust append to vault** instead.

### W.3 CLI

- `twin-md web` → starts web-lite, prints `http://127.0.0.1:<port>` once
- Port flag `--port`, bind `127.0.0.1` only

### W.4 Fate of `packages/web` (Next)

- **Short term:** mark in README as “advanced / dev only” or remove from default install path
- **Long term:** delete or merge into web-lite if unused — **non-goal:** maintaining two mirrors

### Acceptance

- Fresh machine: **no** “connection refused” from tray
- `twin-md web` alone shows pet state without running Next

---

## Track AC — Web companion: Animal Crossing **energy**, adult **voice**

**Goal:** The browser mirror should feel like **walking onto the island**—readable silhouette, breathing idle, weather that matches your week—not like a SaaS dashboard with a sticker on it. This track is **extensive on visuals and motion**; copy stays **short, confident, plain** (bold, not cute).

**Canonical references:** [DESIGN_BRIEF.md](DESIGN_BRIEF.md) sections 1–4 (AC / Tamagotchi / Cozy Grove energy), **forbidden** list (Slackbot, Duolingo guilt, Notion illustration). The web companion implements that brief in the **default** mirror, not only in Figma dreams.

### AC.1 Voice and language (non-negotiable)

**Tone:** Warm, direct, **slightly formal friend**—like good museum copy or a calm DM. Not performative whimsy.

- **Do:** Short sentences. Present tense. One observation, one optional nudge. Use `state.caption` and `state.message` as shipped from core—do not invent a second “sassy” narrator in the UI.
- **Do:** Sentence case for all UI chrome (“Last updated”, “Open desktop pet”).
- **Don’t:** Fake villager catchphrases, forced puns, baby talk, “howdy”, “yay”, “oof”, “let’s go”, excessive emoji, all-lowercase affectation in the **web** mirror (desktop may stay as-is until unified).
- **Don’t:** Guilt mechanics in copy (“you forgot me”)—the **pet body language** carries weight; words stay gentle.

**Ban list (lint in review):** `heckin`, `boop`, `smol`, `bestie`, `vibe check`, `human`, `friendo`, `kinda`, `literally` (as filler), `✨` in headings, `uwu`.

**Bold lines allowed** (examples—not hardcoded, use state-driven text):

- HUD subtitle: single line from `message`, trimmed to ~160 chars with ellipsis in CSS if needed.
- Empty state (no state file yet): *“No twin state on disk yet. Run `twin-md harvest` once.”*

### AC.2 Layout: the “handheld island” shell

Single primary viewport (mobile aspect ~9:19 inside a centered card on desktop):

1. **Scene layer** (full bleed inside rounded rect): composite SVG + parallax sublayers if the asset exposes groups with IDs; else single composite + particle overlay.
2. **Pet stage** (lower third, centered): sprite `img` with crisp pixel ratio handling (`image-rendering` appropriate for PNG art).
3. **HUD** (bottom safe area): caption (from `state.caption`), message line, `updated` in **muted** small type—**no** stat grid, no progress bars in v1.
4. **Chrome**: soft outer shadow, 12–16px radius, **optional** `?chrome=0` for streamers who want only the scene.

**Bold choice:** Default = **chrome on** so the mirror reads as a “device in your workspace”, not a random web page.

### AC.3 Scene system (four worlds, strict mapping)

Map `state.environment` → asset folder (already in core):

| `environment`     | Emotional read (design brief) | Scene art source |
|--------------------|--------------------------------|------------------|
| `sunny_island`     | healthy / bloom                | `scenes/sunny_island/composite.svg` |
| `stars_at_noon`    | sleep deprived                 | `stars_at_noon` |
| `storm_room`       | stressed                       | `storm_room` |
| `grey_nook`        | neglected                      | `grey_nook` |

**Transitions:** On environment change, **cross-fade 280–320ms** between scene `<img>` or inline SVG containers. If `prefers-reduced-motion: reduce`, **cut** at 0ms.

**Parallax (bold but subtle):** drift clouds / stars / paper layer **≤ 8px** amplitude, **18–28s** sine-like loop, `will-change: transform` only on those layers.

### AC.4 Pet motion (match desktop truth)

- **Breath:** alternate `breath-a` / `breath-b` every **~2.2s** to match [companion.ts](apps/desktop/src/companion.ts) rhythm.
- **Blink:** random **4–7s** cadence, **120ms** hold on blink frame (same order of magnitude as desktop).
- **Reminder hook:** when `state.json` includes a future `animation` or reminder flag (v2), swap to `reminder-speak` frame for **800ms** then return—desktop remains source of truth; mirror may poll “last reminder id” from a tiny field in JSON later.

**Silhouette test:** Pet must read at **64px tall** in the HUD—if not, adjust stage scale, not outline.

### AC.5 Weather and particles (show, don’t tell)

Link overlays to **mood**, not to marketing:

- **healthy:** sparse sparkles, slow, low opacity.
- **sleep_deprived:** faint star glints; **no** busy snow.
- **stressed:** rain sheet + occasional paper drift (CSS or SVG mask).
- **neglected:** fog gradient bottom-up, desaturate scene **~8%** via CSS filter on container (not on pet).

Particles are **ambient**, never clickable, never instructional.

### AC.6 Typography and color

- **Display:** align with landing—Fraunces or existing `font-display` from [apps/landing](apps/landing) for **caption only**; body/HUD **Inter Tight** or system UI stack.
- **Color:** pull accents from [DESIGN_BRIEF.md](DESIGN_BRIEF.md) species palettes when showing species-specific rim light (v2); v1 uses neutral HUD on semi-opaque panel (`backdrop-filter: blur(12px)` **once**, not stacked glassmorphism).

### AC.7 Data contract (`/state.json`)

Minimum fields the client consumes:

- `species`, `state`, `environment`, `animation`, `caption`, `message`, `updated`, `sourceUpdated`
- Optional later: `reminderPreview`, `buddyGreeting` (Track N)—**must** still respect AC voice rules

**Privacy banner (one line, collapsible):** *“Everything you see is already on your machine.”*

### AC.8 Landing vs live mirror

- **GitHub Pages** ([Track R](twin-md_v3_extensive_review_c8f30fba.plan.md)): marketing may show **looping silent video or sprite strip** of the four scenes—still **no** fake dashboard.
- **Live `twin-md web` mirror:** this track is the **real** AC experience; landing is a **trailer**, not a second product.

### AC.9 Acceptance (web companion)

- Opening `twin-md web` shows **composite scene** + breathing pet + caption/message within **one screen**, no scroll on common phone heights.
- Switching `twin-state.json` on disk (after harvest) updates scene + pet **within one poll tick** without full reload.
- Copy passes **ban list**; no stat cards; motion respects `prefers-reduced-motion`.
- Visual review: frame passes **“could not be a Notion template”** test from design brief.

---

## Track K — Onboarding models (Flash / Mini)

Unchanged technical intent from prior plan: expand [provider.rs](apps/desktop/src-tauri/src/provider.rs), add [models-catalog.ts](packages/core/src/models-catalog.ts), short copy on onboarding step 4.

---

## Track M — Chat: inline bubble only; log in vault via Rust

### M.1 Delete separate chat window

- Remove [apps/desktop/chat.html](apps/desktop/chat.html), [apps/desktop/src/chat.ts](apps/desktop/src/chat.ts), `open_chat_window`, tray “chat” if redundant

### M.2 Companion = bubble

- Speech bubble DOM in [apps/desktop/index.html](apps/desktop/index.html) + [companion.ts](apps/desktop/src/companion.ts)
- Stream tokens from existing [chat.rs](apps/desktop/src-tauri/src/chat.rs)

### M.3 Session log — **Rust writes markdown**

- New command e.g. `append_chat_transcript(user, assistant)` in [commands.rs](apps/desktop/src-tauri/src/commands.rs) targeting `{vault}/daily-notes/twin-chat-YYYY-MM-DD.md` (same pattern as `run_mood`)
- **No** dependency on Next `POST /api/chat/log`

### M.4 “Expand”

- Opens **web-lite** state view **if** `twin-md web` is running; else toast: “run `twin-md web` for browser mirror” — **no silent failure**

### Acceptance

- Chat works offline with API keys in desktop only
- Vault file grows after each turn without browser

---

## Track N — Buddy (Claude sessions + Obsidian + diary)

Same direction as before (session JSONL, `twin-buddy-memory.jsonl`, greetings, diary) but **explicitly after** R + W + M so we don’t stack fragility.

---

## Sequencing (Karpathy order)

1. **R** — README + GH Pages minimal site (same PR ok)
2. **W** — web-lite server + kill localhost default
3. **AC** — Animal Crossing–caliber mirror (assets, motion, voice)—**same milestone as W** once `/state.json` works; ship thin server + fat `public/` experience in one vertical slice
4. **M** — inline bubble + Rust transcript log
5. **K** — model matrix polish
6. **N** — buddy depth

---

## Non-goals

- Next.js as required dependency for end users
- Two long-form docs (site + README) saying the same thing
- “Auto-spawn `pnpm dev`” as production fix — **too fragile**

---

## Risks

- **web-lite security:** bind loopback only; no CORS wildcards
- **Obsidian path:** transcript commands must degrade gracefully if no vault (same as inbox/mood today)

---

## Open questions

- Publish `web-lite` as `@twin-md/web-lite` workspace package or fold into `packages/cli` binary?
- Scene assets: always read from monorepo `packages/core/assets/scenes` at dev time, with a **copy step** on `npm run build` for published CLI—so end users get SVGs without cloning?
