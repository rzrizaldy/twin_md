# twin.md

**Live site:** [rzrizaldy.github.io/twin_md/](https://rzrizaldy.github.io/twin_md/)

Twin.md is a **local macOS desktop companion** for people who keep their life in
Obsidian or Markdown. The desktop app renders the floating pet/chat window,
retrieves from the selected vault, saves local session state, and queues approved
desktop actions through the bundled MCP bridge.

## Current Release

`v0.9.2` is the final desktop-first closeout release:

- GitHub Releases is the supported public install path.
- The terminal pet, `watch`, and background `daemon` surfaces are removed.
- npm publishing is intentionally out of scope; the packages are source/dev
  workspace packages, not registry install targets.
- Clean/release tooling now builds a macOS DMG and checksum artifact from a
  clean `main` checkout.

Download the latest macOS build from
[GitHub Releases](https://github.com/rzrizaldy/twin_md/releases).

## Desktop App

From the release DMG, drag Twin to Applications and run onboarding. Pick an
Obsidian or Markdown vault when prompted. Local non-secret state is stored in the
configured vault under `.twin-md/`; runtime state lives under `~/.claude/`.

Optional provider keys are only needed for cloud chat fallback, generated
sprites, generated backgrounds, or image evolution:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

## Source Development

```bash
git clone https://github.com/rzrizaldy/twin_md.git
cd twin_md
npm ci
npm run build
npm run dev:desktop
```

`npm run dev:desktop` starts Tauri. Tauri starts Vite on
`http://localhost:1420` for the native webview only; this is not a public web
product and not a browser-tab companion.

Useful source commands:

```bash
npm run clean
npm run build
npm run typecheck
npm run validate:pet-assets
npm run build:landing
npm run build:web -w @twin-md/desktop
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run build:desktop
```

## Source CLI

The CLI remains for local development and Claude Desktop MCP wiring from a
checked-out repo:

```bash
node packages/cli/dist/bin.js init
node packages/cli/dist/bin.js harvest
node packages/cli/dist/bin.js mcp
node packages/cli/dist/bin.js action list
node packages/cli/dist/bin.js action approve <id>
```

There is no `watch` command and no background `daemon` command in the supported
surface.

## Release

Releases are GitHub desktop releases only. The release script requires a clean
`main` branch that already matches `origin/main`.

```bash
npm run release
```

The script cleans generated artifacts, runs the validation suite, builds the
Tauri DMG, writes `SHA256SUMS.txt`, and creates the `vX.Y.Z` GitHub Release.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md) - runtime and package architecture
- [docs/BRAIN_CONVENTIONS.md](docs/BRAIN_CONVENTIONS.md) - brain vault fields
- [docs/archive/2026-04-closeout/](docs/archive/2026-04-closeout/) - old plans,
  soft-launch notes, and build reports kept for provenance
