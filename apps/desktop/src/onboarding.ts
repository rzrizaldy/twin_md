import "./ensure-tauri.ts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createStarterVault,
  deletePreviousSession,
  ensureClaudeDir,
  generateSpritePreview,
  generateSpritePreviewFromPhoto,
  generatedAssetDataUrl,
  getChatStatus,
  getVaultProfileStatus,
  installRembg,
  listModels,
  loadPreviousSession,
  openChatWindow,
  runOnboarding,
  saveProviderCredentials,
  setVaultPath,
  validateProviderKey,
  wireLocalMcp,
  type AiProvider,
  type ChatStatus,
  type ClaudeDirStatus
} from "./ipc.ts";

const TOTAL_STEPS = 7;

const PROVIDER_KEY_URLS: Record<AiProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/app/apikey"
};

const PROVIDER_KEY_HINTS: Record<AiProvider, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  gemini: "AIza…"
};

type VaultChoice = "existing" | "create" | "skip" | null;
type SpriteMode = "default" | "custom";

interface WizardState {
  step: number;
  spriteMode: SpriteMode;
  customSprite: string;
  customSpritePreviewPath: string | null;
  owner: string;
  vaultChoice: VaultChoice;
  vaultPath: string | null;
  claudeDir: ClaudeDirStatus | null;
  provider: AiProvider;
  model: string;
  apiKey: string;
  storeInKeychain: boolean;
  providerSkipped: boolean;
}

const state: WizardState = {
  step: 0,
  spriteMode: "default",
  customSprite: "",
  customSpritePreviewPath: null,
  owner: "",
  vaultChoice: null,
  vaultPath: null,
  claudeDir: null,
  provider: "anthropic",
  model: "claude-haiku-4-5",
  apiKey: "",
  storeInKeychain: false,
  providerSkipped: false
};

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;
const $$ = <T extends HTMLElement>(sel: string): T[] =>
  Array.from(document.querySelectorAll(sel)) as T[];

const stepsEls = $$<HTMLElement>(".wizard-step");
const dots = $$<HTMLElement>(".wizard-dot");
const nextBtn = $<HTMLButtonElement>("#wizard-next");
const backBtn = $<HTMLButtonElement>("#wizard-back");
const statusEl = $<HTMLElement>("#onboard-status");

const previewPrompt = document.getElementById(
  "preview-prompt"
) as HTMLTextAreaElement | null;
const btnGenPreview = document.getElementById(
  "btn-gen-preview"
) as HTMLButtonElement | null;
const btnGenPreviewPhoto = document.getElementById(
  "btn-gen-preview-photo"
) as HTMLButtonElement | null;
const previewStatus = document.getElementById("preview-status");
const previewImg = document.getElementById("preview-img") as HTMLImageElement | null;
const summonHeroSprite = document.getElementById(
  "summon-hero-sprite"
) as HTMLImageElement | null;
const sessionRestoreCard = document.getElementById(
  "session-restore-card"
) as HTMLDivElement | null;
const sessionRestoreCopy = document.getElementById(
  "session-restore-copy"
) as HTMLSpanElement | null;
const loadPreviousSessionBtn = document.getElementById(
  "load-previous-session"
) as HTMLButtonElement | null;
const startFreshSessionBtn = document.getElementById(
  "start-fresh-session"
) as HTMLButtonElement | null;
const deletePreviousSessionBtn = document.getElementById(
  "delete-previous-session"
) as HTMLButtonElement | null;
const readinessItems = {
  vault: document.querySelector<HTMLElement>('[data-ready-item="vault"]'),
  ai: document.querySelector<HTMLElement>('[data-ready-item="ai"]'),
  approval: document.querySelector<HTMLElement>('[data-ready-item="approval"]')
};
let lastPreviewAt = 0;
let chatStatus: ChatStatus | null = null;
let restoreDismissed = false;

function localAgentReady(): boolean {
  return Boolean(chatStatus?.local_mcp_ready);
}

function setStatus(message: string, kind: "info" | "error" | "ok" = "info"): void {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
  statusEl.hidden = message.length === 0;
}

function syncSpriteDot() {
  const d5 = document.querySelector<HTMLElement>('[data-step-dot="5"]');
  if (d5) d5.style.display = state.spriteMode === "custom" ? "" : "none";
}

