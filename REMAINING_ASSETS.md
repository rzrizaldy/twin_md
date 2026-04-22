# Remaining Assets Generation Log

This document tracks the remaining sprites and assets from `DESIGN_BRIEF.md`.

Repo truth was re-audited on 2026-04-21 after the image generation pass. This file now distinguishes between generated raster references and final repo-native SVG / ASCII deliverables.

## 1. Character Sprites

### Axolotl
- [x] Healthy (All SVGs generated)
- [x] Sleep Deprived (All SVGs generated)
- [x] Stressed (All SVGs generated)
- [x] Neglected (All SVGs generated)
- [x] Turnarounds: `turn-front.svg`, `turn-3q.svg`
- [x] Terminal ASCII Text Files (All 4 moods completed)

### Cat
**Color Palette**: cream `#ffe4b8`, accent `#f6b15d`, outline `#4b3a2a`
- [x] Healthy (All SVGs generated)
- [x] Sleep Deprived (All SVGs generated)
- [x] Stressed (All SVGs generated)
- [x] Neglected (All SVGs generated)
- [ ] Turnarounds: `turn-front.svg`, `turn-3q.svg`
- [x] Turnaround reference PNGs: `turn-front-reference.png`, `turn-3q-reference.png`
- [ ] Terminal ASCII Text Files: 12 `.txt` files across the 4 moods

### Slime
**Color Palette**: mint `#c4f2cb`, accent `#58cc7c`, outline `#30543d`
- [x] Healthy (All SVGs generated)
- [x] Sleep Deprived (All SVGs generated)
- [x] Stressed (All SVGs generated)
- [x] Neglected (All SVGs generated)
- [ ] Turnarounds: `turn-front.svg`, `turn-3q.svg`
- [x] Turnaround reference PNGs: `turn-front-reference.png`, `turn-3q-reference.png`
- [ ] Terminal ASCII Text Files: 12 `.txt` files across the 4 moods

## 2. World Scenes
Each scene must be a layered SVG (sky, mid, floor, props, particles, composite).
- [ ] `sunny_island` layered SVG (healthy)
  Reference PNG generated: `packages/core/assets/scenes/sunny_island/reference.png`
- [ ] `stars_at_noon` layered SVG (sleep_deprived)
  Reference PNG generated: `packages/core/assets/scenes/stars_at_noon/reference.png`
- [ ] `storm_room` layered SVG (stressed)
  Reference PNG generated: `packages/core/assets/scenes/storm_room/reference.png`
- [ ] `grey_nook` layered SVG (neglected)
  Reference PNG generated: `packages/core/assets/scenes/grey_nook/reference.png`

## 3. Web & Terminal Polish (Pending)
- [x] Reminder Bubbles (`soft.svg`, `groggy.svg`, `clipped.svg`, `quiet.svg`)
- [x] Design Tokens (`tokens.json`)
- [ ] Figma Source integration (Stretch goal)
- [ ] Lottie/MP4 formats (Stretch goal)
