import {
  getChatStatus,
  getState,
  onChatDone,
  onChatToken,
  onStateChanged,
  sendChat
} from "./ipc.ts";
import type { PetState } from "./types.ts";

const form = document.getElementById("chat-form") as HTMLFormElement;
const input = document.getElementById("chat-input") as HTMLTextAreaElement;
const send = document.getElementById("chat-send") as HTMLButtonElement;
const log = document.getElementById("chat-log") as HTMLElement;
const sprite = document.getElementById("chat-sprite") as HTMLImageElement;
const subtitle = document.getElementById("chat-subtitle") as HTMLElement;
const status = document.getElementById("chat-status") as HTMLDivElement;

let streaming: HTMLDivElement | null = null;
let current: PetState | null = null;

function appendMessage(role: "me" | "pet", body: string): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = body;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  return bubble;
}

function renderHeader(state: PetState) {
  sprite.src = `/pets/${state.species}/${state.state}/breath-a.svg`;
  subtitle.textContent = `${state.caption.toLowerCase()} · ${state.state.replace(/_/g, " ")}`;
}

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  appendMessage("me", message);
  input.value = "";
  send.disabled = true;
  streaming = appendMessage("pet", "…");
  streaming.textContent = "";
  try {
    await sendChat(message);
  } catch (error) {
    streaming.textContent = "sorry, I couldn't reply just now.";
    console.error(error);
    streaming = null;
    send.disabled = false;
  }
}

async function init() {
  current = await getState();
  if (current) renderHeader(current);

  await onStateChanged((next) => {
    current = next;
    renderHeader(next);
  });

  await onChatToken((chunk) => {
    if (!streaming) streaming = appendMessage("pet", "");
    streaming.textContent += chunk;
    log.scrollTop = log.scrollHeight;
  });

  await onChatDone(() => {
    streaming = null;
    send.disabled = false;
    input.focus();
  });

  form.addEventListener("submit", handleSubmit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  input.focus();
}

init().catch((error) => {
  console.error("chat init failed", error);
});
