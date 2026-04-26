/**
 * chat-window.ts — Dinoki-style persistent chat panel for twin.md
 *
 * Features:
 *  - Multi-turn conversation history (full context sent each turn)
 *  - Streaming via twin://cw-token / twin://cw-done events
 *  - Markdown rendering via marked + DOMPurify
 *  - Provider/model settings panel (Anthropic · OpenAI · Gemini)
 *  - Slash commands: /note, /mood, /image
 *  - Brain vault writes: write_vault_note, log_mood_entry
 *  - Image generation: generate_image → convertFileSrc display
 *  - Font size: Cmd+= / Cmd+- (persisted to localStorage)
 *  - Session persistence: save_chat_session on close / new chat
 *  - Proactive seed: listens for twin://cw-seed to pre-fill/auto-send
 */

import "./ensure-tauri.ts";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { PetState, TwinMood, TwinSpecies } from "./types.ts";
import {
  getChatStatus,
  getSpriteEvolution,
  emitLastChat,
  generateChatBackground,
  generateSpritePreview,
  generateSpritePreviewFromPhoto,
  generatedAssetDataUrl,
  listModels,
  requestClaudeAction,
  runLocalCommand,
  saveProviderCredentials,
  validateProviderKey,
  onSpriteUpdated,
  onSpriteEvolving,
  onSpriteEvolveError,
  onSpriteEvolveCooldown,
  regenerateSprite,
  type AiProvider,
} from "./ipc.ts";

// ── Types ────────────────────────────────────────────────────────────────────

interface CwMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatTurn extends CwMessage {
  ts: string;
}

interface WriteNoteResult {
  path: string;
}

interface ImageGenResult {
  ok: boolean;
  savedPath: string | null;
  providerUsed: string | null;
  error: string | null;
  prompt: string;
}

// ── Slash command registry ──────────────────────────────────────────────────

const SLASH_COMMANDS = [
  {
    name: "/inbox",
    blurb: "quick capture to inbox.md",
    args: "<thought>",
    detail: "Save a raw idea/task now; organize it later."
  },
  {
    name: "/mood",
    blurb: "log how you feel",
    args: "<0-10 + note>",
    detail: "Feeds the pet state and your daily context."
  },
  {
    name: "/image",
    blurb: "make an image",
    args: "<prompt>",
    detail: "Generate a visual and save it to your vault media."
  },
  {
    name: "/change-char",
    blurb: "preview a new pet",
    args: "<description>",
    detail: "Preview first in chat, then summon or revert."
  },
  {
    name: "/change-background",
    blurb: "scene or AI wallpaper",
    args: "<scene/prompt>",
    detail: "Pick bloom/stars/storm/nook, or describe a new background."
  },
  {
    name: "/new",
    blurb: "fresh chat",
    args: "",
    detail: "Clear this conversation without changing your pet."
  },
];

// ── DOM refs ────────────────────────────────────────────────────────────────

const cwLog = document.getElementById("cw-log") as HTMLDivElement;
const cwLayout = document.getElementById("cw-layout") as HTMLDivElement;
const cwForm = document.getElementById("cw-form") as HTMLFormElement;
const cwInput = document.getElementById("cw-input") as HTMLTextAreaElement;
const cwSend = document.getElementById("cw-send") as HTMLButtonElement;
const cwSpriteWrap = document.getElementById("cw-sprite-wrap") as HTMLDivElement | null;
const cwSprite = document.getElementById("cw-sprite") as HTMLImageElement;
const cwSubtitle = document.getElementById("cw-subtitle") as HTMLParagraphElement;
const cwRegenBtn = document.getElementById("cw-regen") as HTMLButtonElement;
const cwNewBtn = document.getElementById("cw-new") as HTMLButtonElement;
const cwSettingsBtn = document.getElementById("cw-settings") as HTMLButtonElement;
const cwAutoComplete = document.getElementById("cw-autocomplete") as HTMLDivElement;
const pillProvider = document.getElementById("pill-provider") as HTMLSpanElement;
const pillModel = document.getElementById("pill-model") as HTMLSpanElement;
const cwProviderPill = document.getElementById("cw-provider-pill") as HTMLButtonElement;

// Settings overlay
const settingsOverlay = document.getElementById("settings-overlay") as HTMLDivElement;
const settingsClose = document.getElementById("settings-close") as HTMLButtonElement;
const settingsTabs = document.querySelectorAll<HTMLButtonElement>(".ptab");
const settingsModel = document.getElementById("settings-model") as HTMLSelectElement;
const settingsKey = document.getElementById("settings-key") as HTMLInputElement;
const settingsTest = document.getElementById("settings-test") as HTMLButtonElement;
const settingsSave = document.getElementById("settings-save") as HTMLButtonElement;
const settingsStatus = document.getElementById("settings-status") as HTMLDivElement;

// ── State ─────────────────────────────────────────────────────────────────

