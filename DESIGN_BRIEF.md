# twin.md — Designer Brief

Hand-off document for the designer. Everything needed to ship the visual layer of twin.md in one pass. Read top to bottom. Links point to the actual source files so you can see what the code already assumes.

---

## 1. Product one-liner + emotional promise

**twin.md is a desk creature that reads your second brain and decides whether to cheer, yawn, pace, or hide.**

It is a local-first sprite that sits beside you while you work. It reads a single file — `~/.claude/twin.md` — which is harvested from the user's own data (sleep, calendar, Obsidian notes, Claude memory, location). From that file, the creature forms a mood, populates a scene, and occasionally taps on the glass to remind the user of something they are ignoring.

It is not a dashboard. It is not a mascot. It is a small living thing that happens to be literate about your life.

**The feeling we are selling:**
- the warmth of an Animal Crossing villager waving when you log in
- the urgency of a Tamagotchi when you have neglected it
- the eye contact of a Nintendogs puppy when it wants a walk
- the seasonal warmth of a Stardew festival — rare, specific, remembered

**The feeling we are not selling:**
- corporate mascot energy (Slackbot, Clippy)
- Duolingo-owl passive aggression and guilt
- generic flat-vector SaaS illustration
- "cute" that is actually just rounded corners and pastel gradients with no soul

If a frame looks like it could be a Notion template illustration, it has failed.

---

## 2. Reference energy

Pull from:

- **Animal Crossing: New Horizons** — idle breathing loops, tool pickups, the moment before an animal speaks (little pause, then the bubble)
- **Tamagotchi** — urgency, dirt marks, "I need you" body language without words
- **Nintendogs** — eye contact as the primary expressive surface; nose nudges
- **Stardew Valley portraits** — stylized-but-warm color blocking, no gradients inside shapes
- **Cozy Grove** — low-saturation lighting, fog as a mood state, candle glow
- **Finji's Tunic** — confident silhouette, read at 32px
- **Studio Ghibli idle characters** — Totoro breathing, Kiki's Jiji sitting

Do not pull from:

- Duolingo, Grammarly, or any "productivity mascot"
- Notion / Loom flat vector illustration
- Apple's Memoji (too literal; the twin is an animal, not a person avatar)
- Generic "kawaii" sticker packs

---

## 3. Character bible

The code defines 3 species and 4 moods. Those are locked.

**Species** (from [packages/core/src/pet.ts](packages/core/src/pet.ts)):

| species | current palette | vibe |
| --- | --- | --- |
| `axolotl` | pink body `#ffd6e5`, accent `#ff92b2`, outline `#473643` | soft, curious, a little dramatic. The default. |
| `cat` | cream `#ffe4b8`, accent `#f6b15d`, outline `#4b3a2a` | self-contained, judgmental, secretly loyal. |
| `slime` | mint `#c4f2cb`, accent `#58cc7c`, outline `#30543d` | chaotic, bouncy, goofy. Lowest ego. |

You are allowed to refine these palettes during review gate 1. Keep outline colors — they have to read on a terminal black background too.

**Moods** (from [packages/core/src/interpret.ts](packages/core/src/interpret.ts)):

| mood id | caption (shown in UI) | emotional read | current hint |
| --- | --- | --- | --- |
| `healthy` | "Bloom Mode" | showing off, blooming, wants attention because life is good | eyes `^ ^`, mouth `v`, sunny island |
| `sleep_deprived` | "Stars At Noon" | groggy, half-lidded, reality has not loaded yet | eyes `- -`, stars still visible in daytime |
| `stressed` | "Paper Storm" | pacing, overstimulated, eyes scrunched `> <`, room is literally weather | storm cloud, rain indoors, paper on floor |
| `neglected` | "Quiet Corner" | the one that hurts. Not sad. Quiet. Fading. | body opacity drops to 0.82, wilted plants |

**Pose set — required per species × mood (12 combinations × 6 poses = 72 frames):**

1. **idle-breath A** — chest out, eyes open
2. **idle-breath B** — chest in, eyes open (for 2-frame breath loop, 2.2s cycle)
3. **blink** — one-frame flash of closed eyes
4. **reminder-speak** — ears/antenna/gills up, body tilted toward camera, mouth mid-speak (used when a reminder fires)
5. **reaction-happy** — for the healthy state only: jump/spin frame used when user acknowledges a reminder
6. **reaction-wilt** — for the neglected state only: droop frame used when reminders pile unacked

Plus **one front turnaround + one 3-quarter turnaround** per species to lock the silhouette.