async function setImageFromGeneratedPath(img: HTMLImageElement, path: string): Promise<void> {
  try {
    img.src = await generatedAssetDataUrl(path);
  } catch {
    img.src = convertFileSrc(path);
  }
}

async function syncSummonHero(): Promise<void> {
  if (!summonHeroSprite) return;
  summonHeroSprite.alt =
    state.spriteMode === "custom" && state.customSprite.trim()
      ? state.customSprite.trim()
      : "default Axiotyl";

  if (state.spriteMode === "custom" && state.customSpritePreviewPath) {
    await setImageFromGeneratedPath(summonHeroSprite, state.customSpritePreviewPath);
    return;
  }

  summonHeroSprite.src = "/pets/axolotl/healthy/reaction-happy.png";
}

function setStep(requested: number) {
  let step = Math.max(0, Math.min(TOTAL_STEPS - 1, requested));
  if (step === 5 && state.spriteMode === "default") {
    step = 6;
  }
  state.step = step;
  if (state.step === 5 && previewPrompt) {
    previewPrompt.value = state.customSprite;
  }
  stepsEls.forEach((el) => {
    el.classList.toggle(
      "is-active",
      Number(el.dataset.step ?? -1) === state.step
    );
  });
  dots.forEach((dot) => {
    const idx = Number(dot.dataset.stepDot ?? -1);
    const skip =
      state.spriteMode === "default" && idx === 5;
    if (skip) {
      dot.style.display = "none";
    } else {
      dot.style.display = "";
    }
    dot.classList.toggle("is-active", idx === state.step);
    const visualDone =
      state.spriteMode === "default" && state.step > 5 && idx === 5
        ? true
        : idx < state.step;
    dot.classList.toggle("is-done", visualDone);
  });
  backBtn.hidden = state.step === 0;
  nextBtn.textContent =
    state.step === TOTAL_STEPS - 1 ? "summon my twin" : "next";
  if (state.step < 4) setStatus("");
  if (state.step === 0) void refreshSessionRestore();
  if (state.step === 2) runClaudeDirCheck();
  if (state.step === 4) void refreshLocalAgentStatus();
  if (state.step === 6) {
    void syncSummonHero();
    void refreshReadinessChecklist();
  }
}

async function refreshSessionRestore(): Promise<void> {
  if (!sessionRestoreCard || restoreDismissed) return;
  try {
    const status = await getVaultProfileStatus();
    if (!status.canLoad) {
      sessionRestoreCard.hidden = true;
      return;
    }
    sessionRestoreCard.hidden = false;
    const owner = status.owner ? `${status.owner}'s ` : "";
    const updated = status.updatedAt ? ` · updated ${new Date(status.updatedAt).toLocaleString()}` : "";
    const sprite = status.spritePrompt ? ` · ${status.spritePrompt}` : "";
    if (sessionRestoreCopy) {
      sessionRestoreCopy.textContent = `${owner}vault profile is ready${updated}${sprite}`;
    }
  } catch {
    sessionRestoreCard.hidden = true;
  }
}

function setReadyItem(
  item: HTMLElement | null,
  ok: boolean,
  message: string
): void {
  if (!item) return;
  item.classList.toggle("ok", ok);
  item.classList.toggle("warn", !ok);
  const icon = item.querySelector(".detection-icon");
  const body = item.querySelector(".detection-body");
  if (icon) icon.textContent = ok ? "✓" : "!";
  if (body) body.textContent = message;
}

async function refreshReadinessChecklist(): Promise<void> {
  const vaultReady = Boolean(state.vaultPath);
  setReadyItem(
    readinessItems.vault,
    vaultReady,
    vaultReady
      ? `.twin-md profile will sync in ${state.vaultPath}`
      : "no Obsidian vault selected; profile restore is local-only until you choose one"
  );
  if (!chatStatus) chatStatus = await getChatStatus();
  const aiReady = Boolean(chatStatus?.local_mcp_ready || chatStatus?.has_api_key || state.apiKey.trim());
  setReadyItem(
    readinessItems.ai,
    aiReady,
    aiReady
      ? "chat has local MCP or provider fallback ready"
      : "no AI key/local MCP yet; chat setup can be finished later"
  );
  setReadyItem(
    readinessItems.approval,
    true,
    "permission requests show a macOS approval dialog; Claude runs quietly in the background"
  );
}

