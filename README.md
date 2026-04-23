# twin.md

**Live site:** [rzrizaldy.github.io/twin_md/](https://rzrizaldy.github.io/twin_md/)

A local-first desk creature that reads your second brain and mirrors how you are doing — cheer, yawn, pace, or go quiet. Everything important lives in `~/.claude/twin.md` and `~/.claude/twin-state.json` on your machine.

## Install

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

## Everyday commands

```bash
twin-md init       # config, twin.md seed, Claude Desktop MCP wiring
twin-md harvest    # refresh twin.md from your local sources
twin-md watch      # terminal pet + reminders
twin-md web        # island mirror at http://127.0.0.1:4730/ (web-lite, no Next.js)
```

Optional: `twin-md web --host 0.0.0.0` for LAN + QR. Legacy Next app: `twin-md web --next`.

Desktop tray **Open in browser** uses that URL when web-lite is running; otherwise it opens the GitHub Pages site above.

## Web mirror (web-lite)

` twin-md web` serves a small **Animal Crossing–style island** view: composite scene, pet sprite, caption and line from `twin-state.json`. It does not run chat (replies stay in the desktop pet). No separate `localhost:3000` requirement.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md) — harvest → interpret → surfaces
- [DESIGN_BRIEF.md](DESIGN_BRIEF.md) — visual direction
- `twin-md mcp` — stdio MCP server for Claude Desktop
- `twin-md daemon` — background harvest + reminders

## From source

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
