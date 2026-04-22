# @twin-md/desktop

A floating desktop companion for twin.md. Tauri 2 (Rust backend) + Vite + vanilla
TypeScript webview. Reads `~/.claude/twin-state.json` written by the Node CLI and
mirrors it back at you on the desktop.

## Prerequisites

- Node ≥ 20
- Rust stable (install via [rustup](https://rustup.rs))
- macOS 13+ for the full experience (`screentime.rs` shell-outs are mac-only)

## Dev

```bash
# from the repo root
npm install
npm run dev:desktop
```

`dev:desktop` runs `tauri dev`, which spawns Vite on :1420 and boots the native
shell around it. Edits to `src/**` hot-reload; edits to `src-tauri/**` recompile
the Rust side.

## Build

```bash
npm run build:desktop
```

Produces a signed `.app` and `.dmg` under `src-tauri/target/release/bundle/`.
Signing/notarization is off by default — set `APPLE_SIGNING_IDENTITY` and the
related Apple env vars before shipping. See PLAN_V2 §8.1.

## Architecture contract

This app is a **reader**, not a writer, of twin-md state:

- reads `~/.claude/twin-state.json` and re-emits on change
- reads `~/.claude/twin-reminders.jsonl` and spawns a bubble window per line
- shells out to `twin-md harvest` / `twin-md init` when onboarding or when the
  tray "harvest now" item is clicked

The only file the desktop app writes is `~/.claude/twin.companion.json` for its
own window position + prefs.

## Windows

| label         | entry            | role                                         |
|---------------|------------------|----------------------------------------------|
| `companion`   | `index.html`     | 320×320 transparent frameless sprite         |
| `bubble-*`    | `bubble.html`    | Transient reminder bubbles, 45s auto-dismiss |
| `chat`        | `chat.html`      | 420×540 chat surface, streams from Anthropic |
| `onboarding`  | `onboarding.html`| First-run species + vault picker             |

## Env vars

- `ANTHROPIC_API_KEY` — enables streaming chat; absent = heuristic fallback
- `TWIN_ANTHROPIC_MODEL` — override model (default `claude-sonnet-4-6`)
- `TWIN_CLAUDE_DIR` — override the default `~/.claude/` state directory (useful
  for tests)
