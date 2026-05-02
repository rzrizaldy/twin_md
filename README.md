# twin.md

**Live site:** [rzrizaldy.github.io/twin_md/](https://rzrizaldy.github.io/twin_md/)

Twin.md is a **local macOS desktop companion** for people who keep their life in
Obsidian or Markdown. The desktop app renders the floating pet/chat window,
retrieves from the selected vault, creates titled quick notes back into that
vault, saves local session state, and queues approved desktop actions through
the bundled MCP bridge.

## Release Status

The latest public GitHub Release is `v0.9.5`. There is no `v1.0.0` release yet.

The current desktop-first system is:

- GitHub Releases is the supported public install path.
- The terminal pet and background `daemon` surfaces are removed. `watch` is
  only a deprecated no-op so stale launchers fail quietly.
- Obsidian or a Markdown vault is the primary knowledge root when configured.
  `~/twin-brain` remains a fallback/internal notes root, not the default public
  destination for people who already have an Obsidian vault.
- Onboarding asks where quick notes should land inside the vault. `/inbox`
  creates a titled Markdown note in that folder instead of appending to a random
  root `inbox.md`.
- npm publishing is intentionally out of scope; the packages are source/dev
  workspace packages, not registry install targets.
- Clean/release tooling now builds a macOS DMG and checksum artifact from a
  clean `main` checkout.
- Desktop local MCP wiring resolves the monorepo and Node/npm paths correctly
  when launched from `/Applications/twin.app`.
- Desktop action handoffs require per-request approval. Twin does not keep
  trusted desktop capabilities or auto-open Terminal watch windows.

Download the latest macOS build from
[GitHub Releases](https://github.com/rzrizaldy/twin_md/releases).

## Desktop App

From the release DMG, drag Twin to Applications and run onboarding. Pick an
Obsidian or Markdown vault when prompted, then choose the vault-relative folder
for quick captures, such as `📥 Inbox`, `Inbox`, or `00 Inbox`. Local non-secret
state is stored in the configured vault under `.twin-md/`; runtime state lives
under `~/.claude/`.

In chat:

- `/inbox title: QGIS Analysis idea` creates a note such as
  `📥 Inbox/qgis-analysis-idea.md`.
- Vault retrieval and MCP tools read from `obsidianVaultPath` first.
- Claude Desktop MCP is optional; in-app chat prefers the local Claude/Codex
  bridge when available.

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
node packages/cli/dist/bin.js init --obsidian-vault ~/Notes --quick-notes-path "📥 Inbox"
node packages/cli/dist/bin.js harvest
node packages/cli/dist/bin.js mcp
node packages/cli/dist/bin.js action list
node packages/cli/dist/bin.js action approve <id>
```

`watch` is a deprecated no-op kept only so stale launchers do not print
`unknown command 'watch'`. There is no background `daemon` command in the
supported surface.

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
