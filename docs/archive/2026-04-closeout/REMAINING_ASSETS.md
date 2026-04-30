# Remaining Assets Generation Log

This document tracks the sprites and scene assets from `DESIGN_BRIEF.md`.

Repo truth was re-audited on 2026-04-22 after the PNG transition. All mascot
sprites are now shipped as colourful 1024×1024 PNGs; the previous
procedurally-generated SVG pipeline has been retired along with the 24 MB
`generated/pet-svg.ts` bundle it used to produce.

## 1. Character Sprites — 100% complete

Each `(species, state)` folder under `packages/core/assets/pets/` contains the
full 8-frame set as **colourful PNGs**: `breath-a`, `breath-b`, `blink`,
`reminder-speak`, `reaction-happy` / `reaction-wilt`, `turn-3q`, `turn-front`
(where applicable per state). Legacy `.svg` versions remain alongside the PNGs
so the desktop (`/pets/**.svg`) and landing pages keep working without a
rewrite, but the web companion and the pets API route now serve the PNGs.

### Axolotl
- [x] Healthy — colourful PNG set shipped
- [x] Sleep Deprived — colourful PNG set shipped
- [x] Stressed — colourful PNG set shipped
- [x] Neglected — colourful PNG set shipped
- [x] Terminal ASCII (`renderAsciiPet`) verified for all 4 moods

### Cat
**Palette**: cream `#ffe4b8`, accent `#f6b15d`, outline `#4b3a2a`
- [x] Healthy / Sleep Deprived / Stressed / Neglected — colourful PNG sets shipped
- [x] Turnarounds `turn-front` / `turn-3q` — PNG + SVG
- [x] Terminal ASCII verified for all 4 moods

### Slime
**Palette**: mint `#c4f2cb`, accent `#58cc7c`, outline `#30543d`
- [x] Healthy / Sleep Deprived / Stressed / Neglected — colourful PNG sets shipped
- [x] Turnarounds `turn-front` / `turn-3q` — PNG + SVG
- [x] Terminal ASCII verified for all 4 moods

## 2. World Scenes — migrated to colourful PNG

- [x] `sunny_island` (healthy) — serves `reference.png` via `/scenes/sunny_island.png`
- [x] `stars_at_noon` (sleep_deprived) — serves `reference.png`
- [x] `storm_room` (stressed) — serves `reference.png`
- [x] `grey_nook` (neglected) — serves `reference.png`

The old layered `composite.svg` files are kept on disk in case we want to
restore a parallax motion pass, but the web companion now uses the
full-colour PNG references directly.

## 3. Web & Terminal Polish
- [x] Reminder Bubbles (`soft.svg`, `groggy.svg`, `clipped.svg`, `quiet.svg`)
- [x] Design Tokens (`tokens.json`)
- [x] Gate 3 — terminal ASCII fallback verified for 3 species × 4 states
- [ ] Figma Source integration (Stretch goal)
- [ ] Lottie/MP4 formats (Stretch goal)

## 4. Bundle Footprint

- Core browser bundle (`@twin-md/core`): 11.4 KB
- Core server bundle (`@twin-md/core/server`): 68.7 KB
- Desktop chat webview bundle: 68 KB (previously 25 MB+ with inlined SVGs)
- No `node:fs` imports reach the client: browser root is fs-free by split.
