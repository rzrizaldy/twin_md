import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PetState, Reminder } from "./types.ts";

export async function getState(): Promise<PetState | null> {
  try {
    return await invoke<PetState>("get_state");
  } catch {
    return null;
  }
}

export interface ChatStatus {
  has_api_key: boolean;
  vault_path: string | null;
  notes_available: number;
  provider: string;
  model: string;
}

export type AiProvider = "anthropic" | "openai" | "gemini";

export interface ClaudeDirStatus {
  path: string;
  existed: boolean;
  created: boolean;
}

export interface StarterVaultResult {
  path: string;
}

export interface ProviderCredentialsPayload {
  provider: AiProvider;
  model: string;
  apiKey?: string | null;
  storeInKeychain?: boolean;
}

export interface ProviderCredentialsResult {
  ok: boolean;
  storage: "env" | "keychain" | "config";
  provider: AiProvider;
  model: string;
}

export interface ModelList {
  provider: AiProvider;
  models: string[];
  default_model: string;
}

export async function ensureClaudeDir(): Promise<ClaudeDirStatus> {
  return invoke<ClaudeDirStatus>("ensure_claude_dir");
}

export async function createStarterVault(
  path?: string | null
): Promise<StarterVaultResult> {
  return invoke<StarterVaultResult>("create_starter_vault", { path: path ?? null });
}

export async function saveProviderCredentials(
  payload: ProviderCredentialsPayload
): Promise<ProviderCredentialsResult> {
  return invoke<ProviderCredentialsResult>("save_provider_credentials", { payload });
}

export async function listModels(provider: AiProvider): Promise<ModelList> {
  return invoke<ModelList>("list_models", { provider });
}

export async function getChatStatus(): Promise<ChatStatus | null> {
  try {
    return await invoke<ChatStatus>("get_chat_status");
  } catch {
    return null;
  }
}

export async function dismissBubble(id: string): Promise<void> {
  try {
    await invoke("dismiss_bubble", { id });
  } catch {
    /* swallow — bubble may already be closed */
  }
}

export async function openChat(): Promise<void> {
  await invoke("open_chat");
}

export async function triggerHarvest(): Promise<void> {
  await invoke("trigger_harvest");
}

export interface OnboardingPayload {
  species: "axolotl" | "cat" | "slime";
  owner: string;
  obsidianVault: string | null;
}

export async function runOnboarding(
  payload: OnboardingPayload
): Promise<{ ok: boolean; message: string }> {
  return invoke("run_onboarding", { payload });
}

export function onStateChanged(
  cb: (state: PetState) => void
): Promise<UnlistenFn> {
  return listen<PetState>("twin://state-changed", (event) => cb(event.payload));
}

export function onReminder(
  cb: (reminder: Reminder) => void
): Promise<UnlistenFn> {
  return listen<Reminder>("twin://reminder", (event) => cb(event.payload));
}

export function onChatToken(
  cb: (chunk: string) => void
): Promise<UnlistenFn> {
  return listen<string>("twin://chat-token", (event) => cb(event.payload));
}

export function onChatDone(cb: () => void): Promise<UnlistenFn> {
  return listen<null>("twin://chat-done", () => cb());
}

export async function sendChat(message: string): Promise<void> {
  await invoke("send_chat", { message });
}
