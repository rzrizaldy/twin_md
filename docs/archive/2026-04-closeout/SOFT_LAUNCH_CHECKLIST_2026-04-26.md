# Soft Launch Checklist - 2026-04-26

Scope: soft launch landing page, source/dev install, and desktop demo. No signed desktop binary promised.

## Summary
- Root build: passed.
- Dependency install dry-run: passed.
- Root typecheck: passed with one existing Astro hint in `ThemeToggle.astro`.
- Landing build: passed.
- Pet asset validation: passed.
- MCP import after build: passed.
- Desktop dev launch: passed with existing Rust dead-code warnings.
- GitHub Pages live routes: passed for home, install, meet, and world.
- Custom sprite evolution: preflight blocked on this machine until custom mode and `rembg` are enabled.

## Commands Run
- `npm run build`
- `npm ci --dry-run`
- `node -e "import('@twin-md/mcp').then(()=>console.log('mcp import ok'))"`
- `npm run typecheck`
- `npm run build:landing`
- `npm run lint`
- `npm run validate:pet-assets`
- `npm run dev:desktop`
- `curl -sI https://rzrizaldy.github.io/twin_md/`
- `curl -sI https://rzrizaldy.github.io/twin_md/install/`
- `curl -sI https://rzrizaldy.github.io/twin_md/meet/`
- `curl -sI https://rzrizaldy.github.io/twin_md/world/`

## Custom Sprite Evolution Preflight
Current local state:
- `spriteEvolution.kind`: `default`
- `spriteEvolution.customPrompt`: not set
- active credential provider: `openai`
- `rembg`: not found on PATH/common install paths

Expected behavior:
- Default Axiotyl should use bundled mood assets and should not run AI evolution.
- Manual regenerate should be disabled in the chat UI while `spriteEvolution.kind` is `default`.
- Custom sprite mode must be selected before AI evolution runs.
- OpenAI/Gemini sprite generation requires `rembg`; Anthropic can generate SVG sprites without `rembg`.

Tomorrow demo requirement:
1. Choose custom prompt mode in onboarding.
2. If using OpenAI/Gemini, click `install for me` for `rembg` or install `pipx install "rembg[cpu,cli]"`.
3. Generate preview.
4. Summon.
5. Use manual regenerate once or trigger a mood/environment change.
6. Confirm `~/.claude/twin.config.json` gets `spriteEvolution.currentPath` and the companion/chat sprite updates.

## Known Non-Blockers
- Workspace `lint` is still a no-op unless workspace packages add lint scripts.
- Rust emits existing dead-code warnings for unused helpers/fields.
- Astro reports one hint for `ThemeToggle.astro` using `define:vars`; no typecheck errors.

## Deferred
- Signed/notarized DMG release.
- Default Axiotyl AI evolution.
- Bundled native `rembg` sidecar.
- Full automated CI/test suite.
