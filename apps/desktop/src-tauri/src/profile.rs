use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::model::PetState;
use crate::paths::{claude_dir, twin_config_path};

const PROFILE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultProfile {
    pub schema_version: u32,
    pub updated_at: String,
    pub owner: Option<String>,
    pub species: Option<String>,
    pub vault_path: Option<String>,
    pub quick_notes_path: Option<String>,
    pub sprite_evolution: Option<Value>,
    #[serde(default)]
    pub permissions: VaultProfilePermissions,
    #[serde(default)]
    pub ui: VaultProfileUi,
    #[serde(default)]
    pub session: VaultProfileSession,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultProfilePermissions {
    pub approved_action_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultProfileUi {
    pub chat_background: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultProfileSession {
    pub last_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultProfileStatus {
    pub can_load: bool,
    pub vault_path: Option<String>,
    pub profile_path: Option<String>,
    pub owner: Option<String>,
    pub updated_at: Option<String>,
    pub quick_notes_path: Option<String>,
    pub sprite_prompt: Option<String>,
    pub chat_background: Option<Value>,
    pub approved_action_capabilities: Vec<String>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn expand_tilde(input: &str) -> String {
    if let Some(rest) = input.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    input.to_string()
}

pub fn resolve_vault_root() -> Option<PathBuf> {
    let bytes = fs::read(twin_config_path()).ok()?;
    let cfg: Value = serde_json::from_slice(&bytes).ok()?;
    for key in &["obsidianVaultPath", "brainPath"] {
        if let Some(raw) = cfg[key].as_str().filter(|s| !s.is_empty()) {
            let pb = PathBuf::from(expand_tilde(raw));
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    None
}

pub fn profile_dir(vault_root: &Path) -> PathBuf {
    vault_root.join(".twin-md")
}

pub fn profile_path(vault_root: &Path) -> PathBuf {
    profile_dir(vault_root).join("profile.json")
}

pub fn read_profile_from(vault_root: &Path) -> Result<Option<VaultProfile>, String> {
    let path = profile_path(vault_root);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mut profile: VaultProfile = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if profile.schema_version == 0 {
        profile.schema_version = PROFILE_VERSION;
    }
    Ok(Some(profile))
}

pub fn write_profile_to(vault_root: &Path, profile: &VaultProfile) -> Result<PathBuf, String> {
    let dir = profile_dir(vault_root);
    fs::create_dir_all(dir.join("sessions")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("media")).map_err(|e| e.to_string())?;
    let readme = dir.join("README.md");
    if !readme.exists() {
        fs::write(
            &readme,
            "# twin.md profile\n\nThis folder stores non-secret twin.md session state that is safe to sync with your Obsidian vault. API keys and credentials stay local-only.\n",
        )
        .map_err(|e| e.to_string())?;
    }
    let path = profile_path(vault_root);
    fs::write(
        &path,
        serde_json::to_vec_pretty(profile).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(path)
}

fn config_value() -> Value {
    match fs::read(twin_config_path()) {
        Ok(bytes) if !bytes.is_empty() => serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({})),
        _ => json!({}),
    }
}

fn profile_from_config(vault_root: &Path, existing: Option<VaultProfile>) -> VaultProfile {
    let cfg = config_value();
    let mut profile = existing.unwrap_or_default();
    profile.schema_version = PROFILE_VERSION;
    profile.updated_at = now();
    profile.vault_path = Some(vault_root.display().to_string());
    profile.owner = cfg
        .get("owner")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(profile.owner);
    profile.species = cfg
        .get("species")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(profile.species);
    profile.quick_notes_path = cfg
        .get("quickNotesPath")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(profile.quick_notes_path);
    profile.sprite_evolution = cfg.get("spriteEvolution").cloned().or(profile.sprite_evolution);
    profile
}

pub fn save_profile_from_config() -> Result<Option<PathBuf>, String> {
    let Some(vault_root) = resolve_vault_root() else {
        return Ok(None);
    };
    let existing = read_profile_from(&vault_root)?;
    let profile = profile_from_config(&vault_root, existing);
    write_profile_to(&vault_root, &profile).map(Some)
}

pub fn update_profile<F>(mutator: F) -> Result<Option<VaultProfile>, String>
where
    F: FnOnce(&mut VaultProfile),
{
    let Some(vault_root) = resolve_vault_root() else {
        return Ok(None);
    };
    let existing = read_profile_from(&vault_root)?;
    let mut profile = profile_from_config(&vault_root, existing);
    mutator(&mut profile);
    profile.updated_at = now();
    write_profile_to(&vault_root, &profile)?;
    Ok(Some(profile))
}

fn normalize_capability(capability: &str) -> Option<String> {
    let cleaned = capability.trim().to_ascii_lowercase();
    if cleaned.is_empty() {
        return None;
    }
    match cleaned.as_str() {
        "playwright" | "spotify" | "reminders" | "calendar" | "mail" | "notes" | "desktop" => Some(cleaned),
        _ => None,
    }
}

pub fn approved_action_capabilities() -> Vec<String> {
    let Some(vault_root) = resolve_vault_root() else {
        return Vec::new();
    };
    read_profile_from(&vault_root)
        .ok()
        .flatten()
        .map(|profile| profile.permissions.approved_action_capabilities)
        .unwrap_or_default()
}

pub fn is_action_capability_approved(capability: &str) -> bool {
    let Some(capability) = normalize_capability(capability) else {
        return false;
    };
    approved_action_capabilities()
        .into_iter()
        .any(|approved| approved == capability)
}

pub fn approve_action_capability(capability: &str) -> Result<(), String> {
    let Some(capability) = normalize_capability(capability) else {
        return Ok(());
    };
    update_profile(|profile| {
        if !profile
            .permissions
            .approved_action_capabilities
            .iter()
            .any(|approved| approved == &capability)
        {
            profile.permissions.approved_action_capabilities.push(capability);
            profile.permissions.approved_action_capabilities.sort();
        }
    })?;
    Ok(())
}

pub fn write_session_copy(session_id: &str, content: &str) -> Result<Option<PathBuf>, String> {
    let Some(vault_root) = resolve_vault_root() else {
        return Ok(None);
    };
    let dir = profile_dir(&vault_root).join("sessions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{session_id}.jsonl"));
    fs::write(&path, content).map_err(|e| e.to_string())?;
    let latest = dir.join("latest.json");
    fs::write(
        latest,
        serde_json::to_vec_pretty(&json!({
            "lastSessionId": session_id,
            "path": path.display().to_string(),
            "updatedAt": now()
        }))
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    update_profile(|profile| {
        profile.session.last_session_id = Some(session_id.to_string());
    })?;
    Ok(Some(path))
}

pub fn delete_vault_profile() -> Result<bool, String> {
    let Some(vault_root) = resolve_vault_root() else {
        return Ok(false);
    };
    let dir = profile_dir(&vault_root);
    if !dir.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn status() -> VaultProfileStatus {
    let Some(vault_root) = resolve_vault_root() else {
        return VaultProfileStatus {
            can_load: false,
            vault_path: None,
            profile_path: None,
            owner: None,
            updated_at: None,
            quick_notes_path: None,
            sprite_prompt: None,
            chat_background: None,
            approved_action_capabilities: Vec::new(),
        };
    };
    let path = profile_path(&vault_root);
    let profile = read_profile_from(&vault_root).ok().flatten();
    let sprite_prompt = profile
        .as_ref()
        .and_then(|p| p.sprite_evolution.as_ref())
        .and_then(|v| v.get("customPrompt"))
        .and_then(Value::as_str)
        .map(str::to_string);
    VaultProfileStatus {
        can_load: profile.is_some(),
        vault_path: Some(vault_root.display().to_string()),
        profile_path: Some(path.display().to_string()),
        owner: profile.as_ref().and_then(|p| p.owner.clone()),
        updated_at: profile.as_ref().map(|p| p.updated_at.clone()),
        quick_notes_path: profile.as_ref().and_then(|p| p.quick_notes_path.clone()),
        sprite_prompt,
        chat_background: profile.as_ref().and_then(|p| p.ui.chat_background.clone()),
        approved_action_capabilities: profile
            .map(|p| p.permissions.approved_action_capabilities)
            .unwrap_or_default(),
    }
}

pub fn apply_profile_to_config(profile: &VaultProfile) -> Result<(), String> {
    let cfg_path = twin_config_path();
    fs::create_dir_all(claude_dir()).map_err(|e| e.to_string())?;
    let mut cfg = config_value();
    if !cfg.is_object() {
        cfg = json!({});
    }
    let obj = cfg
        .as_object_mut()
        .ok_or_else(|| "expected config JSON object".to_string())?;
    if let Some(owner) = profile.owner.as_ref().filter(|s| !s.is_empty()) {
        obj.insert("owner".to_string(), json!(owner));
    }
    if let Some(species) = profile.species.as_ref().filter(|s| !s.is_empty()) {
        obj.insert("species".to_string(), json!(species));
    }
    if let Some(vault) = profile.vault_path.as_ref().filter(|s| !s.is_empty()) {
        obj.insert("obsidianVaultPath".to_string(), json!(vault));
    }
    if let Some(path) = profile.quick_notes_path.as_ref().filter(|s| !s.is_empty()) {
        obj.insert("quickNotesPath".to_string(), json!(path));
    }
    if let Some(sprite) = profile.sprite_evolution.clone() {
        obj.insert("spriteEvolution".to_string(), sprite);
    }
    fs::write(
        cfg_path,
        serde_json::to_vec_pretty(&cfg).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub fn sync_state_hint(state: &PetState) {
    let _ = update_profile(|profile| {
        profile.species = Some(match &state.species {
            crate::model::Species::Axolotl => "axolotl",
            crate::model::Species::Cat => "cat",
            crate::model::Species::Slime => "slime",
        }
        .to_string());
    });
}
