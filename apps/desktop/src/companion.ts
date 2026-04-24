import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getState,
  onChatDone,
  onChatToken,
  onReminder,
  onStateChanged,
  openChatWindow,
  openWebCompanion,
  sendChat,
} from "./ipc.ts";
import type { PetState, Reminder, TwinMood, TwinSpecies } from "./types.ts";

// ── Pet sprite elements ──────────────────────────────────────────────────────

const sprite = document.getElementById("sprite") as HTMLImageElement;
const pet = document.getElementById("pet") as HTMLDivElement;
const ambientBubble = document.getElementById("ambient-bubble") as HTMLDivElement;
const caption = document.getElementById("caption") as HTMLDivElement;

// ── Speech bubble elements ───────────────────────────────────────────────────

const bubble = document.getElementById("speech-bubble") as HTMLDivElement;
const bubbleContent = document.getElementById("bubble-content") as HTMLDivElement;
const bubbleForm = document.getElementById("bubble-form") as HTMLFormElement;
const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;
const bubbleExpand = document.getElementById("bubble-expand") as HTMLButtonElement;

// ── Default state ────────────────────────────────────────────────────────────

const DEFAULT_STATE: PetState = {
  species: "axolotl",
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
  color: "#8b5cf6"
};

let current: PetState = DEFAULT_STATE;
let frame: "breath-a" | "breath-b" = "breath-a";
let blinkTimer: number | null = null;

// ── Sprite helpers ───────────────────────────────────────────────────────────

function pngPath(species: TwinSpecies, mood: TwinMood, frameName: string): string {
  return `/pets/${species}/${mood}/${frameName}.png`;
}

function setSpriteFor(species: TwinSpecies, mood: TwinMood, frameName: string) {
  sprite.src = pngPath(species, mood, frameName);
}

