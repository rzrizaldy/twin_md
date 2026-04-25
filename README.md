# twin.md

**Live site:** [rzrizaldy.github.io/twin_md/](https://rzrizaldy.github.io/twin_md/)

A **cute desktop companion** wired to your **Obsidian vault**, able to **retrieve and write** notes, and to **harvest context from your Claude Desktop sessions** via the bundled **MCP** server. State lives in `~/.claude/twin.md` and `~/.claude/twin-state.json` on your machine.

## Install (CLI + MCP)

```bash
npm install -g twin-md
```

Or without a global install:

```bash
npx twin-md init
npx twin-md harvest
npx twin-md watch
```

Requires **Node 20+**. macOS notifications and some integrations expect macOS; core harvest and CLI work on Linux and Windows too.

## Desktop companion (Tauri)

The floating pet and **chat panel** are in `apps/desktop`. **Prebuilt macOS builds** (when published): [GitHub Releases](https://github.com/rzrizaldy/twin_md/releases) — look for tags like `desktop-v*`.

**From this repo:**

```bash
cd twin_md
npm ci
npm run build
npm run dev:desktop
```

**You do not start a second “web product.”** `npm run dev:desktop` runs Tauri, which in turn **starts Vite on `localhost:1420`** so the *native* window can load the UI with hot reload. That local URL is the desktop dev pipeline only — not the public site, and not something you open in a normal browser (the `apps/desktop` build is Tauri-only).

**Marketing / landing** lives in `apps/landing` and is deployed to [GitHub Pages](https://rzrizaldy.github.io/twin_md/). You only run `npm run dev:landing` when you are **editing** that site; day-to-day desk-app work does not use it.

## Everyday commands

```bash
twin-md init       # config, twin.md seed, Claude Desktop MCP wiring
twin-md harvest    # refresh twin.md from vault + local sources
twin-md watch      # terminal pet + reminders
twin-md mcp        # stdio MCP server (for Claude Desktop config)
```

## More

- [ARCHITECTURE.md](ARCHITECTURE.md) — harvest → interpret → surfaces
- [DESIGN_BRIEF.md](DESIGN_BRIEF.md) — visual direction
- `twin-md daemon` — background harvest + reminders

## From source (full monorepo)

```bash
git clone https://github.com/rzrizaldy/twin_md.git
cd twin_md
npm ci
npm run build
```

## Release

```bash
npm run build
./scripts/release.sh --dry-run
```

Tauri app bundles: `./scripts/release.sh --tauri` (creates a GitHub Release when `gh` is installed).
