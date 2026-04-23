use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

use crate::chat;
use crate::commands as slash_commands;
use crate::credentials;
use crate::harvest;
use crate::model::PetState;
use crate::paths::claude_dir;
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
    pub vault_path: Option<String>,
    pub notes_available: usize,
    pub provider: String,
    pub model: String,
}

#[tauri::command]
pub fn get_chat_status() -> ChatStatus {
    let ctx = crate::context::gather();
    let (provider, model) = credentials::active_provider_and_model();
    ChatStatus {
        has_api_key: chat::has_api_key(),
        vault_path: ctx.vault_path.map(|p| p.display().to_string()),
        notes_available: ctx.notes.len(),
        provider: provider.slug().to_string(),
        model,
    }
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
pub async fn open_web_companion(app: AppHandle) -> Result<(), String> {
    crate::webshell::open_web_companion(app)
        .await
        .map_err(|e| e.to_string())
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
}

#[derive(serde::Serialize)]
pub struct OnboardingResult {
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub async fn run_onboarding(
    app: AppHandle,
    payload: OnboardingPayload,
) -> Result<OnboardingResult, String> {
    let vault = payload.obsidian_vault.as_deref();

    if let Err(err) = harvest::init(&payload.species, &payload.owner, vault).await {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("init failed: {err}"),
        });
    }

    if let Err(err) = harvest::harvest().await {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("harvest failed: {err}"),
        });
    }

    if let Err(err) = windows::show_companion(&app) {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("couldn't summon companion: {err}"),
        });
    }

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
    let store = payload.store_in_keychain.unwrap_or(true);
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
