import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { runOnboarding } from "./ipc.ts";
import type { TwinSpecies } from "./types.ts";

const pickVault = document.getElementById("pick-vault") as HTMLButtonElement;
const vaultPath = document.getElementById("vault-path") as HTMLSpanElement;
const owner = document.getElementById("owner") as HTMLInputElement;
const submit = document.getElementById("onboard-submit") as HTMLButtonElement;
const status = document.getElementById("onboard-status") as HTMLElement;

let vault: string | null = null;

pickVault.addEventListener("click", async () => {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Pick your Obsidian vault"
  });
  if (typeof selected === "string") {
    vault = selected;
    vaultPath.textContent = selected;
    vaultPath.classList.remove("muted");
  }
});

submit.addEventListener("click", async () => {
  const species = (
    document.querySelector(
      'input[name="species"]:checked'
    ) as HTMLInputElement | null
  )?.value as TwinSpecies | undefined;

  const ownerName = owner.value.trim();

  if (!species) {
    status.textContent = "pick a species first.";
    return;
  }
  if (!ownerName) {
    status.textContent = "tell your twin who you are.";
    owner.focus();
    return;
  }

  submit.disabled = true;
  status.textContent = "harvesting your second brain…";

  const result = await runOnboarding({
    species,
    owner: ownerName,
    obsidianVault: vault
  });

  if (!result.ok) {
    status.textContent = result.message;
    submit.disabled = false;
    return;
  }

  status.textContent = "your twin is ready.";
  await getCurrentWindow().close();
});
