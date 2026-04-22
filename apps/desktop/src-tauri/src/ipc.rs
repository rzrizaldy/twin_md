use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

use crate::chat;
use crate::harvest;
use crate::model::PetState;
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
}

#[tauri::command]
pub fn get_chat_status() -> ChatStatus {
    let ctx = crate::context::gather();
    ChatStatus {
        has_api_key: chat::has_api_key(),
        vault_path: ctx.vault_path.map(|p| p.display().to_string()),
        notes_available: ctx.notes.len(),
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
pub async fn open_chat(app: AppHandle) -> Result<(), String> {
    windows::open_chat_window(&app).map_err(|e| e.to_string())
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
