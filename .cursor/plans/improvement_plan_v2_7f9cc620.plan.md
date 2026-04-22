---
name: Improvement Plan V2
overview: Ship IMPROVEMENT_PLAN_V2.md grouping the five reported issues (chat wrap regression, chat typography, desktop "open in browser" button, web companion scenes, onboarding/chat basic functionality, and slash commands) into a single ahead-plan with file-level direction and acceptance criteria.
todos:
  - id: write-plan-doc
    content: Write IMPROVEMENT_PLAN_V2.md at repo root with the five tracks (F-J) above
    status: pending
  - id: track-f
    content: "Track F: fix chat wrap regression (overflow-wrap: break-word, drop hyphens: auto) + Inter Tight typography for bubbles, desktop + web"
    status: pending
  - id: track-g
    content: "Track G: add 'open in browser' tray item + onboarding button + IPC command using tauri-plugin-shell"
    status: pending
  - id: track-h
    content: "Track H: serve composite scene SVGs via /scenes/[env] route and swap SceneBackdrop to use them"
    status: pending
  - id: track-i
    content: "Track I: slash-command registry in @twin-md/core, desktop + web chip strip + autocomplete, /inbox /daily /recap /weekahead + 2-3 extras"
    status: pending
  - id: track-j
    content: "Track J: onboarding vault autosave, provider key validation, empty-state chat copy, auto-fire /daily on first chat"
    status: pending
isProject: false
---

# IMPROVEMENT_PLAN_V2

Ahead-plan, grouped by track. Nothing in this plan is executed yet. Written against the live state after V2.1 (commit `9ced4a7`). File: `IMPROVEMENT_PLAN_V2.md` at repo root.

## Track F — Chat wrap + typography (high-severity regression)

The screenshot shows the V2.1 fix was too aggressive: `overflow-wrap: anywhere` + `hyphens: auto` hyphenates identifiers mid-token (`nex-` / `t_deadline`). Bubble stays in bounds but reads broken.

