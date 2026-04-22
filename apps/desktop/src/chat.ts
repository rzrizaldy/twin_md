import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  chipCommands,
  matchSlashCommands,
  parseSlashCommand,
  renderHelpMarkdown,
  PET_WELLNESS_SYSTEM_PROMPT,
  type SlashCommand
} from "@twin-md/core/chat-commands";
import {
  getChatStatus,
  getState,
  onChatDone,
  onChatToken,
  onStateChanged,
  runLocalCommand,
  sendChat,
  streamSlashCommand
} from "./ipc.ts";
import type { PetState } from "./types.ts";

const form = document.getElementById("chat-form") as HTMLFormElement;
const input = document.getElementById("chat-input") as HTMLTextAreaElement;
const send = document.getElementById("chat-send") as HTMLButtonElement;
const log = document.getElementById("chat-log") as HTMLElement;
const sprite = document.getElementById("chat-sprite") as HTMLImageElement;
const subtitle = document.getElementById("chat-subtitle") as HTMLElement;
const status = document.getElementById("chat-status") as HTMLDivElement;
const chipRow = document.getElementById("chat-chips") as HTMLDivElement;
const autocomplete = document.getElementById(
  "chat-autocomplete"
) as HTMLDivElement;

marked.setOptions({ breaks: true, gfm: true });

let streaming: { el: HTMLDivElement; buffer: string } | null = null;
let current: PetState | null = null;

function renderMarkdown(body: string): string {
  const raw = marked.parse(body, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr"
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"]
  });
}

function appendUserMessage(body: string): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble me";
  bubble.textContent = body;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  return bubble;
}

function appendPetBubble(initial = ""): { el: HTMLDivElement; buffer: string } {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble pet";
  if (initial) {
    bubble.innerHTML = renderMarkdown(initial);
  }
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  return { el: bubble, buffer: initial };
}

function renderHeader(state: PetState) {
  sprite.src = `/pets/${state.species}/${state.state}/breath-a.svg`;
  subtitle.textContent = `${state.caption.toLowerCase()} · ${state.state.replace(/_/g, " ")}`;
}

function renderChips() {
  chipRow.innerHTML = "";
  for (const cmd of chipCommands()) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chat-chip";
    chip.innerHTML = `${cmd.label}${
      cmd.argsHint ? `<span class="chip-args">${cmd.argsHint}</span>` : ""
    }`;
    chip.addEventListener("click", () => {
      // Fill the input but don't submit — lets users add args before firing.
      input.value = cmd.argsHint ? `${cmd.name} ` : `${cmd.name}`;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
    chipRow.appendChild(chip);
  }
}

function closeAutocomplete() {
  autocomplete.hidden = true;
  autocomplete.innerHTML = "";
}

function renderAutocomplete() {
  const value = input.value;
  if (!value.startsWith("/")) {
    closeAutocomplete();
    return;
  }
  // Only show while user is still typing the command name (no space yet).
  if (value.includes(" ")) {
    closeAutocomplete();
    return;
  }
  const matches = matchSlashCommands(value);
  if (matches.length === 0) {
    closeAutocomplete();
    return;
  }
  autocomplete.innerHTML = "";
  matches.forEach((cmd, idx) => {
    const row = document.createElement("div");
    row.className = `chat-autocomplete-item${idx === 0 ? " active" : ""}`;
    row.innerHTML = `
      <span class="chat-autocomplete-name">${cmd.name}${
      cmd.argsHint ? ` <span class="chip-args">${cmd.argsHint}</span>` : ""
    }</span>
      <span class="chat-autocomplete-blurb">${cmd.blurb}</span>`;
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      acceptAutocomplete(cmd);
    });
    autocomplete.appendChild(row);
  });
  autocomplete.hidden = false;
}

