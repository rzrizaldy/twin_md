import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createStarterVault,
  ensureClaudeDir,
  listModels,
  openWebCompanion,
  runOnboarding,
  saveProviderCredentials,
  setVaultPath,
  validateProviderKey,
  type AiProvider,
  type ClaudeDirStatus
} from "./ipc.ts";
import type { PetSpriteVariant } from "./ipc.ts";
import type { TwinSpecies } from "./types.ts";

const TOTAL_STEPS = 6;

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

type VaultChoice = "existing" | "create" | "skip";

interface WizardState {
  step: number;
  species: TwinSpecies;
  petSpriteVariant: PetSpriteVariant;
  owner: string;
  vaultChoice: VaultChoice | null;
  vaultPath: string | null;
  claudeDir: ClaudeDirStatus | null;
  provider: AiProvider;
  model: string;
  apiKey: string;
  storeInKeychain: boolean;
  skipAi: boolean;
}

const state: WizardState = {
  step: 0,
  species: "axolotl",
  petSpriteVariant: "clean",
  owner: "",
  vaultChoice: null,
  vaultPath: null,
  claudeDir: null,
  provider: "anthropic",
  model: "claude-haiku-4-5",
  apiKey: "",
  storeInKeychain: true,
  skipAi: false
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

function setStep(step: number) {
  state.step = Math.max(0, Math.min(TOTAL_STEPS - 1, step));
  stepsEls.forEach((el) => {
    el.classList.toggle(
      "is-active",
      Number(el.dataset.step ?? -1) === state.step
    );
  });
  dots.forEach((dot) => {
    const idx = Number(dot.dataset.stepDot ?? -1);
    dot.classList.toggle("is-active", idx === state.step);
    dot.classList.toggle("is-done", idx < state.step);
  });
  backBtn.hidden = state.step === 0;
  nextBtn.textContent = state.step === TOTAL_STEPS - 1 ? "summon my twin" : "next";
  statusEl.textContent = "";
  if (state.step === 2) runClaudeDirCheck();
}

function validateStep(step: number): string | null {
  switch (step) {
    case 1:
      if (!state.owner.trim()) return "tell your twin who you are.";
      return null;
    case 2:
      if (!state.claudeDir) return "still checking ~/.claude/…";
      return null;
    case 3:
      if (!state.vaultChoice) return "pick an option for your vault.";
      if (state.vaultChoice === "existing" && !state.vaultPath)
        return "pick a folder or choose another option.";
      return null;
    case 4:
      if (state.skipAi) return null;
      if (!state.apiKey.trim())
        return "drop in an api key, or hit 'skip for now'.";
      return null;
    default:
      return null;
  }
}

nextBtn.addEventListener("click", async () => {
  const err = validateStep(state.step);
  if (err) {
    statusEl.textContent = err;
    return;
  }

  if (state.step === 4 && !state.skipAi) {
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
    statusEl.textContent = "key works.";
    nextBtn.disabled = false;
  }

  if (state.step === TOTAL_STEPS - 1) {
    await runSummon();
    return;
  }

  setStep(state.step + 1);
});

backBtn.addEventListener("click", () => setStep(state.step - 1));

// — Step 1 —
document.querySelectorAll<HTMLInputElement>('input[name="species"]').forEach((el) => {
  el.addEventListener("change", () => {
    state.species = el.value as TwinSpecies;
  });
});

$<HTMLInputElement>("#owner").addEventListener("input", (event) => {
  state.owner = (event.target as HTMLInputElement).value;
});

document.querySelectorAll<HTMLInputElement>('input[name="pet-sprite-variant"]').forEach((el) => {
  el.addEventListener("change", () => {
    if (el.checked) {
      state.petSpriteVariant = el.value as PetSpriteVariant;
    }
  });
});

// — Step 2 —
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

// — Step 3 —
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

// — Step 4 —
const modelSelect = $<HTMLSelectElement>("#model");
const apiKeyInput = $<HTMLInputElement>("#api-key");
const whereLink = $<HTMLAnchorElement>("#where-link");
const storeKeychain = $<HTMLInputElement>("#store-keychain");
const skipAiBtn = $<HTMLButtonElement>("#skip-ai");

async function loadModels(provider: AiProvider) {
  state.provider = provider;
  whereLink.href = PROVIDER_KEY_URLS[provider];
  apiKeyInput.placeholder = PROVIDER_KEY_HINTS[provider];
  try {
    const { models, default_model } = await listModels(provider);
    modelSelect.innerHTML = "";

    // Group into flash/mini (recommended) vs pro/legacy
    const flashIds = new Set([
      "claude-haiku-4-5",
      "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini",
      "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview",
      "gemini-2.5-flash", "gemini-flash-latest",
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
    if (el.checked) loadModels(el.value as AiProvider);
  });
});

modelSelect.addEventListener("change", () => {
  state.model = modelSelect.value;
});

apiKeyInput.addEventListener("input", () => {
  state.apiKey = apiKeyInput.value;
  if (state.apiKey.trim()) state.skipAi = false;
});

storeKeychain.addEventListener("change", () => {
  state.storeInKeychain = storeKeychain.checked;
});

skipAiBtn.addEventListener("click", () => {
  state.skipAi = true;
  state.apiKey = "";
  apiKeyInput.value = "";
  statusEl.textContent = "chat disabled — mirror still runs. jumping ahead.";
  setStep(state.step + 1);
});

// — Step 5 —
async function runSummon() {
  nextBtn.disabled = true;
  statusEl.textContent = "harvesting your second brain…";

  const payload = {
    species: state.species,
    owner: state.owner.trim(),
    obsidianVault: state.vaultPath,
    petSpriteVariant: state.petSpriteVariant
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

// Boot.
void loadModels(state.provider);
setStep(0);

// — Step 5 extras —
const openBrowserBtn = document.getElementById(
  "open-browser"
) as HTMLButtonElement | null;
if (openBrowserBtn) {
  openBrowserBtn.addEventListener("click", () => {
    openWebCompanion().catch((err) => {
      statusEl.textContent = `couldn't open browser: ${String(err)}`;
    });
  });
}
