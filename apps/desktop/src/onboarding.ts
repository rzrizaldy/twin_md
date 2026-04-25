import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createStarterVault,
  ensureClaudeDir,
  generateSpritePreview,
  listModels,
  openChatWindow,
  runOnboarding,
  saveProviderCredentials,
  setVaultPath,
  validateProviderKey,
  type AiProvider,
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
  owner: string;
  vaultChoice: VaultChoice;
  vaultPath: string | null;
  claudeDir: ClaudeDirStatus | null;
  provider: AiProvider;
  model: string;
  apiKey: string;
  storeInKeychain: boolean;
}

const state: WizardState = {
  step: 0,
  spriteMode: "default",
  customSprite: "",
  owner: "",
  vaultChoice: null,
  vaultPath: null,
  claudeDir: null,
  provider: "anthropic",
  model: "claude-haiku-4-5",
  apiKey: "",
  storeInKeychain: false
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
const previewStatus = document.getElementById("preview-status");
const previewImg = document.getElementById("preview-img") as HTMLImageElement | null;
let lastPreviewAt = 0;

function syncSpriteDot() {
  const d5 = document.querySelector<HTMLElement>('[data-step-dot="5"]');
  if (d5) d5.style.display = state.spriteMode === "custom" ? "" : "none";
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
  if (state.step < 4) statusEl.textContent = "";
  if (state.step === 2) runClaudeDirCheck();
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
      if (!state.apiKey.trim())
        return "add an API key for the selected provider.";
      return null;
    case 5:
      if (state.spriteMode === "custom" && !state.customSprite.trim()) {
        return "describe your creature, or go back to default axolotl.";
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
    if (state.step === 4) statusEl.textContent = err;
    if (state.step === 5) {
      if (previewStatus) previewStatus.textContent = err;
    }
    return;
  }

  if (state.step === 4) {
    nextBtn.disabled = true;
    statusEl.textContent = "checking your key…";
    try {
      const check = await validateProviderKey(state.provider, state.apiKey.trim());
      if (!check.ok) {
        statusEl.textContent = `key rejected — ${check.message}`;
        nextBtn.disabled = false;
        return;
      }
    } catch (e) {
      statusEl.textContent = `couldn't reach ${state.provider}: ${String(e)}`;
      nextBtn.disabled = false;
      return;
    }
    statusEl.textContent = "saving credentials…";
    try {
      await saveProviderCredentials({
        provider: state.provider,
        model: state.model,
        apiKey: state.apiKey.trim(),
        storeInKeychain: state.storeInKeychain
      });
    } catch (e) {
      statusEl.textContent = `couldn't save: ${String(e)}`;
      nextBtn.disabled = false;
      return;
    }
    statusEl.textContent = "saved.";
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
    statusEl.textContent = `couldn't load models: ${String(err)}`;
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
});

storeKeychain.addEventListener("change", () => {
  state.storeInKeychain = storeKeychain.checked;
});

if (previewPrompt) {
  previewPrompt.addEventListener("input", () => {
    state.customSprite = previewPrompt.value;
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
    if (previewImg) {
      previewImg.style.display = "block";
      previewImg.src = convertFileSrc(path);
    }
    if (previewStatus) previewStatus.textContent = "preview ready — tweak the prompt or continue.";
  } catch (e) {
    if (previewStatus) previewStatus.textContent = String(e);
  }
});

async function runSummon() {
  nextBtn.disabled = true;
  statusEl.textContent = "harvesting your second brain…";
  if (state.spriteMode === "custom" && previewPrompt) {
    state.customSprite = previewPrompt.value.trim() || state.customSprite;
  }
  const payload = {
    species: "axolotl" as const,
    owner: state.owner.trim(),
    obsidianVault: state.vaultPath,
    spriteEvolution: {
      kind: state.spriteMode,
      customPrompt: state.spriteMode === "custom" ? state.customSprite.trim() : null
    }
  };
  try {
    const result = await runOnboarding(payload);
    if (!result.ok) {
      statusEl.textContent = result.message;
      nextBtn.disabled = false;
      return;
    }
    statusEl.textContent = "your twin is ready.";
    await getCurrentWindow().close();
  } catch (err) {
    statusEl.textContent = `summon failed: ${String(err)}`;
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
      statusEl.textContent = `couldn't open chat: ${String(err)}`;
    });
  });
}
