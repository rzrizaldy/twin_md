import "./ensure-tauri.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dismissBubble } from "./ipc.ts";
import type { BubbleTone } from "./types.ts";

const art = document.getElementById("bubble-art") as HTMLImageElement;
const text = document.getElementById("bubble-text") as HTMLParagraphElement;
const dismiss = document.getElementById(
  "bubble-dismiss"
) as HTMLButtonElement;

const AUTO_DISMISS_MS = 45_000;

function readQuery(): {
  id: string;
  tone: BubbleTone;
  body: string;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get("id") ?? `bubble-${Date.now()}`,
    tone: (params.get("tone") as BubbleTone) ?? "soft",
    body: params.get("body") ?? "a small check-in."
  };
}

async function close() {
  const { id } = readQuery();
  await dismissBubble(id);
  await getCurrentWindow().close();
}

function render() {
  const { tone, body } = readQuery();
  document.body.setAttribute("data-tone", tone);
  art.src = `/bubbles/${tone}.svg`;
  text.textContent = body;
}

// Pausable countdown — freezes when the window is hidden (minimized, behind
// focus, or on a locked screen). Per IMPROVEMENT_PLAN §5.
let remaining = AUTO_DISMISS_MS;
let lastResume = performance.now();
let timer: number | null = null;

function pauseTimer() {
  if (timer === null) return;
  window.clearTimeout(timer);
  timer = null;
  remaining = Math.max(0, remaining - (performance.now() - lastResume));
}

function resumeTimer() {
  if (timer !== null) return;
  lastResume = performance.now();
  timer = window.setTimeout(close, remaining);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseTimer();
  } else {
    resumeTimer();
  }
});

render();
dismiss.addEventListener("click", close);
resumeTimer();
