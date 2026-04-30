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
  owner: string | null;
  character_name: string | null;
  rembgInstalled: boolean;
}

export interface LocalMcpWireStatus {
  agentName: string | null;
  agentPath: string | null;
  mcpPath: string;
  mcpConfigPath: string;
}

export interface VaultFolderStat {
  path: string;
  files: number;
  words: number;
}

export interface VaultTopicFile {
  path: string;
  score: number;
  words: number;
}

export interface VaultTopicStat {
  topic: string;
  score: number;
  topFiles: VaultTopicFile[];
}

export interface VaultKnowledgeAnalysis {
  vaultPath: string;
  totalMarkdown: number;
  wikiMarkdown: number;
  sourceMarkdown: number;
  topFoldersByFiles: VaultFolderStat[];
  topFoldersByWords: VaultFolderStat[];
  topTopics: VaultTopicStat[];
}

export interface VaultKnowledgeHit {
  path: string;
  title: string;
  score: number;
  words: number;
  snippet: string;
}

export interface VaultKnowledgeRetrieval {
  vaultPath: string;
  query: string;
  totalMarkdown: number;
  hits: VaultKnowledgeHit[];
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

export async function logoutProviderSession(): Promise<void> {
  await invoke("logout_provider_session");
}

export async function signOutToOnboarding(): Promise<void> {
  await invoke("sign_out_to_onboarding");
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

export async function wireLocalMcp(): Promise<LocalMcpWireStatus> {
  return invoke<LocalMcpWireStatus>("wire_local_mcp");
}

export async function analyzeVaultKnowledge(): Promise<VaultKnowledgeAnalysis> {
  return invoke<VaultKnowledgeAnalysis>("analyze_vault_knowledge");
}

export async function retrieveVaultKnowledge(
  query: string,
  limit = 8
): Promise<VaultKnowledgeRetrieval> {
  return invoke<VaultKnowledgeRetrieval>("retrieve_vault_knowledge", {
    payload: { query, limit }
  });
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
  quickNotesPath: string;
  spriteEvolution: {
    kind: "default" | "custom";
    customPrompt: string | null;
    currentPath?: string | null;
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
  customEnabled: boolean;
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

export async function generateSpritePreviewFromPhoto(
  prompt: string,
  photoPath: string
): Promise<string> {
  return invoke<string>("generate_sprite_preview_from_photo", { prompt, photoPath });
}

export async function generateSpriteEvolutionPreview(prompt: string): Promise<string> {
  return invoke<string>("generate_sprite_evolution_preview", { prompt });
}

export async function generateChatBackground(prompt: string): Promise<ImageGenResult> {
  return invoke<ImageGenResult>("generate_chat_background", { prompt });
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

export interface ClaudeActionResult {
  id: string;
  queuePath: string;
  status: TwinActionStatus | string;
  capability: ActionCapability | string | null;
  trusted: boolean;
}

export type ActionCapability =
  | "playwright"
  | "spotify"
  | "reminders"
  | "calendar"
  | "mail"
  | "notes"
  | "desktop";

export type TwinActionStatus =
  | "needs_approval"
  | "pending"
  | "done"
  | "failed"
  | "needs_user"
  | "cancelled";

export interface TwinActionRequest {
  id?: string;
  request?: string;
  capability?: ActionCapability | string | null;
  status?: TwinActionStatus | string;
  result?: string | null;
  createdAt?: string;
  approvedAt?: string;
  resolvedAt?: string;
  [key: string]: unknown;
}

export async function requestClaudeAction(
  request: string,
  capability?: ActionCapability | null
): Promise<ClaudeActionResult> {
  return invoke<ClaudeActionResult>("request_claude_action", {
    payload: { request, capability: capability ?? null }
  });
}

export async function listTwinActions(statuses?: TwinActionStatus[]): Promise<TwinActionRequest[]> {
  return invoke<TwinActionRequest[]>("list_twin_actions", { statuses: statuses ?? null });
}

export async function clearTwinActions(mode: "resolved" | "cancel_open"): Promise<number> {
  return invoke<number>("clear_twin_actions", { mode });
}

export async function approveTwinAction(id: string): Promise<TwinActionRequest> {
  return invoke<TwinActionRequest>("approve_twin_action", { id });
}

export async function rejectTwinAction(id: string): Promise<TwinActionRequest> {
  return invoke<TwinActionRequest>("reject_twin_action", { id });
}

export async function openClaudeActionRunner(id: string): Promise<void> {
  await invoke("open_claude_action_runner", { id });
}

export async function applySpriteEvolutionPreview(path: string): Promise<void> {
  await invoke("apply_sprite_evolution_preview", { path });
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

export async function setVaultPath(
  path: string | null,
  quickNotesPath = "inbox"
): Promise<void> {
  await invoke("set_vault_path", { payload: { path, quickNotesPath } });
}

export interface VaultProfileStatus {
  canLoad: boolean;
  vaultPath: string | null;
  profilePath: string | null;
  owner: string | null;
  updatedAt: string | null;
  quickNotesPath: string | null;
  spritePrompt: string | null;
  chatBackground: unknown | null;
  approvedActionCapabilities: ActionCapability[] | string[];
}

export async function getVaultProfileStatus(): Promise<VaultProfileStatus> {
  return invoke<VaultProfileStatus>("get_vault_profile_status");
}

export async function deletePreviousSession(): Promise<boolean> {
  return invoke<boolean>("delete_previous_session");
}

export async function loadPreviousSession(): Promise<{ ok: boolean; message: string }> {
  return invoke("load_previous_session");
}

export async function saveVaultProfileUi(chatBackground: unknown): Promise<void> {
  await invoke("save_vault_profile_ui", { chatBackground });
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

export async function openChatWindow(seed?: string | null, intro?: string | null): Promise<void> {
  await invoke("open_chat_window", { seed: seed ?? null, intro: intro ?? null });
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

export function onCwIntro(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("twin://cw-intro", (event) => cb(event.payload));
}

export function onActionQueueChanged(cb: () => void): Promise<UnlistenFn> {
  return listen("twin://action-queue-changed", () => cb());
}
