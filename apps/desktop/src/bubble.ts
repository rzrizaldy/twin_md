import { getCurrentWindow } from "@tauri-apps/api/window";
import { dismissBubble } from "./ipc.ts";
import type { BubbleTone } from "./types.ts";

const art = document.getElementById("bubble-art") as HTMLImageElement;
const text = document.getElementById("bubble-text") as HTMLParagraphElement;
const dismiss = document.getElementById(
  "bubble-dismiss"
) as HTMLButtonElement;

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

render();
dismiss.addEventListener("click", close);

// Auto-dismiss per DESIGN_BRIEF §6: 45s
window.setTimeout(close, 45_000);
