import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
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
  local_agent: string | null;
  local_agent_path: string | null;
  local_mcp_ready: boolean;
  chat_available: boolean;
  vault_path: string | null;
  notes_available: number;
  provider: string;
  model: string;
  rembgInstalled: boolean;
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

export async function installRembg(): Promise<string> {
  return invoke<string>("install_rembg");
}

export async function dismissBubble(id: string): Promise<void> {
  try {
    await invoke("dismiss_bubble", { id });
  } catch {
    /* swallow — bubble may already be closed */
  }
}

export async function triggerHarvest(): Promise<void> {
  await invoke("trigger_harvest");
}

export interface OnboardingPayload {
  species: "axolotl";
  owner: string;
  obsidianVault: string | null;
  spriteEvolution: {
    kind: "default" | "custom";
    customPrompt: string | null;
  };
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



export interface SpriteUpdatePayload {
  path: string;
  isSvg: boolean;
}

export type SpriteEvolvingReason = "auto" | "manual";

export interface SpriteEvolutionSnapshot {
  currentPath: string | null;
  isSvg: boolean;
}

export async function getSpriteEvolution(): Promise<SpriteEvolutionSnapshot> {
  return invoke<SpriteEvolutionSnapshot>("get_sprite_evolution");
}

export async function generatedAssetDataUrl(path: string): Promise<string> {
  return invoke<string>("generated_asset_data_url", { path });
}

export function onSpriteUpdated(
  cb: (payload: SpriteUpdatePayload) => void
): Promise<UnlistenFn> {
  return listen<SpriteUpdatePayload>("twin://sprite-updated", (event) =>
    cb(event.payload)
  );
}

export function onSpriteEvolving(
  cb: (payload: { reason: SpriteEvolvingReason }) => void
): Promise<UnlistenFn> {
  return listen<{ reason: SpriteEvolvingReason }>(
    "twin://sprite-evolving",
    (event) => cb(event.payload)
  );
}

export function onSpriteEvolveError(
  cb: (payload: { message: string }) => void
): Promise<UnlistenFn> {
  return listen<{ message: string }>("twin://sprite-evolve-error", (event) =>
    cb(event.payload)
  );
}

export function onSpriteEvolveCooldown(
  cb: (payload: { waitSecs: number }) => void
): Promise<UnlistenFn> {
  return listen<{ waitSecs: number }>("twin://sprite-evolve-cooldown", (event) =>
    cb(event.payload)
  );
}

export async function regenerateSprite(): Promise<string> {
  return invoke<string>("regenerate_sprite");
}

export async function generateSpritePreview(prompt: string): Promise<string> {
  return invoke<string>("generate_sprite_preview", { prompt });
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

export async function emitLastChat(message: string): Promise<void> {
  await emit("twin://last-chat", message);
}

export function onLastChat(cb: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("twin://last-chat", (event) => cb(event.payload));
}

export async function sendChat(message: string): Promise<void> {
  await invoke("send_chat", { message });
}

export interface LocalCommandOutcome {
  ok: boolean;
  message: string;
  path: string | null;
}

export async function runLocalCommand(
  handler: "inbox" | "mood",
  args: string
): Promise<LocalCommandOutcome> {
  return invoke<LocalCommandOutcome>("run_local_command", {
    payload: { handler, args }
  });
}

export async function streamSlashCommand(
  systemPrompt: string,
  userMessage: string
): Promise<void> {
  await invoke("stream_slash_command", {
    payload: { systemPrompt, userMessage }
  });
}

export interface ValidateKeyResult {
  ok: boolean;
  message: string;
}

export async function setVaultPath(path: string | null): Promise<void> {
  await invoke("set_vault_path", { payload: { path } });
}

export async function validateProviderKey(
  provider: AiProvider,
  apiKey: string
): Promise<ValidateKeyResult> {
  return invoke<ValidateKeyResult>("validate_provider_key", {
    payload: { provider, apiKey }
  });
}

// ── Chat window ──────────────────────────────────────────────────────────────

export interface CwMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatTurn extends CwMessage {
  ts: string;
}

export interface WriteNoteResult {
  path: string;
}

export interface ImageGenResult {
  ok: boolean;
  savedPath: string | null;
  providerUsed: string | null;
  error: string | null;
  prompt: string;
}

export async function openChatWindow(seed?: string | null): Promise<void> {
  await invoke("open_chat_window", { seed: seed ?? null });
}

export async function sendChatWindow(messages: CwMessage[]): Promise<void> {
  await invoke("send_chat_window", { messages });
}

export async function saveChatSession(sessionId: string, turns: ChatTurn[]): Promise<void> {
  await invoke("save_chat_session", { sessionId, turns });
}

export async function writeVaultNote(
  title: string,
  body: string,
  folder?: string | null
): Promise<WriteNoteResult> {
  return invoke<WriteNoteResult>("write_vault_note", { title, body, folder: folder ?? null });
}

export async function logMoodEntry(mood: string, note?: string | null): Promise<void> {
  await invoke("log_mood_entry", { mood, note: note ?? null });
}

export async function generateImage(prompt: string): Promise<ImageGenResult> {
  return invoke<ImageGenResult>("generate_image", { prompt });
}

export function onCwToken(cb: (chunk: string) => void): Promise<UnlistenFn> {
  return listen<string>("twin://cw-token", (event) => cb(event.payload));
}

export function onCwDone(cb: () => void): Promise<UnlistenFn> {
  return listen<null>("twin://cw-done", () => cb());
}

export function onCwSeed(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("twin://cw-seed", (event) => cb(event.payload));
}
