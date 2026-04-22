import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getState,
  onReminder,
  onStateChanged,
  openChat
} from "./ipc.ts";
import type { PetState, TwinMood, TwinSpecies } from "./types.ts";

const sprite = document.getElementById("sprite") as HTMLImageElement;
const pet = document.getElementById("pet") as HTMLDivElement;
const caption = document.getElementById("caption") as HTMLDivElement;

const DEFAULT_STATE: PetState = {
  species: "cat",
  state: "healthy",
  energy: 80,
  stress: 20,
  glow: 75,
  environment: "sunny_island",
  animation: "dancing",
  caption: "Bloom Mode",
  scene: "",
  message: "",
  reason: [],
  updated: new Date().toISOString(),
  sourceUpdated: new Date().toISOString(),
  color: "#ffb86c"
};

let current: PetState = DEFAULT_STATE;
let frame: "breath-a" | "breath-b" = "breath-a";
let blinkTimer: number | null = null;

function pngPath(species: TwinSpecies, mood: TwinMood, frameName: string): string {
  return `/pets/${species}/${mood}/${frameName}-reference.png`;
}

function svgPath(species: TwinSpecies, mood: TwinMood, frameName: string): string {
  return `/pets/${species}/${mood}/${frameName}.svg`;
}

const missingPngs = new Set<string>();

function setSpriteFor(
  species: TwinSpecies,
  mood: TwinMood,
  frameName: string
) {
  const pngKey = `${species}/${mood}/${frameName}`;
  if (missingPngs.has(pngKey)) {
    sprite.src = svgPath(species, mood, frameName);
    return;
  }
  const png = pngPath(species, mood, frameName);
  sprite.src = png;
  sprite.onerror = () => {
    missingPngs.add(pngKey);
    sprite.onerror = null;
    sprite.src = svgPath(species, mood, frameName);
  };
}

function render() {
  setSpriteFor(current.species, current.state, frame);
  caption.textContent = current.caption.toLowerCase();
  caption.hidden = false;
}

function breathLoop() {
  setInterval(() => {
    frame = frame === "breath-a" ? "breath-b" : "breath-a";
    pet.classList.toggle("is-breath-a", frame === "breath-a");
    pet.classList.toggle("is-breath-b", frame === "breath-b");
    render();
  }, 2200);
}

function scheduleBlink() {
  if (blinkTimer !== null) window.clearTimeout(blinkTimer);
  const delay = 4000 + Math.random() * 3000;
  blinkTimer = window.setTimeout(() => {
    if (!current) {
      scheduleBlink();
      return;
    }
    setSpriteFor(current.species, current.state, "blink");
    window.setTimeout(() => {
      render();
      scheduleBlink();
    }, 120);
  }, delay);
}

function attachInteractions() {
  const win = getCurrentWindow();
  const chatButton = document.getElementById("chat-button") as HTMLButtonElement;

  chatButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await openChat();
    } catch (err) {
      console.error("open_chat failed", err);
    }
  });

  // Tilt toward cursor
  window.addEventListener("mousemove", (event) => {
    const rect = pet.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const deltaX = (event.clientX - centerX) / rect.width;
    const tilt = Math.max(-6, Math.min(6, deltaX * 12));
    pet.style.setProperty("--tilt", `${tilt.toFixed(2)}deg`);
    pet.classList.add("is-hover");
  });

  window.addEventListener("mouseout", () => {
    pet.classList.remove("is-hover");
  });

  win.onCloseRequested(() => {
    if (blinkTimer !== null) window.clearTimeout(blinkTimer);
  });
}

async function init() {
  // Paint the default sprite immediately so the window never looks empty.
  render();

  const fetched = await getState();
  if (fetched) {
    current = fetched;
    render();
  }

  await onStateChanged((next) => {
    current = next;
    render();
  });

  await onReminder((reminder) => {
    // Reminders are shown by the bubble window spawned from Rust.
    // Here we just highlight the pet briefly.
    pet.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-6px) scale(1.04)" },
        { transform: "translateY(0) scale(1)" }
      ],
      { duration: 600, easing: "cubic-bezier(0.175,0.885,0.32,1.275)" }
    );
    console.debug("reminder fired", reminder.id);
  });

  breathLoop();
  scheduleBlink();
  attachInteractions();
}

init().catch((error) => {
  console.error("companion init failed", error);
});
