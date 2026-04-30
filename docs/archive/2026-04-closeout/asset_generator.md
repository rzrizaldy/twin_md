# Asset Generator Prompt Templates

To ensure the assets you generate perfectly match the style of the existing frames for `twin.md`, use these prompt templates. They enforce the exact visual constraints requested in `DESIGN_BRIEF.md`.

## 1. Character Sprite Base Prompt

Use this exact structure for every character frame. Fill in the brackets based on the specific species, mood, and pose you are generating from `REMAINING_ASSETS.md`.

**Prompt Template:**
> "A cute, expressive 2D cartoon `[SPECIES]` `[POSE/ACTION]`. `[MOOD DETAILS]`. The `[SPECIES]` has a `[COLOR PALETTE]` and a dark outline. The art style features flat colors, absolutely no gradients, simple clean shapes, reminiscent of Animal Crossing or Tamagotchi character portraits. White background."

### Variables

**`[SPECIES]` & `[COLOR PALETTE]`**
*   **Cat:** `"cream body with light orange/accent details and a dark brown outline"`
*   **Slime:** `"mint green body with brighter green accents and a dark green outline"`
*   *(Axolotl for reference: "pink body with darker pink accents and a dark brown-purple outline")*

**`[MOOD DETAILS]`**
*   **Healthy:** `"Happy, blooming, showing off, bright and positive."`
*   **Sleep Deprived:** `"Sleep deprived, groggy, half-lidded sleepy eyes, tired."`
*   **Stressed:** `"Stressed, pacing anxiously, overstimulated, eyes scrunched tightly shut in a > < shape."`
*   **Neglected:** `"Neglected, lonely, looking away, quiet, deflated."`

**`[POSE/ACTION]`**
*   **`breath-a`:** `"in 'idle breath' pose (chest out, eyes open)"`
*   **`breath-b`:** `"in 'idle breath' pose (chest IN, slightly hunched, eyes open)"`
*   **`blink`:** `"blinking (eyes tightly closed)"`
*   **`reminder-speak`:** `"talking (ears/antenna/gills up, body tilted toward camera, mouth mid-speak)"`
*   **`reaction-happy`:** `"jumping happily (arms up, smiling wide, spinning or jumping)"`
*   **`reaction-wilt`:** `"wilting (drooping heavily, sad, deflated posture)"`
*   **`turn-front`:** `"front profile turnaround (facing directly at camera, symmetrical)"`
*   **`turn-3q`:** `"3-quarter turnaround (facing diagonally)"`

*(Example: "A cute, expressive 2D cartoon cat in 'idle breath' pose (chest IN, slightly hunched, eyes open). Sleep deprived, groggy, half-lidded sleepy eyes, tired. The cat has a cream body with light orange/accent details and a dark brown outline. The art style features flat colors, absolutely no gradients, simple clean shapes, reminiscent of Animal Crossing or Tamagotchi character portraits. White background.")*

---

## 2. World Scenes Base Prompt

The scenes require a specific structure so they look like they belong to the same isometric/2D spatial world.

**Prompt Template:**
> "A 2D vector art background of a `[SCENE DESCRIPTION]`. The art style features flat colors, no gradients, reminiscent of Animal Crossing or Cozy Grove backgrounds. Highly layered composition with distinct foreground, midground, and background. Consistent vanishing point."

### Variables

**`[SCENE DESCRIPTION]`**
*   **`sunny_island` (Healthy):** `"lush island at golden hour, 3 to 5 asymmetrical flowers in the foreground, 2 lazy clouds drifting in the sky, warm yellow sun disc top-right. Golden hour warm color palette."`
*   **`stars_at_noon` (Sleep Deprived):** `"daytime sky that forgot to finish, washed-out blue sky (not night), 6 faint stars visible, hushed desaturated clouds, faint crescent moon. Hushed, still mood."`
*   **`storm_room` (Stressed):** `"indoors interior, desk edge visible in foreground, surreal storm clouds inside the room raining, 3 scattered papers on the floor. Cold grey-blue palette with one warning-orange prop (like a pen or mug). High visual density."`
*   **`grey_nook` (Neglected):** `"an empty, quiet corner. 3 wilted plants in the foreground, outline of an empty chair, fog layer from the top down. Monochrome beige-grey palette, with one tiny point of color (a single un-wilted leaf)."`

---

## Next Steps
Once you generate these raster images externally (e.g., as PNGs or WebPs), drop them into the repository. Then you can utilize the `potrace` vectorization script to convert them all into the required `no raster embeds` layered SVGs automatically.