function validateStep(step: number): string | null {
  switch (step) {
    case 1: {
      if (!state.owner.trim()) return "tell your twin who you are.";
      if (!state.vaultChoice) return "pick an option for your vault.";
      if (state.vaultChoice === "existing" && !state.vaultPath)
        return "pick a folder or choose another option.";
      return null;
    }
    case 2:
      if (!state.claudeDir) return "still checking ~/.claude/…";
      return null;
    case 3:
      return null;
    case 4:
      if (
        !state.apiKey.trim() &&
        !state.providerSkipped &&
        !localAgentReady() &&
        !chatStatus?.has_api_key
      ) {
        return "no local agent found. add a provider key, or check skip to configure later.";
      }
      return null;
    case 5:
      if (state.spriteMode === "custom" && !state.customSprite.trim()) {
        return "describe your creature, or go back to default axolotl.";
      }
      if (state.spriteMode === "custom" && !state.customSpritePreviewPath) {
        return "generate a preview first so summon starts from your custom sprite.";
      }
      return null;
    default:
      return null;
  }
}

function advanceAfterStep4() {
  if (state.spriteMode === "custom") {
    if (previewPrompt) {
      if (!state.customSprite.trim() && previewPrompt.value.trim()) {
        state.customSprite = previewPrompt.value.trim();
      }
      if (!state.customSprite.trim() && !previewPrompt.value.trim()) {
        previewPrompt.value = "";
      } else {
        previewPrompt.value = state.customSprite.trim() || previewPrompt.value.trim();
        state.customSprite = previewPrompt.value;
      }
    }
    setStep(5);
  } else {
    setStep(6);
  }
}

function backFromStep6() {
  if (state.spriteMode === "custom") {
    setStep(5);
  } else {
    setStep(4);
  }
}

nextBtn.addEventListener("click", async () => {
  const err = validateStep(state.step);
  if (err) {
    if (state.step === 1) {
      vaultStatusEl.hidden = false;
      vaultStatusEl.textContent = err;
    }
    if (state.step === 4) setStatus(err, "error");
    if (state.step === 5) {
      if (previewStatus) previewStatus.textContent = err;
    }
    return;
  }

  if (state.step === 4) {
    nextBtn.disabled = true;
    if (state.apiKey.trim()) {
      setStatus("checking your key…");
      try {
        const check = await validateProviderKey(state.provider, state.apiKey.trim());
        if (!check.ok) {
          setStatus(`key rejected — ${check.message}`, "error");
          nextBtn.disabled = false;
          return;
        }
      } catch (e) {
        setStatus(`couldn't reach ${state.provider}: ${String(e)}`, "error");
        nextBtn.disabled = false;
        return;
      }
      setStatus("saving credentials…");
      try {
        await saveProviderCredentials({
          provider: state.provider,
          model: state.model,
          apiKey: state.apiKey.trim(),
          storeInKeychain: state.storeInKeychain
        });
      } catch (e) {
        setStatus(`couldn't save: ${String(e)}`, "error");
        nextBtn.disabled = false;
        return;
      }
      setStatus("provider saved.", "ok");
    } else {
      const line = localAgentReady()
        ? "using your local agent/MCP. provider key can wait."
        : "skipping direct provider setup. add a key later from chat settings.";
      setStatus(line, localAgentReady() ? "ok" : "info");
    }
    nextBtn.disabled = false;
    advanceAfterStep4();
    return;
  }

  if (state.step === TOTAL_STEPS - 1) {
    await runSummon();
    return;
  }

  setStep(state.step + 1);
});

backBtn.addEventListener("click", () => {
  if (state.step === 6) {
    backFromStep6();
    return;
  }
  if (state.step === 5) {
    setStep(4);
    return;
  }
  if (state.step > 0) setStep(state.step - 1);
});

$<HTMLInputElement>("#owner").addEventListener("input", (event) => {
  state.owner = (event.target as HTMLInputElement).value;
});

document.querySelectorAll<HTMLInputElement>('input[name="sprite-mode"]').forEach((el) => {
  el.addEventListener("change", () => {
    state.spriteMode = el.value as SpriteMode;
    syncSpriteDot();
  });
});
syncSpriteDot();
void refreshSessionRestore();

loadPreviousSessionBtn?.addEventListener("click", async () => {
  loadPreviousSessionBtn.disabled = true;
  setStatus("loading previous vault session…");
  try {
    const result = await loadPreviousSession();
    if (!result.ok) {
      setStatus(result.message, "error");
      loadPreviousSessionBtn.disabled = false;
      return;
    }
    setStatus(result.message, "ok");
    await getCurrentWindow().close();
  } catch (e) {
    setStatus(`couldn't load previous session: ${String(e)}`, "error");
    loadPreviousSessionBtn.disabled = false;
  }
});