let messages: CwMessage[] = [];
let sessionTurns: ChatTurn[] = [];
let sessionId = crypto.randomUUID();
let isStreaming = false;
let lastAssistantText = "";
let evolutionSpritePath: string | null = null;
let currentMood: TwinMood = "healthy";
let customSpriteEvolutionEnabled = false;

let settingsProvider: AiProvider = "anthropic";
let currentProvider = "anthropic";
let currentModel = "";
let settingsReturnFocus: HTMLElement | null = null;
let activeAutocompleteIndex = 0;
let introShown = false;

// Font size (12–20px, stored in localStorage)
const FONT_SIZE_KEY = "twin-cw-font-size";
const CHAT_BACKGROUND_KEY = "twin-cw-background";
let fontSize = parseInt(localStorage.getItem(FONT_SIZE_KEY) ?? "15", 10);
type ChatBackgroundValue = { type: "scene"; slug: SceneSlug } | { type: "generated"; path: string };

type SceneSlug = "sunny_island" | "stars_at_noon" | "storm_room" | "grey_nook";

const SCENES: Array<{ slug: SceneSlug; label: string; aliases: string[] }> = [
  { slug: "sunny_island", label: "Bloom mode", aliases: ["bloom", "sunny", "island", "healthy"] },
  { slug: "stars_at_noon", label: "Stars at noon", aliases: ["stars", "noon", "low", "charge", "sleep"] },
  { slug: "storm_room", label: "Paper storm", aliases: ["storm", "paper", "stress", "overload"] },
  { slug: "grey_nook", label: "Quiet nook", aliases: ["grey", "gray", "nook", "quiet", "focus"] },
];

// ── Markdown rendering ────────────────────────────────────────────────────

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  const raw = marked.parse(text) as string;
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
}

function assistantMoodClass(): string {
  return `mood-${currentMood.replace(/_/g, "-")}`;
}

// ── Pet sprite helpers ────────────────────────────────────────────────────

function updateSprite(state: PetState) {
  const species = state.species as TwinSpecies;
  const mood = state.state as TwinMood;
  currentMood = mood;
  cwLog.dataset.mood = mood;
  if (!evolutionSpritePath) {
    cwSprite.src = `/pets/${species}/${mood}/breath-a.png`;
  }
  if (!cwSpriteWrap?.classList.contains("is-evolving")) {
    cwSubtitle.textContent = state.caption.toLowerCase();
  }
}

async function resolveGeneratedSpriteUrl(path: string): Promise<string> {
  try {
    return await generatedAssetDataUrl(path);
  } catch {
    return convertFileSrc(path);
  }
}

async function swapChatSprite(path: string) {
  const url = await resolveGeneratedSpriteUrl(path);
  const next = new Image();
  next.onload = () => {
    cwSpriteWrap?.classList.remove("is-evolving");
    cwSpriteWrap?.classList.add("has-evolved-sprite");
    cwSpriteWrap?.classList.add("sprite-swap");
    cwSprite.src = url;
    syncRegenerateButton();
    void refreshSubtitleFromState();
    setTimeout(() => cwSpriteWrap?.classList.remove("sprite-swap"), 280);
  };
  next.onerror = () => {
    cwSpriteWrap?.classList.remove("is-evolving");
    syncRegenerateButton();
    void refreshSubtitleFromState();
    appendStatus("couldn't load new sprite", "error");
  };
  next.src = url;
}

function syncRegenerateButton(): void {
  if (!cwRegenBtn) return;
  const evolving = cwSpriteWrap?.classList.contains("is-evolving") === true;
  cwRegenBtn.disabled = !customSpriteEvolutionEnabled || evolving;
  cwRegenBtn.title = customSpriteEvolutionEnabled
    ? "regenerate evolution sprite"
    : "custom sprite mode required for AI evolution";
}

async function refreshSubtitleFromState() {
  try {
    const st = await invoke<PetState | null>("get_state");
    if (st) cwSubtitle.textContent = st.caption.toLowerCase();
  } catch {
    /* ignore */
  }
}

// ── Font size ─────────────────────────────────────────────────────────────

function applyFontSize() {
  cwLog.style.fontSize = `${fontSize}px`;
  localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
}

function scenePath(slug: SceneSlug): string {
  return `/scenes/${slug}/reference.png`;
}

function persistChatBackground(value: ChatBackgroundValue | null): void {
  if (!value) {
    localStorage.removeItem(CHAT_BACKGROUND_KEY);
    return;
  }
  localStorage.setItem(CHAT_BACKGROUND_KEY, JSON.stringify(value));
}

function readPersistedChatBackground(): ChatBackgroundValue | null {
  const raw = localStorage.getItem(CHAT_BACKGROUND_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatBackgroundValue;
    if (parsed.type === "scene" || parsed.type === "generated") return parsed;
  } catch {
    if (SCENES.some((scene) => scene.slug === raw)) {
      return { type: "scene", slug: raw as SceneSlug };
    }
  }
  return null;
}