function render() {
  setSpriteFor(current.species, current.state, frame);
  caption.textContent = current.caption.toLowerCase();
  caption.hidden = false;
  ambientBubble.textContent = current.message || current.caption;
  ambientBubble.hidden = bubble.dataset.state !== "hidden";
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

// ── Speech bubble state machine ──────────────────────────────────────────────

type BubbleState = "hidden" | "input" | "streaming" | "done";

function setBubbleState(state: BubbleState) {
  bubble.dataset.state = state;
  if (state === "hidden") {
    bubble.style.display = "none";
    ambientBubble.hidden = false;
  } else {
    bubble.style.display = "flex";
    ambientBubble.hidden = true;
  }
}

function openBubble(prefill?: string) {
  if (prefill) {
    bubbleContent.innerHTML = `<p class="bubble-message bubble-message--pet">${escapeHtml(prefill)}</p>`;
    setBubbleState("done");
  } else {
    setBubbleState("input");
  }
  bubbleInput.focus();
}

function closeBubble() {
  setBubbleState("hidden");
  bubbleContent.innerHTML = "";
  bubbleInput.value = "";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Track streaming state for session log
let sessionTurns: Array<{ role: "user" | "assistant"; content: string; ts: string }> = [];
let sessionId = crypto.randomUUID();
let activeAssistantEl: HTMLParagraphElement | null = null;
let activeAssistantText = "";
let chatDoneUnlisten: (() => void) | null = null;
let chatTokenUnlisten: (() => void) | null = null;

async function submitMessage(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Clear previous token listeners before starting a new request
  if (chatTokenUnlisten) {
    chatTokenUnlisten();
    chatTokenUnlisten = null;
  }
  if (chatDoneUnlisten) {
    chatDoneUnlisten();
    chatDoneUnlisten = null;
  }

  // Append user message to bubble content
  const userMsg = document.createElement("p");
  userMsg.className = "bubble-message bubble-message--user";
  userMsg.textContent = trimmed;
  bubbleContent.appendChild(userMsg);

  sessionTurns.push({ role: "user", content: trimmed, ts: new Date().toISOString() });

  // Prepare assistant message placeholder
  const petMsg = document.createElement("p");
  petMsg.className = "bubble-message bubble-message--pet";
  bubbleContent.appendChild(petMsg);
  activeAssistantEl = petMsg;
  activeAssistantText = "";

  // Scroll to bottom
  bubbleContent.scrollTop = bubbleContent.scrollHeight;

  setBubbleState("streaming");
  bubbleInput.value = "";

  // Subscribe to token stream
  chatTokenUnlisten = await onChatToken((chunk) => {
    activeAssistantText += chunk;
    if (activeAssistantEl) {
      activeAssistantEl.textContent = activeAssistantText;
      bubbleContent.scrollTop = bubbleContent.scrollHeight;
    }
  });

  chatDoneUnlisten = await onChatDone(() => {
    if (activeAssistantEl && activeAssistantText) {
      sessionTurns.push({
        role: "assistant",
        content: activeAssistantText,
        ts: new Date().toISOString(),
      });
    }
    activeAssistantEl = null;
    activeAssistantText = "";
    setBubbleState("done");
    bubbleInput.focus();
    logSessionToVault();
  });

  try {
    await sendChat(trimmed);
  } catch (err) {
    console.error("sendChat failed", err);
    if (activeAssistantEl) {
      activeAssistantEl.textContent = "hmm, something went wrong. try again?";
    }
    setBubbleState("done");
  }
}

async function logSessionToVault() {
  if (sessionTurns.length === 0) return;
  try {
    await fetch("/api/chat/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, turns: sessionTurns }),
    });
  } catch {
    // Vault log is best-effort — don't surface errors to user
  }
}

// ── Interactions ─────────────────────────────────────────────────────────────

function attachInteractions() {
  const win = getCurrentWindow();
  const chatButton = document.getElementById("chat-button") as HTMLButtonElement;

  // Clicking the pet sprite opens the dedicated chat window.
  // We track mousedown position to distinguish click from drag.
  let mouseDownX = 0;
  let mouseDownY = 0;
  pet.removeAttribute("data-tauri-drag-region");
  pet.addEventListener("mousedown", (e) => {
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
  });
  pet.addEventListener("click", async (e) => {
    const dx = Math.abs(e.clientX - mouseDownX);
    const dy = Math.abs(e.clientY - mouseDownY);
    if (dx < 6 && dy < 6) {
      e.stopPropagation();
      try {
        await openChatWindow();
      } catch (err) {
        console.error("openChatWindow failed", err);
      }
    }
  });

  // "chat" button opens the dedicated chat window (Dinoki-style).
  chatButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await openChatWindow();
    } catch (err) {
      // Fall back to inline bubble if chat window can't open.
      if (bubble.dataset.state !== "hidden") {
        closeBubble();
      } else {
        openBubble();
      }
    }
  });

  // Close bubble when clicking outside of it
  document.addEventListener("click", (event) => {
    if (
      bubble.dataset.state !== "hidden" &&
      !bubble.contains(event.target as Node) &&
      event.target !== chatButton
    ) {
      closeBubble();
    }
  });

  const webButton = document.getElementById("web-button") as HTMLButtonElement | null;
  if (webButton) {
    webButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await openWebCompanion();
      } catch (err) {
        // Show the error inline in the bubble so the user knows what happened
        openBubble("web companion isn't running — start it with `pnpm --filter @twin-md/web dev` or set TWIN_WEB_URL.");
        console.error("open_web_companion failed", err);
      }
    });
  }

  // Expand button opens web companion
  bubbleExpand.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await openWebCompanion();
    } catch (err) {
      console.error("open_web_companion from expand failed", err);
    }
  });

  // Form submit
  bubbleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = bubbleInput.value;
    if (text.trim() && bubble.dataset.state !== "streaming") {
      await submitMessage(text);
    }
  });

  // Allow Shift+Enter for newline, Enter to submit
  bubbleInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const text = bubbleInput.value;
      if (text.trim() && bubble.dataset.state !== "streaming") {
        await submitMessage(text);
      }
    }
  });

  // Escape closes bubble
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && bubble.dataset.state !== "hidden") {
      closeBubble();
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
    logSessionToVault();
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Initialize bubble as hidden
  setBubbleState("hidden");

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

  await onReminder((reminder: Reminder) => {
    // Auto-open the speech bubble with the reminder text
    sessionTurns = [];
    sessionId = crypto.randomUUID();
    openBubble(reminder.body);

    // Also animate the pet briefly
    pet.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-6px) scale(1.04)" },
        { transform: "translateY(0) scale(1)" },
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