startFreshSessionBtn?.addEventListener("click", () => {
  restoreDismissed = true;
  if (sessionRestoreCard) sessionRestoreCard.hidden = true;
  setStep(1);
});

deletePreviousSessionBtn?.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Delete the synced twin.md previous session from this vault? This removes .twin-md/profile.json and synced chat snapshots, but keeps your Obsidian notes and local secrets."
  );
  if (!confirmed) return;
  deletePreviousSessionBtn.disabled = true;
  setStatus("deleting previous vault session…");
  try {
    const deleted = await deletePreviousSession();
    restoreDismissed = true;
    if (sessionRestoreCard) sessionRestoreCard.hidden = true;
    setStatus(deleted ? "previous vault session deleted." : "no previous vault session found.", "ok");
  } catch (e) {
    setStatus(`couldn't delete previous session: ${String(e)}`, "error");
  } finally {
    deletePreviousSessionBtn.disabled = false;
  }
});

const vaultStatusEl = $<HTMLElement>("#vault-status");

document.querySelectorAll<HTMLButtonElement>("[data-vault-choice]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const choice = btn.dataset.vaultChoice as VaultChoice;
    document
      .querySelectorAll<HTMLButtonElement>("[data-vault-choice]")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    vaultStatusEl.hidden = false;

    if (choice === "existing") {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Pick your Obsidian vault"
      });
      if (typeof selected === "string") {
        state.vaultChoice = "existing";
        state.vaultPath = selected;
        vaultStatusEl.textContent = `reading from ${selected}`;
        await persistVault(selected);
      } else {
        state.vaultChoice = null;
        state.vaultPath = null;
        vaultStatusEl.textContent = "no folder picked yet.";
      }
    } else if (choice === "create") {
      try {
        const result = await createStarterVault(null);
        state.vaultChoice = "create";
        state.vaultPath = result.path;
        vaultStatusEl.textContent = `seeded ${result.path}`;
        await persistVault(result.path);
      } catch (err) {
        state.vaultChoice = null;
        state.vaultPath = null;
        vaultStatusEl.textContent = `couldn't seed vault: ${String(err)}`;
      }
    } else {
      state.vaultChoice = "skip";
      state.vaultPath = null;
      vaultStatusEl.textContent = "skipping — claude session harvest still runs.";
      await persistVault(null);
    }
  });
});

async function persistVault(path: string | null) {
  try {
    await setVaultPath(path);
  } catch (err) {
    console.warn("vault persist failed (non-fatal)", err);
  }
}

async function runClaudeDirCheck() {
  const card = $<HTMLElement>('[data-detection="claude-dir"]');
  const retry = $<HTMLButtonElement>("#retry-claude");
  card.querySelector(".detection-body")!.textContent = "checking…";
  card.classList.remove("ok", "warn");
  try {
    const result = await ensureClaudeDir();
    state.claudeDir = result;
    card.classList.add("ok");
    card.querySelector(".detection-icon")!.textContent = "✓";
    card.querySelector(".detection-body")!.textContent = result.created
      ? `created ${result.path}`
      : `found ${result.path}`;
    retry.hidden = true;
  } catch (err) {
    card.classList.add("warn");
    card.querySelector(".detection-icon")!.textContent = "!";
    card.querySelector(".detection-body")!.textContent = `couldn't prepare ~/.claude/: ${String(err)}`;
    retry.hidden = false;
  }
}

$<HTMLButtonElement>("#retry-claude").addEventListener("click", runClaudeDirCheck);

const modelSelect = $<HTMLSelectElement>("#model");
const apiKeyInput = $<HTMLInputElement>("#api-key");
const whereLink = $<HTMLAnchorElement>("#where-link");
const storeKeychain = $<HTMLInputElement>("#store-keychain");
const skipProvider = $<HTMLInputElement>("#skip-provider");
const installRembgBtn = document.getElementById("install-rembg") as HTMLButtonElement | null;
const wireLocalMcpBtn = document.getElementById("wire-local-mcp") as HTMLButtonElement | null;
const localAgentHelp = document.getElementById("local-agent-help");