**Silhouette test:** the pet must be recognizable at 32×32 px, black-on-white, no detail. Axolotl = frilled head. Cat = triangle ears. Slime = rounded dome with droop. If the silhouette fails, the pet fails.

---

## 4. World scenes

The webapp currently fakes the four scenes with CSS shapes in [packages/web/app/components/TwinPhoneShell.tsx](packages/web/app/components/TwinPhoneShell.tsx) (`SceneBackdrop`). Re-draw them at Animal Crossing quality. Same four scenes, same mood mapping.

Each scene is a **layered SVG** with at least: sky, middle-ground, floor, foreground props, particle layer. Layers must be separable so the webapp can animate them (parallax, drift, particle motion) without re-exporting.

**Scene 1 — `sunny_island` (healthy)**
- lush island at golden hour
- flowers in foreground (3–5, asymmetric)
- 2 lazy clouds drifting
- sparkle particles (existing CSS has `.sparkle-a`, `.sparkle-b` — keep two)
- palette skewed warm, yellow sun disc top-right
- pet plays idle-breath here

**Scene 2 — `stars_at_noon` (sleep_deprived)**
- daytime sky that forgot to finish — washed-out blue, not night
- 6 stars still visible (existing CSS has `.star-1` … `.star-6`)
- hushed clouds, desaturated
- a very faint crescent moon, barely there
- no pet motion noise — the whole frame is still

**Scene 3 — `storm_room` (stressed)**
- interior, indoors. Desk edge visible (existing CSS has `.desk-edge`)
- two storm clouds *inside the room* — surreal on purpose
- 4 rain drops (existing `.rain-1` … `.rain-4`), falling *inside*
- 3 scattered papers on the floor (existing `.paper-a/b/c`)
- palette: cold grey-blue, one warning-orange prop (a pen, a mug)
- high visual density, small pet in middle, pacing

**Scene 4 — `grey_nook` (neglected)**
- an empty corner. The only scene with no pet, almost
- pet is present but opacity 0.82 (already in code)
- 3 wilted plants (existing `.wilt-a/b/c`)
- chair outline, empty (existing `.chair-outline`)
- fog layer top-down (existing `.fog`)
- palette: monochrome beige-grey, one tiny point of color (a single un-wilted leaf) to hold hope
- motion: almost none. Pet does not look at camera.

**Scene consistency rules:**
- same vanishing point and camera height across all four
- same "grammar" of props (papers, plants, light source) but in different emotional states — so the user feels it is the *same room* changing with them
- scenes should hint that they are the same physical space rewritten by mood, like the room in Inside Out or Hades' House

---

## 5. Webapp layouts

There are two modes. The user toggles between them via `?layout=companion` vs `?layout=world`.

### 5a. Companion mode (the "while you work" view)

This is the hero experience. The user docks this in a browser side panel, a small window floating above Obsidian, or a Stream Deck preview. It is **the sprite visible next to your actual work**.

Layout:

- transparent body background so the user can overlay it or dock it
- fixed **320×320 px** sprite container, bottom-right
- floating speech bubbles emerge **above and to the left** of the sprite
- bubbles stack upward (newest on top)
- no chrome except a hair-thin opacity control
- breathing animation is the baseline state; reminder-speak fires on new reminders

Wireframe intent (mobile 390 px, desktop 1440 px):

```
Mobile Companion                  Desktop Companion
┌───────────────┐                 ┌─────────────────────────────┐
│               │                 │                             │
│   (bubble 2)  │                 │                             │
│   (bubble 1)  │                 │                             │
│      ╭──╮     │                 │                  (bubble 2) │
│      │🦎│     │                 │                  (bubble 1) │
│      ╰──╯     │                 │                      ╭──╮   │
└───────────────┘                 │                      │🦎│   │
                                  │                      ╰──╯   │
                                  └─────────────────────────────┘
```

### 5b. World mode (the full-scene view)

This is the current layout in [TwinPhoneShell.tsx](packages/web/app/components/TwinPhoneShell.tsx). Designer job: elevate it to the scene quality specified in section 4.

Layout as-is:
- header with eyebrow, title `twin.md`, scene caption
- 5 source badges (Health / Calendar / Claude Memory / Obsidian / Location)
- hero stage (the scene + pet + dialogue bubble)
- whisper row (3 short reason pills)
- story strip (3 cards: Scene Read, Latest Reflection, Backend Thread)
- chat card (textarea + "Ask twin" button)

Things to improve visually:
- replace the 5 source badges with 5 tiny stamp-style icons (health = heart, calendar = little island flag, claude = a book corner, obsidian = a diamond, location = a map pin) — still labeled on hover
- scene caption should feel like an Animal Crossing screen title (small drop shadow, serif display)
- dialogue bubble should match the reminder bubble language in section 6
- chat card should feel like talking to the creature, not to an AI — remove any robotic affordances

