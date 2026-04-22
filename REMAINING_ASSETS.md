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
- [ ] Neglected (Partial: breath-a generated. Needs: breath-b, blink, speak, wilt)
- [x] Turnarounds: `turn-front.svg`, `turn-3q.svg`
- [x] Turnaround reference PNGs: `turn-front-reference.png`, `turn-3q-reference.png`
- [x] Terminal ASCII Text Files: 12 `.txt` files across the 4 moods

### Slime
**Color Palette**: mint `#c4f2cb`, accent `#58cc7c`, outline `#30543d`
- [ ] Healthy (Needs replacing - currently ugly placeholders)
- [ ] Sleep Deprived (Needs replacing)
- [ ] Stressed (Needs replacing)
- [ ] Neglected (Needs replacing)
- [x] Turnarounds: `turn-front.svg`, `turn-3q.svg`
- [x] Turnaround reference PNGs: `turn-front-reference.png`, `turn-3q-reference.png`
- [x] Terminal ASCII Text Files: 12 `.txt` files across the 4 moods

## 2. World Scenes
Each scene must be a layered SVG (sky, mid, floor, props, particles, composite).
- [ ] `sunny_island` layered SVG (healthy)
  Composite SVG generated.
- [ ] `stars_at_noon` layered SVG (sleep_deprived)
  Composite SVG generated.
- [ ] `storm_room` layered SVG (stressed)
  Composite SVG generated.
- [ ] `grey_nook` layered SVG (neglected)
  Composite SVG generated.

## 3. Web & Terminal Polish (Pending)
- [x] Reminder Bubbles (`soft.svg`, `groggy.svg`, `clipped.svg`, `quiet.svg`)
- [x] Design Tokens (`tokens.json`)
- [ ] Figma Source integration (Stretch goal)
- [ ] Lottie/MP4 formats (Stretch goal)