function updateRembgInstallButton(): void {
  if (!installRembgBtn) return;
  const installed = Boolean(chatStatus?.rembgInstalled);
  installRembgBtn.textContent = installed ? "rembg installed" : "install for me";
  installRembgBtn.disabled = installed;
}
const localAgentCard = $<HTMLElement>("#local-agent-status");

function setWireLocalMcpVisible(visible: boolean): void {
  if (wireLocalMcpBtn) wireLocalMcpBtn.hidden = !visible;
  if (localAgentHelp) localAgentHelp.hidden = !visible;
}

async function refreshLocalAgentStatus() {
  const body = localAgentCard.querySelector(".detection-body");
  const icon = localAgentCard.querySelector(".detection-icon");
  if (!body || !icon) return;
  localAgentCard.classList.remove("ok", "warn");
  setWireLocalMcpVisible(false);
  icon.textContent = "·";
  body.textContent = "checking local agent…";
  chatStatus = await getChatStatus();
  updateRembgInstallButton();
  if (!chatStatus) {
    localAgentCard.classList.add("warn");
    icon.textContent = "!";
    body.textContent = "couldn't inspect local chat setup yet.";
    return;
  }
  if (chatStatus.local_mcp_ready) {
    localAgentCard.classList.add("ok");
    icon.textContent = "✓";
    const agent = chatStatus.local_agent ?? "local agent";
    body.textContent = `${agent} is connected to twin MCP. Local chat is ready; provider keys can stay optional.`;
    return;
  }
  if (chatStatus.local_agent) {
    localAgentCard.classList.add("warn");
    icon.textContent = "!";
    body.textContent = `${chatStatus.local_agent} is installed. Build the local twin MCP bridge once so chat can use it.`;
    setWireLocalMcpVisible(true);
    return;
  }
  if (chatStatus.has_api_key) {
    localAgentCard.classList.add("ok");
    icon.textContent = "✓";
    body.textContent = `direct ${chatStatus.provider} key already configured.`;
    return;
  }
  localAgentCard.classList.add("warn");
  icon.textContent = "!";
  body.textContent = "no local agent or provider key yet — add a key below, or skip and configure later.";
}

wireLocalMcpBtn?.addEventListener("click", async () => {
  wireLocalMcpBtn.disabled = true;
  setStatus("building twin MCP and wiring local chat… this can take a minute.");
  try {
    const result = await wireLocalMcp();
    chatStatus = await getChatStatus();
    await refreshLocalAgentStatus();
    const agent = result.agentName ?? "local agent";
    setStatus(`${agent} is wired to ${result.mcpConfigPath}`, "ok");
  } catch (e) {
    setStatus(`local MCP wiring failed: ${String(e)}`, "error");
  } finally {
    wireLocalMcpBtn.disabled = false;
  }
});

async function loadModels(provider: AiProvider) {
  state.provider = provider;
  whereLink.href = PROVIDER_KEY_URLS[provider];
  apiKeyInput.placeholder = PROVIDER_KEY_HINTS[provider];
  try {
    const { models, default_model } = await listModels(provider);
    modelSelect.innerHTML = "";
    const flashIds = new Set([
      "claude-haiku-4-5",
      "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini",
      "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview",
      "gemini-2.5-flash", "gemini-flash-latest"
    ]);
    const flashModels = models.filter((m) => flashIds.has(m));
    const proModels = models.filter((m) => !flashIds.has(m));

    function addGroup(label: string, items: string[]) {
      if (!items.length) return;
      const group = document.createElement("optgroup");
      group.label = label;
      items.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === default_model) opt.selected = true;
        group.appendChild(opt);
      });
      modelSelect.appendChild(group);
    }

    addGroup("flash / mini — recommended", flashModels);
    addGroup("pro / legacy — heavy, slow", proModels);

    state.model = default_model;
  } catch (err) {
    setStatus(`couldn't load models: ${String(err)}`, "error");
  }
}

document.querySelectorAll<HTMLInputElement>('input[name="provider"]').forEach((el) => {
  el.addEventListener("change", () => {
    if (el.checked) void loadModels(el.value as AiProvider);
  });
});

modelSelect.addEventListener("change", () => {
  state.model = modelSelect.value;
});

apiKeyInput.addEventListener("input", () => {
  state.apiKey = apiKeyInput.value;
  if (state.apiKey.trim()) {
    skipProvider.checked = false;
    state.providerSkipped = false;
  }
});