function acceptAutocomplete(cmd: SlashCommand) {
  input.value = cmd.argsHint ? `${cmd.name} ` : `${cmd.name}`;
  closeAutocomplete();
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

async function dispatchSlashCommand(message: string): Promise<boolean> {
  const parsed = parseSlashCommand(message);
  if (!parsed) return false;

  const { command, args } = parsed;

  // Help is fully client-side.
  if (command.handler === "help") {
    appendUserMessage(message);
    input.value = "";
    const bubble = appendPetBubble(renderHelpMarkdown());
    bubble.el.innerHTML = renderMarkdown(bubble.buffer);
    return true;
  }

  // Local commands (inbox, mood) → Rust handler, then a pet bubble echo.
  if (command.handler === "inbox" || command.handler === "mood") {
    appendUserMessage(message);
    input.value = "";
    try {
      const outcome = await runLocalCommand(command.handler, args);
      const bubble = appendPetBubble("");
      bubble.buffer = outcome.message;
      bubble.el.innerHTML = renderMarkdown(outcome.message);
    } catch (err) {
      const bubble = appendPetBubble("");
      const text = `couldn't run ${command.name} — ${String(err)}`;
      bubble.buffer = text;
      bubble.el.innerHTML = renderMarkdown(text);
    }
    return true;
  }

  // LLM-backed commands: pet-wellness system prompt + deterministic user
  // message that nudges the model into the right shape.
  appendUserMessage(message);
  input.value = "";
  send.disabled = true;
  streaming = appendPetBubble("");

  const userMessage = buildSlashUserMessage(command.handler, args);
  try {
    await streamSlashCommand(PET_WELLNESS_SYSTEM_PROMPT, userMessage);
  } catch (err) {
    if (streaming) {
      streaming.buffer = `couldn't reach the model — ${String(err)}`;
      streaming.el.innerHTML = renderMarkdown(streaming.buffer);
    }
    streaming = null;
    send.disabled = false;
  }
  return true;
}

function buildSlashUserMessage(
  handler: "daily" | "recap" | "weekahead" | "reflect" | string,
  args: string
): string {
  switch (handler) {
    case "daily":
      return "give today's read. one line of observation from what's in twin.md (calendar, sleep, tasks), one line of reading, one line of suggestion. prose, not bullets.";
    case "recap":
      return "give a recap of the last 72 hours. what stood out across memory, tasks, and mood. three short sentences max. prose.";
    case "weekahead":
      return "look at the next seven days from the twin.md context. mention the most notable event or goal. three sentences max. prose.";
    case "reflect":
      return args.trim()
        ? `offer one gentle reflection question grounded in: ${args.trim()}`
        : "offer one gentle reflection question grounded in today's context. just the question — one sentence.";
    default:
      return args || "tell me something honest about my day.";
  }
}

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  closeAutocomplete();

  if (await dispatchSlashCommand(message)) return;

  appendUserMessage(message);
  input.value = "";
  send.disabled = true;
  streaming = appendPetBubble("");
  try {
    await sendChat(message);
  } catch (error) {
    if (streaming) {
      streaming.buffer = "sorry, I couldn't reply just now.";
      streaming.el.innerHTML = renderMarkdown(streaming.buffer);
    }
    console.error(error);
    streaming = null;
    send.disabled = false;
  }
}

async function init() {
  current = await getState();
  if (current) renderHeader(current);

  renderChips();

  void getChatStatus()
    .then((info) => {
      if (info && !info.has_api_key) {
        status.hidden = false;
        status.textContent = `no ${info.provider ?? "ai"} key yet — open onboarding to wire one up.`;
      }
    })
    .catch(() => {});

  await onStateChanged((next) => {
    current = next;
    renderHeader(next);
  });

  await onChatToken((chunk) => {
    if (!streaming) streaming = appendPetBubble("");
    streaming.buffer += chunk;
    streaming.el.innerHTML = renderMarkdown(streaming.buffer);
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
    if (event.key === "Escape") closeAutocomplete();
  });
  input.addEventListener("input", renderAutocomplete);
  input.addEventListener("blur", () => {
    // Give click handlers on autocomplete rows a chance to fire first.
    window.setTimeout(closeAutocomplete, 120);
  });

  // Empty-state: help users see what's possible.
  if (log.childElementCount === 0) {
    const greeting = "i just moved in. try `/daily` or say hi.";
    const bubble = appendPetBubble(greeting);
    bubble.el.innerHTML = renderMarkdown(bubble.buffer);
  }

  // First-open nicety: auto-fire /daily so the log has something real in it.
  // Gated by localStorage so re-opens stay quiet.
  try {
    const seen = window.localStorage.getItem("twin:first-daily-ran");
    const hasKey = !status.hidden ? false : true;
    if (!seen && hasKey) {
      window.localStorage.setItem("twin:first-daily-ran", "1");
      window.setTimeout(() => {
        input.value = "/daily";
        form.requestSubmit();
      }, 400);
    }
  } catch {
    // localStorage unavailable — skip the auto-fire silently.
  }

  input.focus();
}

init().catch((error) => {
  console.error("chat init failed", error);
});
