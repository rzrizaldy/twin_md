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

`dev:desktop` runs `tauri dev`. Tauri starts Vite on **`http://localhost:1420`**
(see `tauri.conf.json` → `devUrl`) so the **native webview** can load the app
with HMR. That is the desktop UI dev server, not the marketing site (`apps/landing`
→ GitHub Pages) and not a browser-tab companion. Edits to `src/**` hot-reload;
edits to `src-tauri/**` recompile the Rust side.

## Build

```bash
npm run build:desktop
```

Produces a `.app` and `.dmg` under `src-tauri/target/release/bundle/`.
Signing/notarization is off by default. Public closeout releases are uploaded
to GitHub Releases with a `SHA256SUMS.txt` checksum file.

## Architecture contract

This app treats the configured Obsidian or Markdown vault as the primary notes
root. `~/twin-brain` is only fallback/internal when no vault is configured.

This app is mostly a **reader** of twin-md runtime state:

- reads `~/.claude/twin-state.json` and re-emits on change
- reads `~/.claude/twin-reminders.jsonl` and spawns a bubble window per line
- shells out to `twin-md harvest` / `twin-md init` when onboarding or when the
  tray "harvest now" item is clicked
- writes titled `/inbox` captures to the configured vault-relative
  `quickNotesPath`

The app also writes `~/.claude/twin.companion.json` for its own window position
and prefs. Long-running terminal watch and daemon surfaces were removed in the
desktop-first closeout. The CLI `watch` command is only a deprecated no-op for
stale launchers; use the tray harvest action or one-shot source CLI commands
when you need to refresh state manually.

## Windows

| label         | entry            | role                                         |
|---------------|------------------|----------------------------------------------|
| `companion`   | `index.html`     | 320×320 transparent frameless sprite         |
| `bubble-*`    | `bubble.html`    | Transient reminder bubbles, 45s auto-dismiss |
| `chat`        | `chat.html`      | Desktop chat surface, local agent first, API fallback |
| `onboarding`  | `onboarding.html`| First-run local setup, vault, and optional provider config |

## Env vars

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` — optional direct
  provider fallback; local Claude/Codex + MCP is preferred when available
- `TWIN_ANTHROPIC_MODEL`, `TWIN_OPENAI_MODEL`, `TWIN_GEMINI_MODEL` — override
  provider defaults
- `TWIN_CLAUDE_DIR` — override the default `~/.claude/` state directory (useful
  for tests)
