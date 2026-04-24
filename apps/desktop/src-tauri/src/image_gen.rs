//! Image generation — OpenAI DALL-E 3 (primary) or Gemini Imagen 3 (fallback).
//!
//! Uses whichever API key is available. Images are saved to the brain vault
//! media folder (or ~/.claude/twin/media/ if no vault is configured).

use anyhow::{anyhow, Result};
use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;

use crate::credentials::resolve_api_key;
use crate::provider::Provider;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageResult {
    /// Absolute path to the saved PNG on disk.
    pub saved_path: String,
    /// e.g. "openai/dall-e-3" or "gemini/imagen-3"
    pub provider_used: String,
    pub prompt: String,
}

/// Generate an image. Tries OpenAI first, then Gemini.
pub async fn generate(prompt: &str) -> Result<ImageResult> {
    if let Some(key) = resolve_api_key(Provider::Openai) {
        return generate_openai(&key, prompt).await;
    }
    if let Some(key) = resolve_api_key(Provider::Gemini) {
        return generate_gemini(&key, prompt).await;
    }
    Err(anyhow!(
        "image generation needs an OpenAI or Gemini API key — open settings to add one"
    ))
}

async fn generate_openai(api_key: &str, prompt: &str) -> Result<ImageResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()?;

    let body = serde_json::json!({
        "model": "dall-e-3",
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024"
    });

    let res = client
        .post("https://api.openai.com/v1/images/generations")
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(anyhow!("openai images {status}: {text}"));
    }

    let json: serde_json::Value = res.json().await?;
    let url = json["data"][0]["url"]
        .as_str()
        .ok_or_else(|| anyhow!("no image url in openai response"))?;

    // Download the ephemeral URL into bytes immediately (URL expires in ~1 h).
    let img_bytes = client.get(url).send().await?.bytes().await?;
    let saved_path = save_image_bytes(&img_bytes, "openai", prompt)?;

    Ok(ImageResult {
        saved_path: saved_path.display().to_string(),
        provider_used: "openai/dall-e-3".to_string(),
        prompt: prompt.to_string(),
    })
}

async fn generate_gemini(api_key: &str, prompt: &str) -> Result<ImageResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()?;

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key={}",
        urlencoding::encode(api_key)
    );

    let body = serde_json::json!({
        "instances": [{ "prompt": prompt }],
        "parameters": { "sampleCount": 1 }
    });

    let res = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(anyhow!("gemini imagen {status}: {text}"));
    }

    let json: serde_json::Value = res.json().await?;
    let b64 = json["predictions"][0]["bytesBase64Encoded"]
        .as_str()
        .ok_or_else(|| anyhow!("no image data in gemini response"))?;

    let img_bytes = base64::engine::general_purpose::STANDARD.decode(b64)?;
    let saved_path = save_image_bytes(&img_bytes, "gemini", prompt)?;

    Ok(ImageResult {
        saved_path: saved_path.display().to_string(),
        provider_used: "gemini/imagen-3".to_string(),
        prompt: prompt.to_string(),
    })
}

fn save_image_bytes(bytes: &[u8], source: &str, prompt: &str) -> Result<PathBuf> {
    use chrono::Local;

    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let slug: String = prompt
        .chars()
        .take(40)
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    let dir = media_dir().join(&date_str);
    std::fs::create_dir_all(&dir)
        .map_err(|e| anyhow!("create media dir: {e}"))?;

    let filename = format!("{source}-{slug}.png");
    let path = dir.join(&filename);
    std::fs::write(&path, bytes)
        .map_err(|e| anyhow!("write image file: {e}"))?;

    Ok(path)
}

fn media_dir() -> PathBuf {
    let cfg_path = crate::paths::claude_dir().join("twin.config.json");
    if let Ok(bytes) = std::fs::read(&cfg_path) {
        if let Ok(cfg) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            for key in &["brainPath", "obsidianVaultPath"] {
                if let Some(raw) = cfg[key].as_str().filter(|s| !s.is_empty()) {
                    let p = PathBuf::from(expand_tilde(raw)).join("media");
                    if p.parent().map(|x| x.exists()).unwrap_or(false) {
                        return p;
                    }
                }
            }
        }
    }
    crate::paths::claude_dir().join("twin").join("media")
}

fn expand_tilde(input: &str) -> String {
    if let Some(rest) = input.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    input.to_string()
}