---

## 6. Reminder bubble UI

This is the mechanism of the sprite's *agency*. Reminders come from [packages/core/src/reminders.ts](packages/core/src/reminders.ts) (new) and appear as stacked speech bubbles in every surface.

**Bubble shape:**
- rounded rectangle with a tail pointing down toward the pet
- max width 280 px, wraps to multi-line
- hair-thin outline in the pet's outline color
- shadow: soft, 8 px blur, 8 % opacity, offset 0 / +6

**Per-state tone** (one variant per mood):

| state | bubble bg | text color | example copy |
| --- | --- | --- | --- |
| healthy (soft) | `#fff8d2` cream | `#4b3a2a` | "hey, your focus streak is actually happening. keep going." |
| sleep_deprived (groggy) | `#d5d8ff` pale lavender | `#3a3a66` | "…five hours last night. can we just, uh, sit for a sec." |
| stressed (clipped) | `#ffe1d4` warning peach | `#a34a1f` | "density 0.87 and zero deep blocks. pick one thing." |
| neglected (quiet) | `#e6e2d4` grey-beige | `#544e3c` | "the plants noticed. come back?" |

**Interaction:**
- click the bubble to dismiss (fires acknowledge)
- bubbles auto-dismiss after 45 seconds if not interacted with, but stay in the ledger
- a "nevermind" small link dismisses without marking acknowledged (user is saying "saw it, won't act")

**Stacking rule:**
- max 3 bubbles visible at once
- older bubbles fade toward 40 % opacity
- 4th reminder displaces the oldest; the displaced one is still in `/api/reminders` but no longer rendered

**Motion language:**
- bubble appears with a 220 ms pop (scale 0.92 → 1.02 → 1.0) and the pet performs `reminder-speak` frame for the same 220 ms
- on dismiss, bubble slides up 12 px and fades 180 ms; pet returns to `idle-breath`
- avoid any "bounce" feel on the bubble itself; the *pet* is what bounces, the bubble is steady

---

## 7. Terminal ASCII style

The terminal surface is rendered in [packages/cli/src/ui/TwinWatchApp.tsx](packages/cli/src/ui/TwinWatchApp.tsx) using `ink` (React for terminals). Current ASCII is a 5-line pet. Raise it to a 12-line pet, with distinct frames per mood, so the breath and blink read from across the room.

**Specs:**
- max 32 rows tall, 28 columns wide (fits inside a tmux pane)
- 3 species × 4 moods × 2 breath frames + 1 blink frame = 36 ASCII frames to deliver
- monospace assumed; no box-drawing characters that break on Windows terminals (stick to `/ \ | _ - ( ) { } [ ] o * . ~`)
- color per state, via ANSI 256:
  - healthy: `green` (existing `getStateColor` returns this)
  - sleep_deprived: `yellow`
  - stressed: `red`
  - neglected: `gray`
- palette is locked at that 4-color level so accessibility over SSH is guaranteed

Deliver the ASCII as **plain `.txt` files**, one per frame, so we can swap them without touching code. Naming:

```
packages/core/assets/pets/{species}/{mood}/{frame}.txt
  e.g. packages/core/assets/pets/axolotl/stressed/breath-a.txt
```

**Reminder bubble in terminal:** render above the pet with `ink-box`-style ASCII borders (we will supply a template). The bubble quotes the reminder body. On dismiss (pressing `d`), the bubble ASCII animates up two rows then disappears.

---

## 8. Design tokens

Deliver as a single `tokens.json` (Style Dictionary compatible) so we can wire it into CSS custom properties once.

**Palette tokens:**

- `color.state.healthy.fg` / `.bg` / `.accent`
- `color.state.sleep_deprived.fg` / `.bg` / `.accent`
- `color.state.stressed.fg` / `.bg` / `.accent`
- `color.state.neglected.fg` / `.bg` / `.accent`
- `color.species.axolotl.body` / `.accent` / `.blush` / `.glow` / `.outline`
- (same for cat, slime)
- `color.bubble.soft` / `.groggy` / `.clipped` / `.quiet`

**Typography:**
- `font.display` — serif with warmth, suggestion: Fraunces or Young Serif (free). Used for captions, world-mode title.
- `font.body` — humanist sans with a slight bounce, suggestion: Inter Tight or Recursive Sans. Used for bubbles and story cards.
- `font.terminal` — JetBrains Mono or Berkeley Mono. Used in the CLI only.
- Scale: 12 / 14 / 16 / 20 / 28 / 40. No other sizes.