async function applyChatBackground(value: ChatBackgroundValue | null): Promise<void> {
  if (!value) {
    cwLayout.style.removeProperty("--chat-bg-image");
    cwLayout.removeAttribute("data-chat-background");
    persistChatBackground(null);
    return;
  }
  const src =
    value.type === "scene" ? scenePath(value.slug) : await generatedAssetDataUrl(value.path);
  cwLayout.style.setProperty("--chat-bg-image", `url("${src}")`);
  cwLayout.dataset.chatBackground = value.type === "scene" ? value.slug : "generated";
  persistChatBackground(value);
}

function resolveScene(query: string): SceneSlug | null {
  const needle = query.trim().toLowerCase().replace(/^\//, "");
  if (!needle) return null;
  return (
    SCENES.find(
      (scene) =>
        scene.slug === needle ||
        scene.label.toLowerCase().includes(needle) ||
        scene.aliases.some((alias) => alias.includes(needle) || needle.includes(alias))
    )?.slug ?? null
  );
}

// ── Message log rendering ─────────────────────────────────────────────────

function appendMessage(role: "user" | "assistant", content: string): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "user" ? "me" : "pet"}`;
  if (role === "assistant") {
    bubble.classList.add(assistantMoodClass());
  }
  if (role === "assistant") {
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.textContent = content;
  }
  cwLog.appendChild(bubble);
  cwLog.scrollTop = cwLog.scrollHeight;
  return bubble;
}

function appendToolCard(html: string): void {
  const card = document.createElement("div");
  card.className = "cw-tool-card";
  card.innerHTML = DOMPurify.sanitize(html);
  cwLog.appendChild(card);
  cwLog.scrollTop = cwLog.scrollHeight;
}

async function appendImageBlock(filePath: string, prompt: string, providerUsed: string): Promise<void> {
  const wrap = document.createElement("div");
  wrap.className = "cw-image-block";
  const img = document.createElement("img");
  img.alt = prompt;
  img.className = "cw-image";
  const caption = document.createElement("p");
  caption.className = "cw-image-caption";
  caption.textContent = `${providerUsed} · "${prompt}"`;
  wrap.appendChild(img);
  wrap.appendChild(caption);
  cwLog.appendChild(wrap);
  cwLog.scrollTop = cwLog.scrollHeight;
  try {
    await setGeneratedImageSrc(img, filePath);
  } catch (e) {
    img.addEventListener("error", () => {
      wrap.classList.add("cw-image-block--error");
      img.remove();
      caption.textContent = `image saved but couldn't be displayed: ${filePath}`;
    });
    caption.textContent = `image saved but couldn't be displayed: ${String(e)}`;
  }
}

async function appendCharacterPreview(filePath: string, prompt: string): Promise<void> {
  const wrap = document.createElement("div");
  wrap.className = "cw-character-card";

  const img = document.createElement("img");
  img.className = "cw-character-preview";
  img.alt = prompt;
  await setGeneratedImageSrc(img, filePath);

  const body = document.createElement("div");
  body.className = "cw-character-body";

  const title = document.createElement("strong");
  title.textContent = "preview new character";

  const desc = document.createElement("p");
  desc.textContent = prompt;

  const actions = document.createElement("div");
  actions.className = "cw-character-actions";

  const summon = document.createElement("button");
  summon.type = "button";
  summon.className = "secondary-button";
  summon.textContent = "summon this";

  const revert = document.createElement("button");
  revert.type = "button";
  revert.className = "text-button";
  revert.textContent = "revert";

  summon.addEventListener("click", async () => {
    summon.disabled = true;
    try {
      await invoke("apply_custom_sprite_preview", { prompt, path: filePath });
      evolutionSpritePath = filePath;
      await swapChatSprite(filePath);
      const intro = `Oke, aku ganti bentuk. Sekarang aku hadir sebagai **${prompt}**. Kalau rasanya belum pas, pakai \`/change-char\` lagi dan kita preview dulu sebelum summon.`;
      appendAssistantIntro(intro);
      appendStatus("character summoned");
      wrap.remove();
    } catch (e) {
      summon.disabled = false;
      appendStatus(`couldn't summon character: ${String(e)}`, "error");
    }
  });

  revert.addEventListener("click", () => {
    wrap.remove();
    appendStatus("character preview discarded");
  });

  actions.append(summon, revert);
  body.append(title, desc, actions);
  wrap.append(img, body);
  cwLog.appendChild(wrap);
  cwLog.scrollTop = cwLog.scrollHeight;
}

async function uploadPhotoForCharacter(prompt: string): Promise<void> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose a reference photo for your sprite",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });
  if (typeof selected !== "string") {
    appendStatus("photo upload cancelled");
    return;
  }
  appendStatus("generating sprite from uploaded photo…");
  const path = await generateSpritePreviewFromPhoto(prompt, selected);
  await appendCharacterPreview(path, prompt);
  appendStatus("photo sprite preview ready — summon or revert");
}

