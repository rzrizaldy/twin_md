# twin.md

**Live site:** [rzrizaldy.github.io/twin_md/](https://rzrizaldy.github.io/twin_md/)

A **local desktop companion** for **Obsidian + Claude Desktop**. It reads and writes notes, harvests local context into `~/.claude/twin.md`, renders a floating pet/chat window, and can queue approved actions for Claude Desktop through the bundled **MCP** server. State, sprites, action queues, and config live on your machine.

## Current release

`v0.5` focuses on the desktop companion:

- custom characters from prompts or uploaded photos
- `/change-char` for a brand-new sprite identity
- `/evolution` for image-to-image iterations from the current sprite
- chat backgrounds from built-in scenes or generated prompts
- Claude Desktop handoff queue with terminal approval
- English-by-default chat that mirrors Indonesian only when the latest message does

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
twin-md action list
twin-md action approve <id>
```

Desktop action handoff is explicit: chat queues an action as `needs_approval`, Terminal approval flips it to `pending`, and Claude Desktop can then call `get_pending_twin_actions` through MCP.

## Chat commands

```text
/change-char <description>      # new character from scratch
/change-char-photo <style>      # upload a photo, redraw as sprite
/evolution <small change>       # iterate current sprite, preserve identity
/change-background <scene|prompt>
/claude <desktop action>        # queue for Claude Desktop after approval
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
git tag v0.9.0
git push origin v0.9.0
```

Tauri app bundles: `./scripts/release.sh --tauri` (creates a GitHub Release when `gh` is installed).