**Motion:**
- `motion.breath.duration` = 2200ms, ease `easeInOut`
- `motion.blink.duration` = 120ms
- `motion.bubble.pop` = 220ms, custom spring (see section 6)
- `motion.stressed.pace` = 1200ms (existing code uses this)
- `motion.reaction.happy` = 600ms, ease `backOut`

**Sound (optional, stretch):**
- `sound.reminder_appear.wav` — short soft wood-knock, like an AC villager opening speech
- `sound.acknowledge.wav` — soft chime
- `sound.neglect_fade.wav` — very low drone, 2s, only for neglected mood

Sound is optional for v1. If delivered, deliver it muted-by-default in the webapp with a single toggle in companion mode.

---

## 9. Deliverables & file formats

Everything ships into `packages/core/assets/` in this structure:

```
packages/core/assets/
  pets/
    axolotl/
      healthy/
        breath-a.svg
        breath-b.svg
        blink.svg
        reminder-speak.svg
        reaction-happy.svg
        breath-a.txt            # ASCII version
        breath-b.txt
        ...
      sleep_deprived/
      stressed/
      neglected/
    cat/ (same structure)
    slime/ (same structure)
  scenes/
    sunny_island/
      layer-sky.svg
      layer-mid.svg
      layer-floor.svg
      layer-props.svg
      layer-particles.svg
      composite.svg           # preview only, layered export
    stars_at_noon/ (same)
    storm_room/ (same)
    grey_nook/ (same)
  bubbles/
    soft.svg
    groggy.svg
    clipped.svg
    quiet.svg
  tokens.json
  figma-source.fig           # master file, linked in repo README
```

**Format rules:**
- SVG must be single-artboard, 256×256 for pets, 1440×900 for scenes (16:10 to fit most screens; we will crop to mobile via CSS)
- no raster embeds inside SVG (no `<image href="data:image/png">`)
- text should be converted to outlines if custom font is used
- colors should reference tokens where possible (we will handle variable substitution at build time)
- layer IDs must match the names in this brief exactly so CSS can target them

**Optional stretch deliverables:**
- Lottie JSON of `reminder-speak` for the webapp (not required; we can stitch SVG frames)
- 60 fps MP4 loop of each mood for marketing

---

## 10. Timeline and three review gates

Estimated effort: 10–14 designer days depending on ASCII appetite.

**Gate 1 — Character sheet (day 3)**
- all 3 species × 4 moods × 6 poses (SVG only, no scenes yet)
- refined species palettes
- silhouette test at 32 px passes
- ASCII variants for any one species (axolotl) as a pilot
- Review: does each mood feel distinct at a glance? Does the neglected pose actually hurt a little?

**Gate 2 — World scenes (day 7)**
- all 4 scenes, layered SVG, composite previews
- pet placed in each scene (composite preview)
- bubble variants per mood
- Review: do the four scenes feel like the same room in four emotional weathers?

**Gate 3 — Web + terminal polish (day 12)**
- ASCII pack complete (all 36 frames)
- companion mode + world mode mocks in Figma, mobile and desktop
- tokens.json final
- motion spec documented (either in Figma or Principle file)
- Review: does companion mode feel like something I would leave open all day? Does it respect me?

---

## 11. Ground truth & constraints

- **Local-first.** There is no cloud. No telemetry. No login. The sprite reads a local file and renders. Design around that: the creature should never feel like it is "online", it should feel like it lives on this machine. No loading spinners. No cloud icons.
- **Backend is immovable.** The 4 states, 3 species, 5 data sources, and the single-file `twin.md` architecture are fixed. See [ARCHITECTURE.md](ARCHITECTURE.md). Design around the contract, not away from it.
- **The pet is not a brand.** It is a creature. It does not have a logo lockup. It does not have a tagline. twin.md is a lowercase, file-path name on purpose.
- **Accessibility floor:** all bubble copy must be readable at 4.5:1 contrast on the specified bg. Color must not be the only signal — every state also differs in pose, animation, and caption.
- **Do not over-polish.** A small amount of hand-drawn wobble on outlines is encouraged. The creature should look like somebody made it, not like a component library.

---

## 12. Questions back to us

If any of the following are unclear, block on us before drawing:

- refined species palette ranges (we are open to shifts, outlines stay)
- whether the slime gets internal bubble textures or stays solid
- whether reminder bubbles should have a **tail pointing to the exact pet eye** or just downward (designer preference; we'll follow)
- whether companion mode should support a second docked position (bottom-left) — nice to have, not required

Everything else is locked. Ship.