function appendBackgroundPicker(preselect?: SceneSlug | null): void {
  const wrap = document.createElement("div");
  wrap.className = "cw-background-card";
  const scenes = preselect ? SCENES.filter((scene) => scene.slug === preselect) : SCENES;

  scenes.forEach((scene) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cw-background-option";
    item.style.setProperty("--scene-thumb", `url("${scenePath(scene.slug)}")`);
    item.innerHTML = `
      <span>${scene.label}</span>
      <small>${scene.slug.replace(/_/g, " ")}</small>
    `;
    item.addEventListener("click", () => {
      void applyChatBackground({ type: "scene", slug: scene.slug });
      appendStatus(`background changed: ${scene.label}`);
      wrap.remove();
    });
    wrap.appendChild(item);
  });

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "text-button";
  clear.textContent = "clear background";
  clear.addEventListener("click", () => {
    void applyChatBackground(null);
    appendStatus("background cleared");
    wrap.remove();
  });
  wrap.appendChild(clear);

  cwLog.appendChild(wrap);
  cwLog.scrollTop = cwLog.scrollHeight;
}

async function appendGeneratedBackgroundPreview(filePath: string, prompt: string): Promise<void> {
  const wrap = document.createElement("div");
  wrap.className = "cw-background-card cw-background-card--generated";
  const item = document.createElement("button");
  item.type = "button";
  item.className = "cw-background-option cw-background-option--wide";
  const src = await generatedAssetDataUrl(filePath);
  item.style.setProperty("--scene-thumb", `url("${src}")`);
  item.innerHTML = `<span>Generated background</span><small>${prompt}</small>`;
  item.addEventListener("click", () => {
    void applyChatBackground({ type: "generated", path: filePath });
    appendStatus("generated background applied");
    wrap.remove();
  });
  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "text-button";
  discard.textContent = "discard";
  discard.addEventListener("click", () => {
    wrap.remove();
    appendStatus("background preview discarded");
  });
  wrap.append(item, discard);
  cwLog.appendChild(wrap);
  cwLog.scrollTop = cwLog.scrollHeight;
}

async function setGeneratedImageSrc(img: HTMLImageElement, filePath: string): Promise<void> {
  try {
    img.src = await generatedAssetDataUrl(filePath);
  } catch {
    img.src = convertFileSrc(filePath);
  }
}

function appendStatus(text: string, kind: "info" | "error" = "info"): void {
  const el = document.createElement("div");
  el.className = `cw-status cw-status--${kind}`;
  el.textContent = text;
  cwLog.appendChild(el);
  cwLog.scrollTop = cwLog.scrollHeight;
  setTimeout(() => el.remove(), 4000);
}

function appendAssistantIntro(text: string): void {
  const intro = text.trim();
  if (!intro) return;
  introShown = true;
  document.querySelector(".cw-greeting")?.remove();
  appendMessage("assistant", intro);
  messages.push({ role: "assistant", content: intro });
  sessionTurns.push({ role: "assistant", content: intro, ts: new Date().toISOString() });
  void emitLastChat(intro);
}

// ── Streaming ─────────────────────────────────────────────────────────────

async function sendMessages() {
  if (isStreaming || messages.length === 0) return;

  isStreaming = true;
  cwSend.disabled = true;
  lastAssistantText = "";

  const bubble = appendMessage("assistant", "");
  bubble.classList.add("is-streaming");
  let streamText = "";
  let renderFrame: number | null = null;
  const flushStream = () => {
    renderFrame = null;
    bubble.innerHTML = renderMarkdown(streamText);
    cwLog.scrollTop = cwLog.scrollHeight;
  };

  const unlistenToken = await listen<string>("twin://cw-token", (event) => {
    streamText += event.payload;
    lastAssistantText = streamText;
    if (renderFrame === null) {
      renderFrame = window.requestAnimationFrame(flushStream);
    }
  });

  const unlistenDone = await listen<null>("twin://cw-done", () => {
    unlistenToken();
    unlistenDone();
    if (renderFrame !== null) {
      window.cancelAnimationFrame(renderFrame);
      flushStream();
    }
    bubble.classList.remove("is-streaming");
    isStreaming = false;
    cwSend.disabled = false;

    const finalText = lastAssistantText;
    if (finalText) {
      messages.push({ role: "assistant", content: finalText });
      sessionTurns.push({ role: "assistant", content: finalText, ts: new Date().toISOString() });
      void emitLastChat(finalText);
    }
    cwInput.focus();
  });

  try {
    await invoke("send_chat_window", { messages });
  } catch (err) {
    unlistenToken();
    unlistenDone();
    if (renderFrame !== null) {
      window.cancelAnimationFrame(renderFrame);
      renderFrame = null;
    }
    bubble.innerHTML = renderMarkdown(
      `something went wrong — local agent and provider fallback both failed. open settings if you want to add an API key.\n\n_${String(err)}_`
    );
    bubble.classList.remove("is-streaming");
    bubble.classList.add("is-error");
    isStreaming = false;
    cwSend.disabled = false;
  }
}

