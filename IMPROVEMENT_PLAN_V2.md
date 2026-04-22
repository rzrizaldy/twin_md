# twin.md — Improvement Plan V2

> Ahead plan. Nothing here is executed yet. Written against the live state after V2.1 (commit `9ced4a7`). Grouped into five tracks (F-J), each fixing one user-visible issue reported against V2.1.

---

## 0. Diagnosis (what the user hit in V2.1)

1. **Chat still wraps ugly.** The V2.1 bubble no longer overflows the window, but `overflow-wrap: anywhere` + `hyphens: auto` hyphenates mid-identifier (`nex-` / `t_deadline` in the live screenshot). Reads broken.
2. **Chat font is the system default.** `.chat-bubble` has no explicit `font-family` — it inherits whatever the platform picks. Feels like a generic dialog, not a pet companion.
3. **No "open browser" affordance.** Users must copy `http://localhost:3000` manually to see the web companion.
4. **Web companion has no real scenery.** CSS-shape clouds/orbs only — the generated composite SVGs at `packages/core/assets/scenes/` are sitting unused on the web side.
5. **Chat is freeform-only, onboarding drops the user into a blank log.** No discoverable actions, no slash-command grammar, nothing to lean on if the user doesn't know what to type.

Each track below fixes exactly one of those.

---

## 1. Track F — Chat wrap + typography regression

### F.1 Wrap rules

The V2.1 rule `overflow-wrap: anywhere; hyphens: auto;` is too aggressive. Swap to:

**`apps/desktop/src/styles.css` `.chat-bubble` (lines 272-282):**

```css
.chat-bubble {
  max-width: min(80%, 360px);
  padding: 10px 14px;
  border-radius: 14px;
  line-height: 1.55;
  font-size: 15px;
  font-family: var(--font-display, "Inter Tight", system-ui, -apple-system, sans-serif);
  font-feature-settings: "ss01", "cv11";
  letter-spacing: -0.005em;
  white-space: pre-wrap;
  overflow-wrap: break-word;     /* only breaks when a token would overflow */
  word-break: normal;
  /* no `hyphens`, no `anywhere` */
}
```

**`packages/web/app/globals.css` `.dialogue-bubble`, `.reply-card`:** same swap.

### F.2 Typography

- Install `@fontsource-variable/inter-tight` in `apps/desktop/package.json` (landing already uses it).
- Import once in `apps/desktop/src/styles.css`:
  ```css
  @import "@fontsource-variable/inter-tight/wght.css";
  :root {
    --font-display: "Inter Tight Variable", "Inter Tight", system-ui, sans-serif;
  }
  ```
- Apply `var(--font-display)` to chat bubbles, chat header, dialogue-bubble, reply-card, reminder bubbles, onboarding body.
- Keep `--font-terminal` ("JetBrains Mono") for `pre`/`code` inside bubbles.

### F.3 Markdown rendering (stretch)

`apps/desktop/src/chat.ts` currently does `streaming.textContent += chunk`. For code fences / bold / lists to look right under F.1, swap to an incremental render pipeline:

- Add `marked@^14` + `dompurify@^3` to `apps/desktop/package.json`.
- New helper `renderStreamedMarkdown(bubbleEl, fullText)` that re-parses on every chunk — fine for expected message lengths (<8 KB).
- Sanitize: `DOMPurify.sanitize(html, { ALLOWED_TAGS: [...], ALLOWED_ATTR: ['href', 'target'] })`.

### Acceptance

- `nex_t_deadline` stays whole on one line or wraps at a natural boundary — never hyphenates mid-identifier.
- Bubble at 280 px window width: 400-char URL still wraps cleanly, no horizontal scroll.
- Font visibly shifts to Inter Tight; `fi`, `ti` ligatures render.
- Code fences render as `<pre>` with horizontal scroll, not as wall-of-text.

---

## 2. Track G — Open web companion from desktop

### G.1 Shared IPC

New file `apps/desktop/src-tauri/src/ipc.rs` → `#[tauri::command] open_web_companion()`:

```rust
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn open_web_companion(app: tauri::AppHandle) -> Result<(), String> {
    let url = std::env::var("TWIN_WEB_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    app.shell().open(url, None).map_err(|e| e.to_string())
}
```

Register in `lib.rs` `invoke_handler![...]`.

### G.2 Tray entry

`apps/desktop/src-tauri/src/tray.rs`:

