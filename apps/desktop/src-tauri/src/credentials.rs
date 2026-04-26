//! Provider credential storage.
//!
//! Resolving an API key:
//!   1. Environment variable for that provider (override).
//!   2. `twin-ai.json` — if `storage` is `keychain` | `config` | `env`, only
//!      that surface is read (avoids spurious keychain unlock prompts).
//!   3. Legacy fallbacks: keychain → config file key → `~/.claude/.env` etc.
//! In-process cache: at most one keychain read per key per app launch when
//! storage is `keychain`.

use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::paths::claude_dir;
use crate::provider::Provider;

const KEYRING_SERVICE: &str = "twin-md";

static KEY_CACHE: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Clear in-memory key cache. Call after saving or rotating credentials.
pub fn clear_credential_cache() {
    KEY_CACHE.lock().clear();
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Storage {
    Env,
    Keychain,
    Config,
}

impl Storage {
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "keychain" => Self::Keychain,
            "config" => Self::Config,
            _ => Self::Env,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: String,
    pub model: String,
    pub storage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

fn ai_config_path() -> PathBuf {
    claude_dir().join("twin-ai.json")
}

pub fn read_ai_config() -> Option<AiConfig> {
    fs::read_to_string(ai_config_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<AiConfig>(&raw).ok())
}

pub fn write_ai_config(cfg: &AiConfig) -> Result<()> {
    let path = ai_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(cfg)?;
    fs::write(&path, json).context("write twin-ai.json")?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms).ok();
    }

    Ok(())
}

fn keychain_entry(provider: Provider) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, provider.slug())
        .map_err(|e| anyhow!("keychain unavailable: {e}"))
}

pub fn save_in_keychain(provider: Provider, api_key: &str) -> Result<()> {
    keychain_entry(provider)?
        .set_password(api_key)
        .map_err(|e| anyhow!("keychain write failed: {e}"))
}

pub fn read_from_keychain(provider: Provider) -> Option<String> {
    keychain_entry(provider).ok()?.get_password().ok()
}

pub fn clear_keychain(provider: Provider) {
    if let Ok(entry) = keychain_entry(provider) {
        let _ = entry.delete_credential();
    }
}

pub fn logout_provider_session() -> Result<()> {
    if let Some(cfg) = read_ai_config() {
        if let Some(provider) = Provider::parse(&cfg.provider) {
            if Storage::parse(&cfg.storage) == Storage::Keychain {
                clear_keychain(provider);
            }
        }
    }
    let path = ai_config_path();
    if path.exists() {
        fs::remove_file(&path).context("remove twin-ai.json")?;
    }
    clear_credential_cache();
    Ok(())
}

/// Persist the onboarding/settings choice. Writes `twin-ai.json` always
/// (so we know provider + model + storage pref). The key itself goes either
/// to the keychain or inline into the file, per `store_in_keychain`.
pub fn save_credentials(
    provider: Provider,
    model: &str,
    api_key: Option<&str>,
    store_in_keychain: bool,
) -> Result<Storage> {
    let storage = match (api_key, store_in_keychain) {
        (Some(key), true) => {
            save_in_keychain(provider, key)?;
            Storage::Keychain
        }
        (Some(_), false) => Storage::Config,
        (None, _) => Storage::Env,
    };

    let cfg = AiConfig {
        provider: provider.slug().to_string(),
        model: model.to_string(),
        storage: match storage {
            Storage::Env => "env",
            Storage::Keychain => "keychain",
            Storage::Config => "config",
        }
        .to_string(),
        api_key: match storage {
            Storage::Config => api_key.map(|s| s.to_string()),
            _ => None,
        },
    };
    write_ai_config(&cfg)?;
    clear_credential_cache();
    Ok(storage)
}

fn read_dot_env_files(provider: Provider) -> Option<String> {
    if let Ok(home) = std::env::var("HOME") {
        for candidate in [
            format!("{home}/.claude/.env"),
            format!("{home}/.twin-md.env"),
        ] {
            if let Ok(contents) = fs::read_to_string(&candidate) {
                let needle = format!("{}=", provider.env_key());
                for line in contents.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    if let Some(rest) = trimmed.strip_prefix(&needle) {
                        let val = rest.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            return Some(val.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

fn resolve_api_key_uncached(provider: Provider) -> Option<String> {
    if let Ok(key) = std::env::var(provider.env_key()) {
        if !key.trim().is_empty() {
            return Some(key);
        }
    }
    if let Some(cfg) = read_ai_config() {
        if cfg.provider.eq_ignore_ascii_case(provider.slug()) {
            return match Storage::parse(&cfg.storage) {
                Storage::Keychain => read_from_keychain(provider),
                Storage::Config => cfg.api_key.filter(|k| !k.trim().is_empty()),
                Storage::Env => read_dot_env_files(provider),
            };
        }
    }
    if let Some(key) = read_from_keychain(provider) {
        if !key.trim().is_empty() {
            return Some(key);
        }
    }
    if let Some(cfg) = read_ai_config() {
        if cfg.provider.eq_ignore_ascii_case(provider.slug()) {
            if let Some(key) = cfg.api_key.filter(|k| !k.trim().is_empty()) {
                return Some(key);
            }
        }
    }
    read_dot_env_files(provider)
}

/// Look up the API key for the active provider, respecting storage preference
/// to avoid repeated keychain prompts. Results are cached in-process.
pub fn resolve_api_key(provider: Provider) -> Option<String> {
    let slug = provider.slug();
    {
        let cache = KEY_CACHE.lock();
        if let Some(k) = cache.get(slug) {
            return Some(k.clone());
        }
    }
    let resolved = resolve_api_key_uncached(provider);
    if let Some(ref k) = resolved {
        KEY_CACHE.lock().insert(slug.to_string(), k.clone());
    }
    resolved
}

/// Default-provider resolution for chat.rs. Falls back to Anthropic, matching
/// the pre-v2.1 behaviour.
pub fn active_provider_and_model() -> (Provider, String) {
    if let Some(cfg) = read_ai_config() {
        if let Some(provider) = Provider::parse(&cfg.provider) {
            return (provider, cfg.model);
        }
    }
    (
        Provider::Anthropic,
        std::env::var("TWIN_ANTHROPIC_MODEL")
            .unwrap_or_else(|_| Provider::Anthropic.default_model().to_string()),
    )
}