storeKeychain.addEventListener("change", () => {
  state.storeInKeychain = storeKeychain.checked;
});

skipProvider.addEventListener("change", () => {
  state.providerSkipped = skipProvider.checked;
  if (state.providerSkipped) {
    apiKeyInput.value = "";
    state.apiKey = "";
    setStatus("provider setup skipped for now.", "info");
  }
});

installRembgBtn?.addEventListener("click", async () => {
  installRembgBtn.disabled = true;
  setStatus("installing rembg… this can take a minute on first run.");
  try {
    const path = await installRembg();
    chatStatus = await getChatStatus();
    updateRembgInstallButton();
    setStatus(`rembg installed: ${path}`, "ok");
  } catch (e) {
    setStatus(`rembg install failed: ${String(e)}`, "error");
    installRembgBtn.disabled = false;
  } finally {
    updateRembgInstallButton();
  }
});

if (previewPrompt) {
  previewPrompt.addEventListener("input", () => {
    state.customSprite = previewPrompt.value;
    state.customSpritePreviewPath = null;
  });
}

btnGenPreview?.addEventListener("click", async () => {
  const p = (previewPrompt?.value ?? state.customSprite).trim();
  if (!p) {
    if (previewStatus) previewStatus.textContent = "add a description first";
    return;
  }
  const now = Date.now();
  if (now - lastPreviewAt < 1000) {
    if (previewStatus) previewStatus.textContent = "wait a moment…";
    return;
  }
  lastPreviewAt = now;
  state.customSprite = p;
  if (previewStatus) previewStatus.textContent = "generating…";
  try {
    const path = await generateSpritePreview(p);
    state.customSpritePreviewPath = path;
    if (previewImg) {
      previewImg.style.display = "block";
      await setImageFromGeneratedPath(previewImg, path);
    }
    if (previewStatus) previewStatus.textContent = "preview ready — tweak the prompt or continue.";
  } catch (e) {
    if (previewStatus) previewStatus.textContent = String(e);
  }
});

btnGenPreviewPhoto?.addEventListener("click", async () => {
  const p = (previewPrompt?.value ?? state.customSprite).trim();
  if (!p) {
    if (previewStatus) previewStatus.textContent = "describe the sprite style first";
    return;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose a reference photo",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });
  if (typeof selected !== "string") {
    if (previewStatus) previewStatus.textContent = "photo upload cancelled";
    return;
  }
  state.customSprite = p;
  if (previewStatus) previewStatus.textContent = "reading photo and generating sprite…";
  try {
    const path = await generateSpritePreviewFromPhoto(p, selected);
    state.customSpritePreviewPath = path;
    if (previewImg) {
      previewImg.style.display = "block";
      await setImageFromGeneratedPath(previewImg, path);
    }
    if (previewStatus) previewStatus.textContent = "photo sprite ready — continue or upload another.";
  } catch (e) {
    if (previewStatus) previewStatus.textContent = String(e);
  }
});

async function runSummon() {
  nextBtn.disabled = true;
  setStatus("harvesting your second brain…");
  if (state.spriteMode === "custom" && previewPrompt) {
    state.customSprite = previewPrompt.value.trim() || state.customSprite;
  }
  const payload = {
    species: "axolotl" as const,
    owner: state.owner.trim(),
    obsidianVault: state.vaultPath,
    spriteEvolution: {
      kind: state.spriteMode,
      customPrompt: state.spriteMode === "custom" ? state.customSprite.trim() : null,
      currentPath:
        state.spriteMode === "custom" ? state.customSpritePreviewPath : null
    }
  };
  try {
    const result = await runOnboarding(payload);
    if (!result.ok) {
      setStatus(result.message, "error");
      nextBtn.disabled = false;
      return;
    }
    setStatus("your twin is ready.", "ok");
    await getCurrentWindow().close();
  } catch (err) {
    setStatus(`summon failed: ${String(err)}`, "error");
    nextBtn.disabled = false;
  }
}

void loadModels(state.provider);
setStep(0);

const openChatPreviewBtn = document.getElementById(
  "open-chat-preview"
) as HTMLButtonElement | null;
if (openChatPreviewBtn) {
  openChatPreviewBtn.addEventListener("click", () => {
    openChatWindow().catch((err) => {
      setStatus(`couldn't open chat: ${String(err)}`, "error");
    });
  });
}