- [apps/desktop/src/styles.css](apps/desktop/src/styles.css) `.chat-bubble` lines 272-282: swap rules to
  - `overflow-wrap: break-word;` as the default (only breaks when a token would overflow)
  - remove `hyphens: auto;` (identifiers aren't natural language)
  - keep `min-width: 0` on `.chat-log`
- Same swap in [packages/web/app/globals.css](packages/web/app/globals.css) for `.dialogue-bubble` and `.reply-card`.
- Typography pass in [apps/desktop/src/styles.css](apps/desktop/src/styles.css):
  - `.chat-bubble { font-family: var(--font-display); font-size: 15px; line-height: 1.55; letter-spacing: -0.005em; }`
  - add `font-feature-settings: "ss01", "cv11"` if the loaded face supports it (Inter Tight does)
  - ensure `--font-display` is actually loaded: add `@fontsource-variable/inter-tight` to `apps/desktop/package.json` and import once in `src/styles.css` (landing already uses it)
- Render Markdown in replies: swap `streaming.textContent += chunk;` in [apps/desktop/src/chat.ts](apps/desktop/src/chat.ts) for an incremental Markdown render (add `marked` + `DOMPurify` deps) so code fences survive the wrap rules.

**Acceptance**
- `nex-t_deadline` no longer hyphenates; stays as `nex` on one line, `t_deadline` on the next (or wraps as a whole).
- Bubble at 280px window width: 400-char URL still wraps cleanly, no horizontal scroll.
- Typography visibly shifts to Inter Tight; sizes read like a polished companion, not a generic system dialog.

## Track G — "open web companion" from desktop

Today the user must copy `http://localhost:3000` manually. Add first-class entry points:

- [apps/desktop/src-tauri/src/tray.rs](apps/desktop/src-tauri/src/tray.rs): new menu item `open_web` → `"open in browser"`, inserted between `chat` and `harvest`.
- Tray handler: use the existing `tauri-plugin-shell` (already a dep) to `app.shell().open("http://localhost:3000", None)`. The URL comes from a new `public_web_url()` helper that reads `TWIN_WEB_URL` env or falls back to `http://localhost:3000`.
- [apps/desktop/src/onboarding.ts](apps/desktop/src/onboarding.ts) step 6 "summon" screen: add a secondary button `open browser companion` next to the primary `summon my twin`.
- [apps/desktop/src/companion.ts](apps/desktop/src/companion.ts): right-click or double-click the floating pet fires the same IPC command.
- New IPC command `ipc::open_web_companion()` so both flows share one entry point.

**Acceptance**
- Tray > `open in browser` opens default browser at the web companion URL.
- After onboarding, the "open browser companion" button works before the first harvest completes.
- Works with custom `TWIN_WEB_URL` env (for users running the web dev server on a non-default port).

## Track H — Web companion: generated scene backdrops

[packages/core/assets/scenes/{grey_nook,stars_at_noon,storm_room,sunny_island}/composite.svg](packages/core/assets/scenes) already exist but the web shell only renders CSS-shape backdrops via `SceneBackdrop` in [packages/web/app/components/TwinPhoneShell.tsx](packages/web/app/components/TwinPhoneShell.tsx).

- Add a `packages/web/app/scenes/[env]/route.ts` dynamic route (mirrors V2.1 `pets/[species]/[state]/[frame]/route.ts`) that serves the composite SVG as `image/svg+xml` with `Cache-Control: public, max-age=300`.
- Map `PetState["state"]` to env:
  - `healthy` → `sunny_island`
  - `sleep_deprived` → `stars_at_noon`
  - `stressed` → `storm_room`
  - `neglected` → `grey_nook`
- Replace `SceneBackdrop`'s CSS-shape sky/orb/clouds with a layered `<img src="/scenes/{env}.svg">` pinned under the pet:
  - background layer: scene composite at 100% width, parallax-friendly positioning
  - keep the existing weather decorations (sparkles/rain/fog) as a thin overlay so moods still feel live
- Export `getSceneForState()` helper from `@twin-md/core` alongside the existing sprite helpers so desktop can adopt the same map later.

**Acceptance**
- Loading `/` with a `healthy` state shows the sunny-island composite, not the coloured blobs.
- Transitioning to `stressed` swaps to `storm_room` with a 300ms cross-fade.
- `/scenes/sunny_island.svg` returns 200 SVG.

## Track I — Chat slash commands + quick actions

Slash commands give structure; quick chips give one-tap discoverability. Both route through the same dispatcher so the freeform path stays untouched.

### Command registry (`packages/core/src/chat-commands.ts`, new)

Single source of truth so desktop chat, web chat, and the CLI can all consume it.

```
export type SlashCommand = {
  name: string;            // "/inbox"
  label: string;           // "send to inbox"
  blurb: string;           // one-line help
  argsHint?: string;       // "<note>"
  visibleInChips: boolean; // shown as a quick chip vs only via "/"
  handler: "inbox" | "daily" | "recap" | "weekahead" | "reflect" | "mood" | "focus" | "quiet" | "model" | "tone" | "vault" | "help";
};
```

### Core commands (requested)

- `/inbox <text>` — append a dated bullet to `{vault}/inbox.md` (create if missing); surfaces pet confirmation only, never calls the LLM.
- `/daily` — summarises today: calendar events, health deltas, first deep-work block. Wraps existing `buildSystem` context into a deterministic template; LLM only for the final sentence.
- `/recap` — last 72h: recent memory topics, closed todos, mood trend. Pure harvest, no LLM needed unless `--narrate` is passed.
- `/weekahead` — upcoming 7 days: calendar + Obsidian goals tagged `#goal/this-week` or `#goal/active`.

### Additional ideas (pick 2-3 for V2)

- `/reflect` — prompts user one question, writes their answer back to `{vault}/daily-notes/YYYY-MM-DD.md` under a `## Reflection` heading.
- `/mood <0-10>` — logs a mood line to health state; feeds the `stress` / `energy` bars.
- `/focus <task> [minutes]` — starts a silent focus block: sets presence to `Busy`, schedules a single end-of-block bubble.
- `/quiet <duration>` — suppresses bubbles (e.g. `/quiet 45m`); wires into Track E presence queue.
- `/model <provider:model>` — e.g. `/model gemini:gemini-2.5-flash`; updates `aiProvider` + `aiModel` in config, no restart.
- `/tone soft|clipped|quiet|groggy` — locks the next N bubble tones for dev/demo.
- `/vault open` — opens Obsidian at the vault root via `tauri-plugin-shell`.
- `/help` — renders the full command list as a chat bubble with clickable chips.

### UI integration

- [apps/desktop/chat.html](apps/desktop/chat.html): add a `<div id="chat-chips" class="chat-chips">` between `.chat-log` and `.chat-footer`.
- [apps/desktop/src/chat.ts](apps/desktop/src/chat.ts): in `handleSubmit`, if message starts with `/`, parse via `parseCommand(message)` from `@twin-md/core`, dispatch to a handler, render a **local** pet bubble with the result, and never round-trip through `sendChat` unless the handler returns `{ fallbackToLLM: true }`.
- Render chips from `SlashCommand[].visibleInChips` — each chip fills the input with `/name ` (leaving the cursor at the end) rather than submitting, so the user can add args.
- Typing `/` in the input opens a lightweight autocomplete popover above the textarea (absolute-positioned `<ul>` filtered by prefix); Enter accepts.

### Web mirror

- [packages/web/app/components/TwinPhoneShell.tsx](packages/web/app/components/TwinPhoneShell.tsx): same chip strip above the `chat-form`, same dispatcher.
- [packages/web/app/api/chat/route.ts] (read + maybe patch): route `/inbox`, `/daily`, `/recap`, `/weekahead` through core handlers server-side since those need FS access; return as `{ reply, state }` like today.

### Backend handlers

- `packages/core/src/commands/inbox.ts`, `daily.ts`, `recap.ts`, `weekahead.ts` — pure functions given `{ config, document }`.
- Desktop exposes each via a new IPC command (`ipc::run_command`) so both webviews share the same Rust path and the LLM stream is bypassed when not needed.

**Acceptance**
- Typing `/inbox pick up coffee beans` in chat appends `- [ ] 2026-04-22 14:05 pick up coffee beans` to the vault's `inbox.md` and the pet bubble confirms.
- `/daily` produces the same output in desktop and `/` web companion.
- Unknown command (e.g. `/sparkle`) falls back to a friendly "I don't know that command — try `/help`" bubble.
- Clicking the `/daily` chip inserts `/daily ` into the input, not instant-submit (prevents accidental sends).

## Track J — Onboarding + chat basic functionality polish

Thin but concrete — V2.1 landed the wizard shell; V2 makes it actually useful first-run.

- [apps/desktop/src/onboarding.ts](apps/desktop/src/onboarding.ts): persist step 4 vault choice into `twin.config.json` immediately on select (not only at summon), so crashes don't lose state.
- After summon, auto-fire `/daily` on first chat open so the user sees something meaningful instead of an empty log.
- Show a "what can I ask?" chip row on the very first chat session, auto-dismissed after first send.
- Validation: step 5 provider+key should ping the provider's models endpoint (1 HTTP call, 5s timeout) and surface "key works" / "key rejected" before `summon`. [apps/desktop/src-tauri/src/provider.rs](apps/desktop/src-tauri/src/provider.rs) gets a `validate_key(provider, key)` helper.
- Empty-state copy for the chat log: "I just moved in. Try `/daily` or say hi."

**Acceptance**
- Cold-boot onboarding on a fresh mac → 4 minutes to first real `/daily` response.
- Bad API key is caught on step 5, not after the first message.
- Chat opens pre-populated with the daily brief.

## Sequencing

1. **Track F** (30 min) — highest-visibility, smallest surface. Ship same session as V2 cut.
2. **Track G** (45 min) — unblocks "try it yourself" for demos/screenshots.
3. **Track I** (half-day) — biggest value; do command registry + core handlers first, then UI.
4. **Track J** (2-3 hours) — depends on Track I's `/daily` to be meaningful.
5. **Track H** (half-day, parallelisable) — pure web polish; safe to do last.

## Non-goals for V2

- Voice input, multi-turn memory, structured tool use, LangGraph-style agents.
- Mobile companion; stays `PLAN_V3_WORLD.md`.
- User-defined slash commands (registry stays code-owned until the syntax settles).