async function submitText(text: string) {
  const trimmed = text.trim();
  if (!trimmed || isStreaming) return;

  cwInput.value = "";
  cwInput.style.height = "auto";
  hideAutoComplete();

  // Handle slash commands locally before sending to LLM
  if (trimmed.startsWith("/")) {
    const handled = await handleSlashCommand(trimmed);
    if (handled) return;
  }

  if (shouldBridgeToClaude(trimmed)) {
    await queueClaudeAction(trimmed);
    return;
  }

  appendMessage("user", trimmed);
  messages.push({ role: "user", content: trimmed });
  sessionTurns.push({ role: "user", content: trimmed, ts: new Date().toISOString() });

  await sendMessages();
}

function shouldBridgeToClaude(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("use mcp claude") ||
    lower.includes("pakai mcp claude") ||
    lower.includes("mcp computer use") ||
    lower.includes("claude desktop") ||
    lower.startsWith("minta claude ")
  );
}

async function queueClaudeAction(request: string): Promise<void> {
  try {
    const result = await requestClaudeAction(request);
    appendMessage("user", request);
    sessionTurns.push({ role: "user", content: request, ts: new Date().toISOString() });
    appendToolCard(
      `<span class="tool-icon">↔</span> queued for Claude Desktop · <code>${result.id}</code>`
    );
    appendAssistantIntro(
      `Aku sudah queue request ini untuk Claude Desktop via twin MCP: "${request}". Claude Desktop bisa ambil lewat \`get_pending_twin_actions\`, pakai tool/computer-use yang dia punya, lalu balikin hasilnya via \`resolve_twin_action\`.`
    );
  } catch (e) {
    appendStatus(`couldn't queue Claude request: ${String(e)}`, "error");
  }
}

// ── Slash commands ────────────────────────────────────────────────────────

async function handleSlashCommand(cmd: string): Promise<boolean> {
  const lower = cmd.toLowerCase();

  // /new — start fresh conversation
  if (lower === "/new") {
    await persistSession();
    startNewSession();
    appendStatus("new conversation started");
    return true;
  }

  // /inbox <thought> — quick capture to inbox.md
  if (lower.startsWith("/inbox")) {
    const note = cmd.slice("/inbox".length).trim();
    if (!note) {
      appendStatus("usage: /inbox buy milk / idea for portfolio / follow up with X", "error");
      return true;
    }
    try {
      const result = await runLocalCommand("inbox", note);
      if (result.ok) {
        appendToolCard(
          `<span class="tool-icon">↳</span> inbox captured · <code>${result.path ?? "inbox.md"}</code>`
        );
      } else {
        appendStatus(result.message, "error");
      }
    } catch (e) {
      appendStatus(`inbox failed: ${String(e)}`, "error");
    }
    return true;
  }

  // /change-char <description> — generate a preview before applying.
  if (
    lower.startsWith("/change-char-photo") ||
    lower.startsWith("/change-char") ||
    lower.startsWith("/char")
  ) {
    const fromPhoto = lower.startsWith("/change-char-photo");
    const command = fromPhoto ? "/change-char-photo" : lower.startsWith("/change-char") ? "/change-char" : "/char";
    const prompt = cmd.slice(command.length).trim();
    if (!prompt) {
      appendStatus("usage: /change-char yellow doraemon superhero OR /change-char-photo chibi desk pet", "error");
      return true;
    }
    try {
      if (fromPhoto) {
        await uploadPhotoForCharacter(prompt);
      } else {
        appendStatus(`previewing new character: "${prompt}"…`);
        const path = await generateSpritePreview(prompt);
        await appendCharacterPreview(path, prompt);
        appendStatus("preview ready — summon or revert");
      }
    } catch (e) {
      appendStatus(`character preview failed: ${String(e)}`, "error");
    }
    return true;
  }

  // /change-background [scene] — preview/apply a scene wallpaper.
  if (lower.startsWith("/change-background") || lower.startsWith("/background")) {
    const command = lower.startsWith("/change-background") ? "/change-background" : "/background";
    const raw = cmd.slice(command.length).trim();
    if (!raw) {
      appendBackgroundPicker();
      return true;
    }
    const scene = resolveScene(raw);
    if (!scene) {
      appendStatus(`generating custom background: "${raw}"…`);
      try {
        const result = await generateChatBackground(raw);
        if (result.savedPath) {
          await appendGeneratedBackgroundPreview(result.savedPath, result.prompt);
          appendStatus("background preview ready");
        } else {
          appendStatus(result.error ?? "background generation failed", "error");
        }
      } catch (e) {
        appendStatus(`background generation failed: ${String(e)}`, "error");
      }
      return true;
    }
    appendBackgroundPicker(scene);
    return true;
  }

  // /claude <request> — hand off to Claude Desktop via twin MCP action queue.
  if (lower.startsWith("/claude") || lower.startsWith("/delegate")) {
    const command = lower.startsWith("/claude") ? "/claude" : "/delegate";
    const request = cmd.slice(command.length).trim();
    if (!request) {
      appendStatus("usage: /claude change Spotify to upbeat sprint music", "error");
      return true;
    }
    await queueClaudeAction(request);
    return true;
  }

  // /harvest — trigger harvest
  if (lower === "/harvest") {
    appendStatus("harvesting…");
    try {
      await invoke("trigger_harvest");
      appendStatus("harvest complete ✓");
    } catch (e) {
      appendStatus(`harvest failed: ${e}`, "error");
    }
    return true;
  }

  // /note <title> — save last assistant reply to vault
  if (lower.startsWith("/note")) {
    const title = cmd.slice(5).trim() || `note from twin — ${new Date().toLocaleDateString()}`;
    if (!lastAssistantText) {
      appendStatus("no reply to save yet — ask twin something first", "error");
      return true;
    }
    try {
      const result = await invoke<WriteNoteResult>("write_vault_note", {
        title,
        body: lastAssistantText,
        folder: null,
      });
      appendToolCard(
        `<span class="tool-icon">📝</span> saved to vault · <code>${result.path}</code>`
      );
    } catch (e) {
      appendStatus(`couldn't save note: ${e}`, "error");
    }
    return true;
  }

  // /mood <feeling> — log mood entry
  if (lower.startsWith("/mood")) {
    const feeling = cmd.slice(5).trim();
    if (!feeling) {
      appendStatus("usage: /mood tired / wired / bright / quiet", "error");
      return true;
    }
    try {
      await invoke("log_mood_entry", { mood: feeling, note: null });
      appendToolCard(
        `<span class="tool-icon">🌀</span> mood logged · <em>${feeling}</em>`
      );
    } catch (e) {
      appendStatus(`couldn't log mood: ${e}`, "error");
    }
    return true;
  }

  // /image <prompt> — generate image
  if (lower.startsWith("/image")) {
    const prompt = cmd.slice(6).trim();
    if (!prompt) {
      appendStatus("usage: /image a cat sitting at a desk", "error");
      return true;
    }
    appendStatus(`generating image for "${prompt}"…`);
    try {
      const result = await invoke<ImageGenResult>("generate_image", { prompt });
      if (result.ok && result.savedPath) {
        await appendImageBlock(result.savedPath, result.prompt, result.providerUsed ?? "");
      } else {
        appendStatus(result.error ?? "image generation failed", "error");
      }
    } catch (e) {
      appendStatus(`image gen error: ${e}`, "error");
    }
    return true;
  }

  appendStatus("unknown command — type / and choose one of the core actions", "error");
  return true;
}

