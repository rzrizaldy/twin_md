use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::chat;
use crate::ai_agents;
use crate::commands as slash_commands;
use crate::credentials;
use crate::harvest;
use crate::image_gen;
use crate::rembg;
use crate::model::{ChatTurn, ChatWindowMessage, PetState};
use crate::paths::{chat_history_dir, claude_dir};
use crate::provider::Provider;
use crate::state::SharedState;
use crate::windows;

#[tauri::command]
pub fn get_state(shared: State<'_, SharedState>) -> Option<PetState> {
    shared.get()
}

#[derive(serde::Serialize)]
pub struct ChatStatus {
    pub has_api_key: bool,
    pub local_agent: Option<String>,
    pub local_agent_path: Option<String>,
    pub local_mcp_ready: bool,
    pub chat_available: bool,
    pub vault_path: Option<String>,
    pub notes_available: usize,
    pub provider: String,
    pub model: String,
    #[serde(rename = "rembgInstalled")]
    pub rembg_installed: bool,
}

#[tauri::command]
pub fn get_chat_status() -> ChatStatus {
    let ctx = crate::context::gather();
    let (provider, model) = credentials::active_provider_and_model();
    let local = ai_agents::cli_agent_status();
    let has_api_key = chat::has_api_key();
    let local_mcp_ready = local
        .as_ref()
        .map(|(_, _, ready)| *ready)
        .unwrap_or(false);
    ChatStatus {
        has_api_key,
        local_agent: local.as_ref().map(|(name, _, _)| name.clone()),
        local_agent_path: local.as_ref().map(|(_, path, _)| path.display().to_string()),
        local_mcp_ready,
        chat_available: has_api_key || local_mcp_ready,
        vault_path: ctx.vault_path.map(|p| p.display().to_string()),
        notes_available: ctx.notes.len(),
        provider: provider.slug().to_string(),
        model,
        rembg_installed: rembg::is_available(),
    }
}