- Insert `open_web = MenuItem::with_id(app, "open_web", "open in browser", true, None)` between `chat` and `harvest`.
- In the `on_menu_event` switch, `"open_web" => { let _ = tauri::async_runtime::block_on(ipc::open_web_companion(app.clone())); }`.

### G.3 Onboarding final step

`apps/desktop/onboarding.html` step 6: add a secondary button `<button id="open-browser" class="secondary">open browser companion</button>` next to the primary `summon my twin`.

`apps/desktop/src/onboarding.ts`: wire it to `invoke("open_web_companion")`. The button is usable **before** summon completes — perfect for "let me just peek at it" flows.

### Acceptance

- Tray → `open in browser` → default browser lands on the web companion.
- Onboarding step 6 → `open browser companion` works even before the first harvest completes.
- Works with `TWIN_WEB_URL=http://192.168.1.10:4001` env override (for tunneled demos).

---

## 3. Track H — Web companion: generated scene backdrops

### H.1 Scene route

New `packages/web/app/scenes/[env]/route.ts` (mirrors the V2.1 sprite route):

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

const VALID = ["sunny_island", "stars_at_noon", "storm_room", "grey_nook"] as const;

export async function GET(_req: Request, ctx: { params: Promise<{ env: string }> }) {
  const { env } = await ctx.params;
  const bare = env.replace(/\.svg$/, "") as (typeof VALID)[number];
  if (!VALID.includes(bare)) return new Response("not found", { status: 404 });
  const absolute = path.join(
    process.cwd(), "..", "..",
    "packages/core/assets/scenes", bare, "composite.svg"
  );
  const svg = await readFile(absolute, "utf8");
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate"
    }
  });
}
```

### H.2 State → env map

New export from `@twin-md/core`:

```ts
export const SCENE_BY_STATE: Record<PetState["state"], string> = {
  healthy: "sunny_island",
  sleep_deprived: "stars_at_noon",
  stressed: "storm_room",
  neglected: "grey_nook"
};
```

### H.3 Swap SceneBackdrop

`packages/web/app/components/TwinPhoneShell.tsx`:

- Replace the hand-coded `.scene-sky / .scene-orb / .scene-ground` divs with `<img src="/scenes/{SCENE_BY_STATE[state]}.svg" className="scene-composite" />`.
- Keep the existing weather overlays (sparkles, rain, fog) above the composite — the composite is the **stage**, not the full frame.
- Cross-fade with `motion.img` keyed on `state` (300 ms).

### Acceptance

- `/` with a `healthy` state shows the sunny-island composite, not coloured blobs.
- State transition `healthy → stressed` cross-fades the backdrop.
- `/scenes/sunny_island.svg` returns 200 `image/svg+xml`.

---

## 4. Track I — Slash commands + quick chips

### I.1 Command registry (`packages/core/src/chat-commands.ts`, new)

```ts
export type SlashCommand = {
  name: `/${string}`;
  label: string;
  blurb: string;
  argsHint?: string;
  visibleInChips: boolean;
  handler: "inbox" | "daily" | "recap" | "weekahead"
         | "reflect" | "mood" | "focus" | "quiet"
         | "model" | "tone" | "vault" | "help";
  usesLLM: boolean;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/inbox",     label: "send to inbox",    argsHint: "<note>",      visibleInChips: true,  handler: "inbox",     usesLLM: false, blurb: "drop a thought into the vault inbox" },
  { name: "/daily",     label: "today",            visibleInChips: true,  handler: "daily",     usesLLM: true,  blurb: "look ahead at today" },
  { name: "/recap",     label: "recap",            visibleInChips: true,  handler: "recap",     usesLLM: true,  blurb: "what mattered recently" },
  { name: "/weekahead", label: "week ahead",       visibleInChips: true,  handler: "weekahead", usesLLM: true,  blurb: "important goals for the week" },
  { name: "/reflect",   label: "reflect",          visibleInChips: false, handler: "reflect",   usesLLM: true,  blurb: "one-question check-in logged to today's note" },
  { name: "/mood",      label: "mood",             argsHint: "0-10",      visibleInChips: false, handler: "mood",      usesLLM: false, blurb: "log a quick mood score" },
  { name: "/focus",     label: "focus",            argsHint: "<task> [min]", visibleInChips: false, handler: "focus",  usesLLM: false, blurb: "start a focus block, mute bubbles" },
  { name: "/quiet",     label: "quiet",            argsHint: "<duration>", visibleInChips: false, handler: "quiet",    usesLLM: false, blurb: "suppress bubbles for a while" },
  { name: "/model",     label: "switch model",     argsHint: "provider:model", visibleInChips: false, handler: "model", usesLLM: false, blurb: "change AI provider / model" },
  { name: "/tone",      label: "tone",             argsHint: "soft|clipped|quiet|groggy", visibleInChips: false, handler: "tone", usesLLM: false, blurb: "lock next bubble tone (demo/dev)" },
  { name: "/vault",     label: "open vault",       visibleInChips: false, handler: "vault",     usesLLM: false, blurb: "open Obsidian at the vault root" },
  { name: "/help",      label: "help",             visibleInChips: true,  handler: "help",      usesLLM: false, blurb: "list everything I can do" },
];