// ── Session management ────────────────────────────────────────────────────

async function persistSession() {
  if (sessionTurns.length === 0) return;
  try {
    await invoke("save_chat_session", { sessionId, turns: sessionTurns });
  } catch {
    // best-effort
  }
}

function startNewSession() {
  messages = [];
  sessionTurns = [];
  sessionId = crypto.randomUUID();
  lastAssistantText = "";
  cwLog.innerHTML = "";
}

// ── Autocomplete ──────────────────────────────────────────────────────────

function showAutoComplete(query: string) {
  const needle = query.toLowerCase().replace(/^\//, "");
  const matches = SLASH_COMMANDS.filter((c) => {
    const haystack = `${c.name} ${c.blurb} ${c.args}`.toLowerCase();
    return !needle || haystack.includes(needle);
  });
  if (matches.length === 0) {
    hideAutoComplete();
    return;
  }
  cwAutoComplete.innerHTML = "";
  activeAutocompleteIndex = 0;
  matches.forEach((cmd, i) => {
    const item = document.createElement("div");
    item.className = `chat-autocomplete-item${i === 0 ? " active" : ""}`;
    item.setAttribute("role", "option");
    item.id = `cw-ac-${i}`;
    item.setAttribute("aria-selected", i === 0 ? "true" : "false");
    item.dataset.cmd = cmd.name;
    item.innerHTML = `
      <span class="chat-autocomplete-name">${cmd.name} <span class="chip-args">${cmd.args}</span></span>
      <span class="chat-autocomplete-copy">
        <span class="chat-autocomplete-blurb">${cmd.blurb}</span>
        <span class="chat-autocomplete-detail">${cmd.detail}</span>
      </span>
    `;
    item.addEventListener("click", () => {
      cwInput.value = cmd.name + " ";
      hideAutoComplete();
      cwInput.focus();
    });
    item.addEventListener("mouseenter", () => setAutocompleteIndex(i));
    cwAutoComplete.appendChild(item);
  });
  cwAutoComplete.hidden = false;
  cwInput.setAttribute("aria-expanded", "true");
  cwInput.setAttribute("aria-activedescendant", "cw-ac-0");
}

function hideAutoComplete() {
  cwAutoComplete.hidden = true;
  cwAutoComplete.innerHTML = "";
  cwInput.setAttribute("aria-expanded", "false");
  cwInput.removeAttribute("aria-activedescendant");
}

function autocompleteItems(): HTMLDivElement[] {
  return Array.from(cwAutoComplete.querySelectorAll<HTMLDivElement>(".chat-autocomplete-item"));
}

function setAutocompleteIndex(nextIndex: number): void {
  const items = autocompleteItems();
  if (items.length === 0) return;
  activeAutocompleteIndex = (nextIndex + items.length) % items.length;
  items.forEach((item, index) => {
    const active = index === activeAutocompleteIndex;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
    if (active) cwInput.setAttribute("aria-activedescendant", item.id);
  });
}

function applyActiveAutocomplete(): void {
  const item = autocompleteItems()[activeAutocompleteIndex];
  const cmd = item?.dataset.cmd;
  if (!cmd) return;
  cwInput.value = cmd + " ";
  hideAutoComplete();
  cwInput.focus();
}

// ── Settings panel ────────────────────────────────────────────────────────

async function openSettings() {
  settingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : cwSettingsBtn;
  await loadProviderStatus();
  settingsOverlay.hidden = false;
  settingsKey.focus();
}

function closeSettings() {
  settingsOverlay.hidden = true;
  settingsReturnFocus?.focus();
  settingsReturnFocus = null;
}

async function loadProviderStatus() {
  try {
    const status = await getChatStatus();
    if (!status) return;
    settingsProvider = status.provider as AiProvider;
    currentProvider = status.provider;
    currentModel = status.model;
    updateProviderTabs(settingsProvider);
    await refreshModelList(settingsProvider);
    settingsModel.value = status.model;
    if (status.local_mcp_ready) {
      pillProvider.textContent = "local first";
      pillModel.textContent = status.local_agent ?? "mcp";
    } else {
      pillProvider.textContent = status.provider;
      pillModel.textContent = status.has_api_key ? status.model : "setup needed";
    }
    // Show masked key placeholder if key is configured
    settingsKey.placeholder = status.has_api_key
      ? "••••••••••••••••••••"
      : "sk-ant-… / sk-… / AIza…";
  } catch {
    // ignore
  }
}

function updateProviderTabs(provider: AiProvider) {
  settingsTabs.forEach((tab) => {
    const active = tab.dataset.provider === provider;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  });
}

async function refreshModelList(provider: AiProvider) {
  try {
    const list = await listModels(provider);
    settingsModel.innerHTML = "";
    list.models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      settingsModel.appendChild(opt);
    });
    if (currentProvider === provider) {
      settingsModel.value = currentModel || list.default_model;
    } else {
      settingsModel.value = list.default_model;
    }
  } catch {
    // ignore
  }
}

settingsTabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    settingsProvider = tab.dataset.provider as AiProvider;
    updateProviderTabs(settingsProvider);
    await refreshModelList(settingsProvider);
    settingsKey.value = "";
    settingsKey.placeholder = "enter api key for " + settingsProvider;
    hideSettingsStatus();
  });
  tab.addEventListener("keydown", async (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const tabs = Array.from(settingsTabs);
    const index = tabs.indexOf(tab);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });
});

settingsTest.addEventListener("click", async () => {
  const key = settingsKey.value.trim();
  if (!key) {
    showSettingsStatus("enter a key to test", "error");
    return;
  }
  showSettingsStatus("testing…");
  try {
    const result = await validateProviderKey(settingsProvider, key);
    showSettingsStatus(result.ok ? "✓ key accepted" : `✗ ${result.message}`, result.ok ? "ok" : "error");
  } catch (e) {
    showSettingsStatus(`error: ${e}`, "error");
  }
});

settingsSave.addEventListener("click", async () => {
  const key = settingsKey.value.trim() || undefined;
  const model = settingsModel.value;
  if (!key) {
    showSettingsStatus("enter a key to save direct provider fallback", "error");
    return;
  }
  showSettingsStatus("saving…");
  try {
    await saveProviderCredentials({
      provider: settingsProvider,
      model,
      apiKey: key || null,
      storeInKeychain: false,
    });
    currentProvider = settingsProvider;
    currentModel = model;
    pillProvider.textContent = settingsProvider;
    pillModel.textContent = model;
    settingsKey.value = "";
    showSettingsStatus("✓ saved", "ok");
    setTimeout(() => {
      closeSettings();
      hideSettingsStatus();
    }, 800);
  } catch (e) {
    showSettingsStatus(`save failed: ${e}`, "error");
  }
});

function showSettingsStatus(msg: string, kind: "ok" | "error" | "" = "") {
  settingsStatus.hidden = false;
  settingsStatus.className = `settings-status${kind ? " settings-status--" + kind : ""}`;
  settingsStatus.textContent = msg;
}

function hideSettingsStatus() {
  settingsStatus.hidden = true;
}

// ── Interactions ──────────────────────────────────────────────────────────

cwForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitText(cwInput.value);
});

cwInput.addEventListener("keydown", async (e) => {
  if (!cwAutoComplete.hidden) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAutocompleteIndex(activeAutocompleteIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setAutocompleteIndex(activeAutocompleteIndex - 1);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      applyActiveAutocomplete();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideAutoComplete();
      return;
    }
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    await submitText(cwInput.value);
  }
  if (e.key === "Escape") {
    hideAutoComplete();
  }
});