#[tauri::command]
pub async fn install_rembg() -> Result<String, String> {
    crate::rembg::install()
        .await
        .map(|path| path.display().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sprite_evolution() -> crate::sprite::SpriteEvolutionSnapshot {
    crate::sprite::current_snapshot()
}

#[tauri::command]
pub fn generated_asset_data_url(path: String) -> Result<String, String> {
    let raw = PathBuf::from(path.trim());
    let canonical = raw.canonicalize().map_err(|e| e.to_string())?;
    let claude_root = claude_dir().canonicalize().map_err(|e| e.to_string())?;
    let vault_media = resolve_vault_root()
        .and_then(|root| root.join("media").canonicalize().ok());

    let allowed = canonical.starts_with(claude_root.join("twin"))
        || vault_media
            .as_ref()
            .map(|media| canonical.starts_with(media))
            .unwrap_or(false);
    if !allowed {
        return Err("refusing to read generated asset outside twin data folders".to_string());
    }

    let ext = canonical
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return Err(format!("unsupported generated asset type: {ext}")),
    };
    let bytes = fs::read(&canonical).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
pub fn apply_custom_sprite_preview(app: AppHandle, prompt: String, path: String) -> Result<(), String> {
    let raw = PathBuf::from(path.trim());
    let canonical = raw.canonicalize().map_err(|e| e.to_string())?;
    let sprite_root = claude_dir()
        .join("twin")
        .join("sprites")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical.starts_with(&sprite_root) {
        return Err("refusing to summon sprite outside generated sprites folder".to_string());
    }

    let ext = canonical
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "svg") {
        return Err(format!("unsupported sprite type: {ext}"));
    }

    let cfg_path = claude_dir().join("twin.config.json");
    fs::create_dir_all(claude_dir()).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = match fs::read(&cfg_path) {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    };
    if !value.is_object() {
        value = serde_json::json!({});
    }
    let obj = value.as_object_mut().expect("object");
    obj.insert(
        "spriteEvolution".into(),
        serde_json::json!({
            "kind": "custom",
            "customPrompt": prompt.trim(),
            "currentPath": canonical.display().to_string(),
            "updatedAt": chrono::Local::now().to_rfc3339()
        }),
    );
    fs::write(
        &cfg_path,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "twin://sprite-updated",
        serde_json::json!({
            "path": canonical.display().to_string(),
            "isSvg": ext == "svg"
        }),
    );
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeActionPayload {
    pub request: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeActionResult {
    pub id: String,
    pub queue_path: String,
}

#[tauri::command]
pub fn request_claude_action(payload: ClaudeActionPayload) -> Result<ClaudeActionResult, String> {
    let request = payload.request.trim();
    if request.is_empty() {
        return Err("tell me what Claude Desktop should do".to_string());
    }

    let id = format!("act-{}", chrono::Utc::now().timestamp_millis());
    let queue_path = claude_dir().join("twin").join("action-requests.jsonl");
    if let Some(parent) = queue_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let event = serde_json::json!({
        "id": id,
        "status": "pending",
        "source": "twin-desktop",
        "request": request,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "hint": "Claude Desktop should read this through twin MCP get_pending_twin_actions, act with its own tools, then call resolve_twin_action."
    });
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&queue_path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{event}").map_err(|e| e.to_string())?;

    Ok(ClaudeActionResult {
        id,
        queue_path: queue_path.display().to_string(),
    })
}

#[tauri::command]
pub async fn dismiss_bubble(app: AppHandle, id: String) -> Result<(), String> {
    let label = format!(
        "bubble-{}",
        id.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
            .collect::<String>()
    );
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn trigger_harvest() -> Result<(), String> {
    harvest::harvest().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_chat(
    app: AppHandle,
    shared: State<'_, SharedState>,
    message: String,
) -> Result<(), String> {
    let state = shared.get();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = chat::stream(app, message, state).await {
            eprintln!("[twin] chat stream error: {err:?}");
        }
    });
    Ok(())
}

// ──────────────────────────── Slash commands ────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPayload {
    pub path: Option<String>,
}

/// Persists the vault path into `~/.claude/twin.config.json` immediately on
/// select. Keeps the rest of the config intact; creates the file if missing.
#[tauri::command]
pub fn set_vault_path(payload: VaultPayload) -> Result<(), String> {
    let cfg_path = claude_dir().join("twin.config.json");
    fs::create_dir_all(claude_dir()).map_err(|e| e.to_string())?;

    let mut value: serde_json::Value = match fs::read(&cfg_path) {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    };

    if !value.is_object() {
        value = serde_json::json!({});
    }

    let obj = value.as_object_mut().expect("object");
    match payload.path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => {
            obj.insert(
                "obsidianVaultPath".into(),
                serde_json::Value::String(p.to_string()),
            );
        }
        None => {
            obj.remove("obsidianVaultPath");
        }
    }

    fs::write(&cfg_path, serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateKeyPayload {
    pub provider: String,
    pub api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateKeyResult {
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub async fn validate_provider_key(
    payload: ValidateKeyPayload,
) -> Result<ValidateKeyResult, String> {
    let provider = Provider::parse(&payload.provider)
        .ok_or_else(|| format!("unknown provider: {}", payload.provider))?;
    match crate::provider::validate_key(provider, &payload.api_key).await {
        Ok(()) => Ok(ValidateKeyResult {
            ok: true,
            message: "key accepted".into(),
        }),
        Err(err) => Ok(ValidateKeyResult {
            ok: false,
            message: err.to_string(),
        }),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCommandPayload {
    pub handler: String, // "inbox" | "mood"
    pub args: String,
}

#[tauri::command]
pub fn run_local_command(
    payload: LocalCommandPayload,
) -> Result<slash_commands::CommandOutcome, String> {
    let result = match payload.handler.as_str() {
        "inbox" => slash_commands::run_inbox(&payload.args),
        "mood" => slash_commands::run_mood(&payload.args),
        other => return Err(format!("unknown local command handler: {other}")),
    };
    result.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashStreamPayload {
    pub system_prompt: String,
    pub user_message: String,
}

/// LLM-backed slash command — streams through the same `twin://chat-token`
/// channel as regular chat but uses the caller-supplied system prompt (the
/// pet-wellness persona).
#[tauri::command]
pub async fn stream_slash_command(
    app: AppHandle,
    shared: State<'_, SharedState>,
    payload: SlashStreamPayload,
) -> Result<(), String> {
    let state = shared.get();
    tauri::async_runtime::spawn(async move {
        if let Err(err) =
            chat::stream_with_system(app, payload.user_message, state, Some(payload.system_prompt))
                .await
        {
            eprintln!("[twin] slash command stream error: {err:?}");
        }
    });
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingPayload {
    pub species: String,
    pub owner: String,
    pub obsidian_vault: Option<String>,
    pub sprite_evolution: Option<serde_json::Value>,
}


fn merge_sprite_evolution(v: &serde_json::Value) -> Result<(), String> {
    let p = claude_dir().join("twin.config.json");
    let mut value: serde_json::Value = match fs::read(&p) {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    };
    if !value.is_object() {
        value = serde_json::json!({});
    }
    let o = value.as_object_mut().expect("object");
    o.insert("spriteEvolution".into(), v.clone());
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct OnboardingResult {
    pub ok: bool,
    pub message: String,
}

fn onboarding_intro(owner: &str, sprite_evolution: Option<&serde_json::Value>) -> String {
    let name = owner.trim();
    let greeting = if name.is_empty() {
        "Hai".to_string()
    } else {
        format!("Hai {name}")
    };

    let custom = sprite_evolution
        .and_then(|v| v.get("kind"))
        .and_then(|v| v.as_str())
        == Some("custom");
    let prompt = sprite_evolution
        .and_then(|v| v.get("customPrompt"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty());

    if custom {
        if let Some(prompt) = prompt {
            return format!(
                "{greeting}, aku udah kebangun. Aku twin kamu yang bentuknya dari ide: **{prompt}**. Aku bakal nemenin kamu dengan gaya karakter ini, baca konteksmu pelan-pelan, dan bantu jagain mood kerja kamu tanpa ribut."
            );
        }
    }

    format!(
        "{greeting}, aku Axiotyl. Aku twin kecil kamu di desktop: baca konteksmu, bantu catat hal penting, dan ngingetin pelan-pelan kalau energi mulai turun."
    )
}

#[tauri::command]
pub async fn run_onboarding(
    app: AppHandle,
    shared: State<'_, SharedState>,
    payload: OnboardingPayload,
) -> Result<OnboardingResult, String> {
    let vault = payload.obsidian_vault.as_deref();

    if let Err(err) = harvest::init(
        &payload.species,
        &payload.owner,
        vault,
    )
    .await
    {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("init failed: {err}"),
        });
    }

    if let Some(ref ev) = payload.sprite_evolution {
        if let Err(e) = merge_sprite_evolution(ev) {
            return Ok(OnboardingResult {
                ok: false,
                message: format!("config merge failed: {e}"),
            });
        }
    }

    if let Err(err) = harvest::harvest().await {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("harvest failed: {err}"),
        });
    }

    if let Ok(Some(next)) = crate::state::read_state_file() {
        let _ = crate::sprite::pin_current_sprite_to_state(&next);
        let snapshot = crate::sprite::current_snapshot();
        if let Some(path) = snapshot.current_path.clone() {
            let _ = app.emit(
                "twin://sprite-updated",
                serde_json::json!({
                    "path": path,
                    "isSvg": snapshot.is_svg
                }),
            );
        }
        shared.set(next.clone());
        let _ = app.emit("twin://state-changed", next);
    }

    if let Err(err) = windows::show_companion(&app) {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("couldn't summon companion: {err}"),
        });
    }

    let intro = onboarding_intro(&payload.owner, payload.sprite_evolution.as_ref());
    let _ = windows::show_chat_with_intro(&app, &intro);

    Ok(OnboardingResult {
        ok: true,
        message: "ready".into(),
    })
}

// ──────────────────────────── Track D additions ────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDirStatus {
    pub path: String,
    pub existed: bool,
    pub created: bool,
}

#[tauri::command]
pub fn ensure_claude_dir() -> Result<ClaudeDirStatus, String> {
    let dir = claude_dir();
    let existed = dir.exists();
    if !existed {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(ClaudeDirStatus {
        path: dir.display().to_string(),
        existed,
        created: !existed,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterVaultResult {
    pub path: String,
}

#[tauri::command]
pub fn create_starter_vault(path: Option<String>) -> Result<StarterVaultResult, String> {
    let target: PathBuf = match path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => {
            let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
            PathBuf::from(home).join("twin-second-brain")
        }
    };

    fs::create_dir_all(target.join("daily-notes")).map_err(|e| e.to_string())?;

    let readme = target.join("README.md");
    if !readme.exists() {
        let body = "# twin second brain\n\nA seed vault created by twin.md so your desk creature has somewhere to read from.\n\n- `daily-notes/` — one markdown file per day. Any frontmatter `tags:` and unchecked `- [ ]` lines get picked up.\n- Point a real Obsidian vault at this folder when you're ready, or keep scribbling here.\n\nNothing in here ever leaves your machine.\n";
        fs::write(&readme, body).map_err(|e| e.to_string())?;
    }

    let today = today_stub(&target);
    if let Some(stub) = today.as_ref() {
        if !stub.exists() {
            let template = "---\ntags: [twin, seed]\n---\n\n# today\n\n- [ ] first breath\n- [ ] say hi to my twin\n";
            fs::write(stub, template).map_err(|e| e.to_string())?;
        }
    }

    Ok(StarterVaultResult {
        path: target.display().to_string(),
    })
}

fn today_stub(root: &Path) -> Option<PathBuf> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    let days = secs / 86_400;
    // Rough approximation is fine; the onboarding only needs a seed file.
    Some(root.join("daily-notes").join(format!("{days}.md")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentials {
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    pub store_in_keychain: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentialsResult {
    pub ok: bool,
    pub storage: String,
    pub provider: String,
    pub model: String,
}

#[tauri::command]
pub fn save_provider_credentials(
    payload: ProviderCredentials,
) -> Result<ProviderCredentialsResult, String> {
    let provider = Provider::parse(&payload.provider)
        .ok_or_else(|| format!("unknown provider '{}'", payload.provider))?;
    let store = payload.store_in_keychain.unwrap_or(false);
    let api_key = payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let storage = credentials::save_credentials(provider, &payload.model, api_key, store)
        .map_err(|e| e.to_string())?;

    Ok(ProviderCredentialsResult {
        ok: true,
        storage: match storage {
            credentials::Storage::Env => "env",
            credentials::Storage::Keychain => "keychain",
            credentials::Storage::Config => "config",
        }
        .to_string(),
        provider: provider.slug().to_string(),
        model: payload.model,
    })
}

#[derive(serde::Serialize)]
pub struct ModelList {
    pub provider: String,
    pub models: Vec<String>,
    pub default_model: String,
}

#[tauri::command]
pub fn list_models(provider: String) -> Result<ModelList, String> {
    let p = Provider::parse(&provider)
        .ok_or_else(|| format!("unknown provider '{}'", provider))?;
    Ok(ModelList {
        provider: p.slug().to_string(),
        models: p.models().iter().map(|s| s.to_string()).collect(),
        default_model: p.default_model().to_string(),
    })
}

// ──────────────────────────── Chat window ────────────────────────────────────

/// Open (or focus) the dedicated chat window, optionally pre-seeding it with
/// a message from the daemon / reminder engine or a first assistant intro.
#[tauri::command]
pub fn open_chat_window(
    app: AppHandle,
    seed: Option<String>,
    intro: Option<String>,
) -> Result<(), String> {
    match (seed, intro) {
        (Some(msg), _) => windows::show_chat_with_seed(&app, &msg).map_err(|e| e.to_string()),
        (None, Some(msg)) => windows::show_chat_with_intro(&app, &msg).map_err(|e| e.to_string()),
        (None, None) => windows::show_chat(&app).map_err(|e| e.to_string()),
    }
}

/// Send a multi-turn conversation to the LLM and stream tokens back via
/// `twin://cw-token` / `twin://cw-done` events.
#[tauri::command]
pub async fn send_chat_window(
    app: AppHandle,
    shared: State<'_, SharedState>,
    messages: Vec<ChatWindowMessage>,
) -> Result<(), String> {
    let state = shared.get();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = chat::stream_chat_window(app, messages, state).await {
            eprintln!("[twin] cw stream error: {err:?}");
        }
    });
    Ok(())
}

/// Persist a completed chat session to `~/.claude/twin/chat/<session_id>.jsonl`.
#[tauri::command]
pub fn save_chat_session(session_id: String, turns: Vec<ChatTurn>) -> Result<(), String> {
    let dir = chat_history_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join(format!("{session_id}.jsonl"));
    let mut buf = String::new();
    for turn in &turns {
        let line = serde_json::to_string(turn).map_err(|e| e.to_string())?;
        buf.push_str(&line);
        buf.push('\n');
    }
    fs::write(&path, buf).map_err(|e| e.to_string())?;
    Ok(())
}

// ──────────────────────────── Brain vault writes ──────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteNoteResult {
    pub path: String,
}

/// Write a markdown note to the configured brain/Obsidian vault.
/// Saved to `<vault>/from-twin/YYYY-MM-DD/<slug>.md`.
#[tauri::command]
pub fn write_vault_note(
    title: String,
    body: String,
    folder: Option<String>,
) -> Result<WriteNoteResult, String> {
    use chrono::Local;

    let vault_root = resolve_vault_root().ok_or("no vault configured — set a vault path in onboarding".to_string())?;

    let subfolder = folder.as_deref().unwrap_or("from-twin");
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let dir = vault_root.join(subfolder).join(&date_str);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "note".to_string() } else { slug };
    let filename = format!("{slug}.md");
    let path = dir.join(&filename);

    let content = format!(
        "---\ntitle: \"{title}\"\ndate: {date_str}\ntype: Note\nsource: twin-chat\n---\n\n{body}\n"
    );
    fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(WriteNoteResult {
        path: path.display().to_string(),
    })
}

/// Append a mood check-in to `<brainPath>/moods/YYYY-MM-DD-HHmm.md`.
#[tauri::command]
pub fn log_mood_entry(mood: String, note: Option<String>) -> Result<(), String> {
    use chrono::Local;

    let vault_root = resolve_vault_root().ok_or("no vault configured".to_string())?;
    let dir = vault_root.join("moods");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ts = Local::now().format("%Y-%m-%d-%H%M").to_string();
    let path = dir.join(format!("{ts}.md"));

    let note_text = note.as_deref().unwrap_or("");
    let content = format!(
        "---\ntype: Mood\ndate: {ts}\nmood: {mood}\n---\n\n{note_text}\n"
    );
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn resolve_vault_root() -> Option<PathBuf> {
    let cfg_path = claude_dir().join("twin.config.json");
    let bytes = fs::read(&cfg_path).ok()?;
    let cfg: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    for key in &["brainPath", "obsidianVaultPath"] {
        if let Some(raw) = cfg[key].as_str().filter(|s| !s.is_empty()) {
            let p = expand_tilde(raw);
            let pb = PathBuf::from(p);
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    None
}

fn expand_tilde(input: &str) -> String {
    if let Some(rest) = input.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    input.to_string()
}

// ──────────────────────────── Image generation ───────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenResult {
    pub ok: bool,
    pub saved_path: Option<String>,
    pub provider_used: Option<String>,
    pub error: Option<String>,
    pub prompt: String,
}

/// Generate an image from a text prompt and save it to the media folder.
/// Returns the path so the frontend can load it via convertFileSrc().
#[tauri::command]
pub async fn generate_image(prompt: String) -> Result<ImageGenResult, String> {
    match image_gen::generate(&prompt).await {
        Ok(result) => Ok(ImageGenResult {
            ok: true,
            saved_path: Some(result.saved_path),
            provider_used: Some(result.provider_used),
            error: None,
            prompt,
        }),
        Err(err) => Ok(ImageGenResult {
            ok: false,
            saved_path: None,
            provider_used: None,
            error: Some(err.to_string()),
            prompt,
        }),
    }
}

/// Force one evolutionary sprite pass (same prompt pipeline as state-change).
#[tauri::command]
pub async fn regenerate_sprite(app: AppHandle) -> Result<String, String> {
    crate::sprite::regenerate(&app)
        .await
        .map_err(|e| e.to_string())
}

/// Onboarding: generate a one-off preview sprite (no evolution meta / rate limit).
#[tauri::command]
pub async fn generate_sprite_preview(prompt: String) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("describe your creature first".to_string());
    }
    let (prov, _) = credentials::active_provider_and_model();
    match prov {
        Provider::Openai | Provider::Gemini if !rembg::is_available() => {
            return Err(rembg::rembg_install_hint_err());
        }
        _ => {}
    }
    let full = crate::sprite::build_preview_prompt(p);
    let img = image_gen::render_evolutionary_sprite(&full)
        .await
        .map_err(|e| e.to_string())?;
    Ok(img.saved_path)
}

#[tauri::command]
pub async fn generate_sprite_preview_from_photo(
    prompt: String,
    photo_path: String,
) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("describe how to transform the photo into a sprite first".to_string());
    }
    if !rembg::is_available() {
        return Err(rembg::rembg_install_hint_err());
    }
    let img = image_gen::render_sprite_from_photo(p, photo_path.trim())
        .await
        .map_err(|e| e.to_string())?;
    Ok(img.saved_path)
}

#[tauri::command]
pub async fn generate_chat_background(prompt: String) -> Result<image_gen::ImageResult, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("describe the chat background first".to_string());
    }
    image_gen::render_chat_background(p)
        .await
        .map_err(|e| e.to_string())
}