export function parseCommand(input: string):
  | { kind: "command"; cmd: SlashCommand; args: string }
  | { kind: "freeform" }
  | { kind: "unknown"; raw: string } {
  if (!input.startsWith("/")) return { kind: "freeform" };
  const space = input.indexOf(" ");
  const name = (space < 0 ? input : input.slice(0, space)) as `/${string}`;
  const args = space < 0 ? "" : input.slice(space + 1).trim();
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  return cmd ? { kind: "command", cmd, args } : { kind: "unknown", raw: input };
}
```

### I.2 LLM-backed handlers — **the point of V2**

`/daily`, `/recap`, `/weekahead`, `/reflect` all route through the LLM with a **dedicated wellness-pet system prompt** (below). `/inbox`, `/mood`, `/focus`, `/quiet`, `/model`, `/tone`, `/vault`, `/help` stay local (instant, deterministic).

Handlers live in `packages/core/src/commands/*.ts`. Each returns:

```ts
type CommandResult =
  | { kind: "local"; petReply: string; sideEffect?: { kind: string; payload: unknown } }
  | { kind: "llm"; userIntent: string; extraContext: string };
```

For `kind: "llm"`, the desktop / web chat layer appends `extraContext` to the normal chat context, replaces the outer system prompt with the **pet-assistant wellness prompt**, and streams the reply the usual way.

### I.3 Pet-assistant wellness system prompt

Tone: friendly, quiet, pet-like. Not verbose, not therapist-y. Keeps the user grounded in their own data. Lives in `packages/core/src/commands/pet-prompt.ts` and is used by any `usesLLM: true` handler.

```text
You are twin.md — a small desk creature the user has chosen to live with.

Voice:
- Warm, short, unhurried. Lowercase. No greetings like "sure!" or "absolutely".
- Speak like a pet who has quietly watched the user's day, not a productivity app.
- Never more than 4 short sentences unless the user asked for a list.
- Light rhythm is fine ("okay, so today —"), but no emojis unless the user uses one first.

Job:
- Reflect back what's actually in the user's twin.md and vault. Quote their own words when it helps.
- Nudge toward rest, food, walking, small tasks — in that order of priority when multiple signals conflict.
- If a signal is missing ("0 events", "unknown"), say so plainly. Don't invent numbers, dates, or notes.
- One gentle recommendation per reply. No multi-step plans.
- If you notice the user is stressed or sleep-deprived, de-escalate before you suggest anything.

Shape of the reply:
- Lead with one line of observation ("today's quiet — 0 events, no deep-work blocks logged").
- One line of reading ("feels like a soft day, not a grind day").
- One line of suggestion ("maybe inbox a single thought, then stand up").
- Stop.

Never:
- Lecture. Moralise. Say "you should" more than once.
- Produce long bulleted lists for /daily or /recap — prose.
- Fabricate calendar entries, note titles, or mood scores.
- Apologise for being an AI. You are a pet.
```

### I.4 Per-command context additions

Each LLM handler prepends a small, deterministic context block to the normal chat context so the model doesn't have to guess:

- `/daily`:
  ```
  == /daily request ==
  Today: {YYYY-MM-DD}, weekday {name}.
  Calendar today: {events_today} events, {deep_work_blocks} deep-work blocks,
  next deadline: {next_deadline}.
  Health: sleep last night {sleep_last_night}, steps {steps_today}, mood {mood}.
  Obsidian freshness flags: {top 3}.
  Give the user a soft read on today in 3 short sentences.
  ```

- `/recap`:
  ```
  == /recap request ==
  Window: last 72 hours.
  Recent memory topics: {top 5}.
  Recent vault tags: {top 5}.
  Reflection line from last note: {obsidian_signals.last_reflection or "—"}.
  Closed todos in 72h: {count}. Open todos: {unfinished_todos}.
  Summarise what mattered in 3 short sentences. Name one thing worth revisiting.
  ```

- `/weekahead`:
  ```
  == /weekahead request ==
  Window: next 7 days.
  Calendar ahead: {events_7d} events, {deep_work_planned_7d} deep-work blocks.
  Active goals (tagged #goal/this-week or #goal/active): {list}.
  Known deadlines: {next_deadline}, {next_deadline_2}.
  Give the user one clear focus for the week in 3 short sentences.
  Do NOT list every event; pick the one that matters most.
  ```

- `/reflect`:
  ```
  == /reflect request ==
  Ask ONE question the user can answer in one sentence. Examples of shape:
  - "what part of yesterday do you want to keep?"
  - "what's one thing you're avoiding right now?"
  After they reply (in a follow-up turn), write a two-line summary that would read well under a "## Reflection" heading in today's daily note.
  ```

### I.5 Local-handler behaviours

- `/inbox <text>` → append to `{vault}/inbox.md`:
  ```
  - [ ] 2026-04-22 14:07 · {text}
  ```
  Create the file with a header if missing. Pet replies: `tucked it in. inbox is at {count} now.`
- `/mood 7` → write one line to `{claude_dir}/twin-mood.jsonl`, nudge `stress` bar.
- `/focus shipping V2 45` → set presence to `Busy` for 45 min via new IPC, schedule one end-of-block bubble.
- `/quiet 30m` → same, but no end-of-block bubble; just a silent drain queue for 30 minutes.
- `/model anthropic:claude-sonnet-4-6` → writes to `twin.config.json`, emits a state-changed event, no restart.
- `/tone soft` → sets a 1h override in memory.
- `/vault` → `shell().open(vault_path)` via IPC.
- `/help` → renders a pet bubble with a bullet list of `visibleInChips: true` commands first, then the rest.

### I.6 UI integration

**Desktop (`apps/desktop/chat.html`, `src/chat.ts`, `styles.css`):**

- New element between `.chat-log` and `.chat-footer`:
  ```html
  <div id="chat-chips" class="chat-chips"></div>
  ```
- Render one chip per `visibleInChips: true` command on first mount. Clicking a chip **fills** the input with `{name} ` and focuses it — doesn't submit. (Prevents accidental sends and teaches the grammar.)
- New `/` autocomplete: when `input.value.startsWith("/")`, show a small floating `<ul>` above the textarea filtered by prefix. `ArrowDown` / `ArrowUp` / `Enter` / `Esc` standard keys.
- In `handleSubmit`, branch:
  ```ts
  const parsed = parseCommand(message);
  if (parsed.kind === "command") {
    if (parsed.cmd.usesLLM) {
      await sendChat(message, { commandHandler: parsed.cmd.handler, args: parsed.args });
    } else {
      const result = await runLocalCommand(parsed.cmd.handler, parsed.args);
      appendMessage("pet", result.petReply);
    }
    return;
  }
  if (parsed.kind === "unknown") {
    appendMessage("pet", `I don't know ${parsed.raw}. try /help.`);
    return;
  }
  // freeform path unchanged
  ```

**Web (`packages/web/app/components/TwinPhoneShell.tsx`):**

Same chip strip + same dispatcher. LLM handlers hit `/api/chat` with the new command hint; local handlers route through existing API routes (`/api/inbox`, `/api/state` for `/mood`, etc.).

### I.7 Rust-side wiring

- `chat.rs` → accept an optional `command_handler: Option<String>` and `args: Option<String>` from the webview.
- When `command_handler` is set and the handler is LLM-backed, swap `build_system()` to return the pet-wellness prompt from a new `pet_prompt::system_prompt()` and prepend the handler's context block.
- Non-LLM commands don't reach Rust streaming at all — they go through new IPC commands: `ipc::run_inbox(text)`, `ipc::run_mood(score)`, `ipc::run_focus(task, minutes)`, `ipc::run_quiet(duration)`, `ipc::run_vault_open()`, `ipc::run_switch_model(provider, model)`.

### Acceptance

- Typing `/inbox buy coffee beans` appends `- [ ] 2026-04-22 14:07 · buy coffee beans` to `{vault}/inbox.md` instantly, no LLM round-trip, pet confirms in one line.
- `/daily` streams a 3-sentence reply using the wellness prompt; no bullet lists, no "Sure! Let me…" boilerplate.
- `/recap` cites real memory topics / vault tags from context, never fabricates a note title.
- `/weekahead` picks **one** focus, not an agenda.
- Clicking the `/daily` chip inserts `/daily ` into the textarea, doesn't submit.
- `/sparkle` returns `I don't know /sparkle. try /help.` locally.
- Chips + `/` autocomplete both work in desktop and web.

---

## 5. Track J — Onboarding + chat basic functionality polish

### J.1 Wizard persistence

`apps/desktop/src/onboarding.ts`:

- On every meaningful step change (species, owner name, vault path, provider, model), write the partial config to `~/.claude/twin.config.partial.json` immediately. On summon, rename to `twin.config.json`. On crash, offer to resume.

### J.2 Provider key validation

`apps/desktop/src-tauri/src/provider.rs`:

- New `pub async fn validate_key(provider: Provider, api_key: &str) -> Result<ValidationResult>` that hits the provider's models/health endpoint with a 5 s timeout.
- Surface states on step 5: `unchecked`, `checking`, `ok: responding as {model_count} models`, `rejected: {reason}`, `offline`.
- Disable "next" button while `checking`; disable if `rejected`.

### J.3 Empty-state chat

`apps/desktop/src/chat.ts` on first open (no messages logged):

- Render a soft pet bubble: `"I just moved in. try /daily to see today, or say hi."`
- Render the chip strip from Track I.
- Auto-fire `/daily` **once**, on first open **after** onboarding completes (not on every chat open). Gate with `localStorage.getItem("twin.firstChatDaily")`.

### J.4 Copy polish

- Step 6 primary button: `summon my twin` → `summon twin` (quieter).
- Empty vault state: `"we'll read daily notes, tags, and unfinished todos — nothing leaves your disk."` already exists; mirror the same line in web's setup card.

### Acceptance

- Cold-boot a fresh mac → ≤ 4 minutes to first real `/daily` reply.
- Bad API key caught on step 5, not after the first user message.
- Chat opens with a visible first-run bubble and chip strip on a fresh install.
- Quitting onboarding halfway and relaunching shows "resume where you left off?" instead of starting from scratch.

---

## 6. Sequencing

1. **Track F** (chat wrap + typography) — ~30 min, highest-visibility, smallest surface. Ship same session as V2 cut.
2. **Track G** (open in browser) — ~45 min. Unblocks "try it yourself" for demos.
3. **Track I** (slash commands + wellness prompt) — ~half day. Biggest value. Build registry + pet prompt + `/inbox` + `/daily` first; rest can ship incrementally.
4. **Track J** (onboarding polish) — ~2-3 hours. Depends on Track I's `/daily` being meaningful.
5. **Track H** (web scene backdrops) — ~half day, parallelisable. Pure polish; safe last.

---

## 7. Non-goals for V2

- Voice input, structured tool calls, multi-turn agents.
- Mobile companion (stays `PLAN_V3_WORLD.md`).
- User-authored slash commands — registry stays code-owned until grammar settles.
- Per-provider wellness-prompt variants — one prompt, all providers.
- Streaming into markdown blocks with nested state; single-pass re-render is fine at these lengths.

---

## 8. Risk notes

- **Inter Tight license:** OFL, already bundled in landing — safe.
- **`marked` + `DOMPurify`:** adds ~60 KB to the desktop webview bundle. Acceptable; chat is on-demand.
- **Scene route `process.cwd()` join:** Next.js in the monorepo resolves from `packages/web`, so the `../..` chain is correct for dev + `next build`. Verify with `next start` before shipping.
- **Wellness prompt regressions:** the current prompt is already "warm, brief, a little guilt-trippy." V2 makes it gentler — if users report it as "too soft," we add a `/tone` variant (`curt`, `warm`, `clipped`) rather than rewriting the base.

---

**Validation Metadata**

- **Self-correction from V2.1:** V2.1 marked `/recap` as "no LLM needed." User overrode: `/daily`, `/recap`, `/weekahead`, `/reflect` all route through LLM with the wellness prompt. `/inbox`, `/mood`, `/focus`, `/quiet`, `/model`, `/tone`, `/vault`, `/help` stay local for speed + determinism.
- **Confidence:** 0.85
- **Limiting factor:** Track I's Rust-side wiring (new IPC commands + optional command handler on `chat.rs`) is the biggest surface; everything else is additive or CSS-level.