cwInput.addEventListener("input", () => {
  // Auto-resize textarea
  cwInput.style.height = "auto";
  cwInput.style.height = Math.min(cwInput.scrollHeight, 160) + "px";
  cwSend.disabled = cwInput.value.trim().length === 0 || isStreaming;

  // Slash command autocomplete
  const val = cwInput.value;
  if (val.startsWith("/") && !val.includes(" ")) {
    showAutoComplete(val);
  } else {
    hideAutoComplete();
  }
});

cwRegenBtn?.addEventListener("click", async () => {
  try {
    const path = await regenerateSprite();
    evolutionSpritePath = path;
    appendStatus("new evolution sprite");
  } catch (e) {
    const s = String(e);
    if (s.includes("custom_sprite_required")) {
      appendStatus("custom sprite mode required for AI evolution", "error");
      return;
    }
    if (s.includes("rate_limited:")) {
      const sec = parseInt(s.split("rate_limited:")[1]?.trim() ?? "0", 10);
      const m = Math.floor(sec / 60);
      const rest = sec % 60;
      appendStatus(`evolution on cooldown — ${m}m ${rest}s left`, "error");
      return;
    }
    appendStatus(`sprite: ${s}`, "error");
  }
});

cwNewBtn.addEventListener("click", async () => {
  await persistSession();
  startNewSession();
  appendStatus("new conversation started");
});

cwSettingsBtn.addEventListener("click", () => openSettings());
cwProviderPill.addEventListener("click", () => openSettings());

settingsClose.addEventListener("click", () => closeSettings());
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

settingsOverlay.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeSettings();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    settingsOverlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute("hidden"));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

// Font size keyboard shortcuts
document.addEventListener("keydown", async (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    fontSize = Math.min(20, fontSize + 1);
    applyFontSize();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "-") {
    e.preventDefault();
    fontSize = Math.max(12, fontSize - 1);
    applyFontSize();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  applyFontSize();
  void applyChatBackground(readPersistedChatBackground());

  // Load current provider status and update pill
  await loadProviderStatus();

  try {
    const evo = await getSpriteEvolution();
    customSpriteEvolutionEnabled = evo.customEnabled;
    syncRegenerateButton();
    if (evo.currentPath) {
      evolutionSpritePath = evo.currentPath;
      void swapChatSprite(evo.currentPath);
    }
  } catch {
    // Non-fatal; bundled sprites are always available.
  }

  // Listen for state changes (update sprite + mood label)
  await listen<PetState>("twin://state-changed", (event) => {
    updateSprite(event.payload);
  });

  // Load current pet state
  try {
    const state = await invoke<PetState | null>("get_state");
    if (state) updateSprite(state);
  } catch {
    // ignore
  }

  void onSpriteEvolving(() => {
    cwSpriteWrap?.classList.add("is-evolving");
    syncRegenerateButton();
    cwSubtitle.textContent = "evolving…";
  });

  void onSpriteEvolveError((p) => {
    cwSpriteWrap?.classList.remove("is-evolving");
    syncRegenerateButton();
    void refreshSubtitleFromState();
    const m = p.message;
    if (m.includes("rembg_missing")) {
      appendStatus(
        'run pipx install "rembg[cpu,cli]" (or pip install "rembg[cpu,cli]"), then restart twin.',
        "error"
      );
    } else {
      appendStatus(`evolution failed: ${m}`, "error");
    }
  });

  void onSpriteEvolveCooldown((payload) => {
    const mins = Math.ceil(payload.waitSecs / 60);
    appendStatus(`evolution cooldown — about ${mins}m left`);
  });

  void onSpriteUpdated((payload) => {
    evolutionSpritePath = payload.path;
    void swapChatSprite(payload.path);
  });

  // Listen for proactive seed messages (from reminder engine or companion sprite click)
  await listen<string>("twin://cw-seed", async (event) => {
    const seed = event.payload?.trim();
    if (!seed) return;
    // Auto-submit the seeded message into the chat
    appendMessage("user", seed);
    messages.push({ role: "user", content: seed });
    sessionTurns.push({ role: "user", content: seed, ts: new Date().toISOString() });
    await sendMessages();
  });

  await listen<string>("twin://cw-intro", (event) => {
    appendAssistantIntro(event.payload);
  });

  // Persist session on window close
  const win = getCurrentWindow();
  win.onCloseRequested(async () => {
    await persistSession();
  });

  // Show fallback greeting unless onboarding sends a character intro.
  setTimeout(() => {
    if (introShown || cwLog.querySelector(".chat-bubble")) return;
    const greeting = document.createElement("div");
    greeting.className = "cw-greeting";
    greeting.innerHTML =
      `<p>hi there — type a message, or try <code>/note</code>, <code>/mood</code>, <code>/image</code></p>`;
    cwLog.appendChild(greeting);
  }, 700);

  cwInput.focus();
}

init().catch((err) => console.error("chat-window init failed", err));
