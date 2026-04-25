import "./ensure-tauri.ts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getState,
  getSpriteEvolution,
  emitLastChat,
  onChatDone,
  onChatToken,
  onLastChat,
  onReminder,
  onStateChanged,
  onSpriteUpdated,
  onSpriteEvolving,
  onSpriteEvolveError,
  onSpriteEvolveCooldown,
  openChatWindow,
  saveChatSession,
  sendChat,
} from "./ipc.ts";
import type { PetState, Reminder, TwinMood, TwinSpecies } from "./types.ts";

// ── Pet sprite elements ──────────────────────────────────────────────────────

const spriteWrap = document.getElementById("sprite-wrap") as HTMLDivElement | null;
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
let evolutionSpritePath: string | null = null;
let lastChatPreview = "";

// ── Sprite helpers ───────────────────────────────────────────────────────────

function pngPath(species: TwinSpecies, mood: TwinMood, frameName: string): string {
  return `/pets/${species}/${mood}/${frameName}.png`;
}

function setSpriteFor(species: TwinSpecies, mood: TwinMood, frameName: string) {
  sprite.src = pngPath(species, mood, frameName);
}

function compactPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 420 ? `${normalized.slice(0, 417).trim()}…` : normalized;
}

function setLastChatPreview(text: string) {
  lastChatPreview = compactPreview(text);
  renderAmbientBubble();
}

function renderAmbientBubble() {
  const shouldShowOnHover = Boolean(lastChatPreview) && bubble.dataset.state === "hidden";
  ambientBubble.textContent = lastChatPreview;
  ambientBubble.hidden = !lastChatPreview;
  ambientBubble.setAttribute("aria-hidden", shouldShowOnHover ? "false" : "true");
}

function render() {
  if (evolutionSpritePath) {
    spriteWrap?.classList.add("has-evolved-sprite");
    sprite.src = convertFileSrc(evolutionSpritePath);
  } else {
    spriteWrap?.classList.remove("has-evolved-sprite");
    setSpriteFor(current.species, current.state, "breath-a");
  }
  caption.textContent = current.caption.toLowerCase();
  caption.hidden = false;
  bubble.dataset.tone = current.state.replace("_", "-");
  renderAmbientBubble();
}

function breathLoop() {
  setInterval(() => {
    pet.classList.toggle("is-breath-b");
    pet.classList.toggle("is-breath-a", !pet.classList.contains("is-breath-b"));
  }, 2200);
}

// ── Speech bubble state machine ──────────────────────────────────────────────

type BubbleState = "hidden" | "input" | "streaming" | "done";

function setBubbleState(state: BubbleState) {
  bubble.dataset.state = state;
  if (state === "hidden") {
    bubble.style.display = "none";
  } else {
    bubble.style.display = "flex";
  }
  renderAmbientBubble();
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
      setLastChatPreview(activeAssistantText);
      void emitLastChat(activeAssistantText);
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
    setLastChatPreview("hmm, something went wrong. try again?");
    setBubbleState("done");
  }
}

async function logSessionToVault() {
  if (sessionTurns.length === 0) return;
  try {
    await saveChatSession(sessionId, sessionTurns);
  } catch {
    // Vault log is best-effort — don't surface errors to user
  }
}

// ── Interactions ─────────────────────────────────────────────────────────────

function attachInteractions() {
  const win = getCurrentWindow();
  const chatButton = document.getElementById("chat-button") as HTMLButtonElement;

  // Dragging the pet moves the native transparent companion window.
  // Chat stays available through the button so the sprite remains a drag handle.
  let mouseDownX = 0;
  let mouseDownY = 0;
  pet.removeAttribute("data-tauri-drag-region");
  pet.addEventListener("mousedown", async (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, textarea, input, form, a")) return;

    mouseDownX = e.screenX;
    mouseDownY = e.screenY;
    try {
      await win.startDragging();
    } catch (err) {
      console.debug("native drag unavailable", err);
    }
  });
  pet.addEventListener("click", async (e) => {
    const dx = Math.abs(e.screenX - mouseDownX);
    const dy = Math.abs(e.screenY - mouseDownY);
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

  // Expand opens the dedicated chat panel (same as "chat" button).
  bubbleExpand.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await openChatWindow();
    } catch (err) {
      console.error("openChatWindow from expand failed", err);
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
    logSessionToVault();
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Initialize bubble as hidden
  setBubbleState("hidden");

  // Paint the default sprite immediately so the window never looks empty.
  render();

  try {
    const evo = await getSpriteEvolution();
    if (evo.currentPath) {
      evolutionSpritePath = evo.currentPath;
      render();
    }
  } catch {
    // Non-fatal; bundled sprites are always available.
  }

  const fetched = await getState();
  if (fetched) {
    current = fetched;
    render();
  }

  await onStateChanged((next) => {
    current = next;
    render();
  });

  void onSpriteEvolving(() => {
    spriteWrap?.classList.add("is-evolving");
  });

  void onSpriteEvolveError(() => {
    spriteWrap?.classList.remove("is-evolving");
  });

  void onSpriteEvolveCooldown(() => {
    spriteWrap?.classList.remove("is-evolving");
  });

  void onLastChat((message) => {
    setLastChatPreview(message);
  });

  void onSpriteUpdated((payload) => {
    const url = convertFileSrc(payload.path);
    const next = new Image();
    next.onload = () => {
      evolutionSpritePath = payload.path;
      spriteWrap?.classList.remove("is-evolving");
      spriteWrap?.classList.add("sprite-swap");
      render();
      setTimeout(() => spriteWrap?.classList.remove("sprite-swap"), 280);
    };
    next.onerror = () => {
      spriteWrap?.classList.remove("is-evolving");
    };
    next.src = url;
  });

  await onReminder((reminder: Reminder) => {
    // Auto-open the speech bubble with the reminder text
    sessionTurns = [];
    sessionId = crypto.randomUUID();
    bubble.dataset.tone = reminder.tone;
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
  attachInteractions();
}

init().catch((error) => {
  console.error("companion init failed", error);
});
