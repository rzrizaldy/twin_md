//! Image generation — OpenAI, Gemini, Anthropic (SVG) + sprite evolution routes.
//! Raster outputs are piped through `rembg` for background removal.

use anyhow::{anyhow, Result};
use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;

use crate::credentials::{active_provider_and_model, resolve_api_key};
use crate::provider::Provider;
use crate::rembg;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageResult {
    pub saved_path: String,
    pub provider_used: String,
    pub prompt: String,
}

/// Chat `/image` — follow active provider; OpenAI / Gemini only (raster → rembg).
pub async fn generate(prompt: &str) -> Result<ImageResult> {
    let (prov, _model) = active_provider_and_model();
    let key = resolve_api_key(prov)
        .ok_or_else(|| anyhow!("no API key for {} — add one in settings", prov.slug()))?;
    match prov {
        Provider::Openai => {
            if let Ok(r) = generate_openai_gpt_image(&key, prompt).await {
                return finalize_raster_media(r, prompt, "openai/gpt-image-1").await;
            }
            let r = generate_openai_dalle3(&key, prompt).await?;
            finalize_raster_media(r, prompt, "openai/dall-e-3").await
        }
        Provider::Gemini => {
            let bytes = generate_gemini_bytes(&key, prompt).await?;
            let processed = rembg::strip_bg(bytes)
                .await
                .map_err(|e| anyhow!(e))?;
            let path = save_bytes_media(&processed, "gemini", prompt, "png")?;
            Ok(ImageResult {
                saved_path: path.display().to_string(),
                provider_used: "gemini/imagen-3+rembg".to_string(),
                prompt: prompt.to_string(),
            })
        }
        Provider::Anthropic => Err(anyhow!(
            "/image with Anthropic: add an OpenAI or Google key in settings for /image, or use sprite evolution (Claude can output SVG for sprites)"
        )),
    }
}

/// Evolutionary sprite: active provider; PNG routes go through rembg, Claude outputs SVG.
pub async fn render_evolutionary_sprite(prompt: &str) -> Result<ImageResult> {
    let (prov, model) = active_provider_and_model();
    let key = resolve_api_key(prov)
        .ok_or_else(|| anyhow!("no API key for {} — add one in settings", prov.slug()))?;
    match prov {
        Provider::Openai => {
            if let Ok(r) = generate_openai_gpt_image(&key, prompt).await {
                return save_as_sprite_png(r, prompt, "openai/gpt-image-1").await;
            }
            let r = generate_openai_dalle3(&key, prompt).await?;
            save_as_sprite_png(r, prompt, "openai/dall-e-3").await
        }
        Provider::Gemini => {
            let bytes = generate_gemini_bytes(&key, prompt).await?;
            let processed = rembg::strip_bg(bytes)
                .await
                .map_err(|e| anyhow!(e))?;
            let path = save_bytes_sprite(&processed, "gemini", prompt, "png")?;
            Ok(ImageResult {
                saved_path: path.display().to_string(),
                provider_used: "gemini/imagen-3+rembg".to_string(),
                prompt: prompt.to_string(),
            })
        }
        Provider::Anthropic => {
            let system = "You output exactly one valid SVG document for a chibi game sprite. \
No markdown fences. No prose. The outer element must be <svg viewBox=\\\"0 0 512 512\\\" xmlns=\\\"http://www.w3.org/2000/svg\\\">. \
No rectangle covering the full viewBox. Background must be transparent. \
Use a limited friendly palette, thick outlines, cute proportions.";
            let text = crate::provider::complete_anthropic(&model, &key, system, prompt).await?;
            let svg = extract_svg(&text)
                .ok_or_else(|| anyhow!("model did not return a parseable <svg> block"))?;
            let path = save_svg_sprite(&svg, prompt)?;
            Ok(ImageResult {
                saved_path: path.display().to_string(),
                provider_used: "anthropic/claude-svg".to_string(),
                prompt: prompt.to_string(),
            })
        }
    }
}

/// Chat background wallpaper: keep the whole scene, do not remove background.
pub async fn render_chat_background(prompt: &str) -> Result<ImageResult> {
    let (prov, _model) = active_provider_and_model();
    let key = resolve_api_key(prov)
        .ok_or_else(|| anyhow!("no API key for {} — add one in settings", prov.slug()))?;
    let full = format!(
        "{prompt}. Cozy illustrated wallpaper for a desktop pet chat window, atmospheric room or landscape, no text, no UI, no characters in foreground, soft readable center area."
    );
    match prov {
        Provider::Openai => {
            if let Ok(r) = generate_openai_gpt_image(&key, &full).await {
                return Ok(ImageResult { prompt: prompt.to_string(), ..r });
            }
            let r = generate_openai_dalle3(&key, &full).await?;
            Ok(ImageResult { prompt: prompt.to_string(), ..r })
        }
        Provider::Gemini => {
            let bytes = generate_gemini_bytes(&key, &full).await?;
            let path = save_bytes_media(&bytes, "gemini-background", prompt, "png")?;
            Ok(ImageResult {
                saved_path: path.display().to_string(),
                provider_used: "gemini/imagen-3".to_string(),
                prompt: prompt.to_string(),
            })
        }
        Provider::Anthropic => Err(anyhow!(
            "background generation needs OpenAI or Google image generation; switch provider in settings"
        )),
    }
}

/// Image-to-image sprite: read an uploaded photo and restyle it into a pet sprite.
pub async fn render_sprite_from_photo(prompt: &str, photo_path: &str) -> Result<ImageResult> {
    let (prov, _) = active_provider_and_model();
    if prov != Provider::Openai {
        return Err(anyhow!(
            "photo-to-sprite currently needs OpenAI gpt-image-1; switch provider in settings"
        ));
    }
    let key = resolve_api_key(prov)
        .ok_or_else(|| anyhow!("no API key for {} — add one in settings", prov.slug()))?;
    let bytes = generate_openai_image_edit(&key, prompt, photo_path).await?;
    let processed = rembg::strip_bg(bytes).await.map_err(|e| anyhow!(e))?;
    let path = save_bytes_sprite(&processed, "photo-sprite", prompt, "png")?;
    Ok(ImageResult {
        saved_path: path.display().to_string(),
        provider_used: "openai/gpt-image-1-edit+rembg".to_string(),
        prompt: prompt.to_string(),
    })
}

async fn finalize_raster_media(
    r: ImageResult,
    prompt: &str,
    prov: &str,
) -> Result<ImageResult> {
    let src = PathBuf::from(&r.saved_path);
    let bytes = std::fs::read(&src).map_err(|e| anyhow!("read temp image: {e}"))?;
    let processed = rembg::strip_bg(bytes).await.map_err(|e| anyhow!(e))?;
    let _ = std::fs::remove_file(&src);
    let path = save_bytes_media(&processed, "openai", prompt, "png")?;
    Ok(ImageResult {
        saved_path: path.display().to_string(),
        provider_used: format!("{prov}+rembg"),
        prompt: prompt.to_string(),
    })
}

async fn save_as_sprite_png(r: ImageResult, prompt: &str, prov: &str) -> Result<ImageResult> {
    let src = PathBuf::from(&r.saved_path);
    let bytes = std::fs::read(&src).map_err(|e| anyhow!("read temp image: {e}"))?;
    let out = rembg::strip_bg(bytes).await.map_err(|e| anyhow!(e))?;
    let p = save_bytes_sprite(&out, "sprite", prompt, "png")?;
    let _ = std::fs::remove_file(&src);
    Ok(ImageResult {
        saved_path: p.display().to_string(),
        provider_used: format!("{prov}+rembg"),
        prompt: prompt.to_string(),
    })
}

async fn generate_openai_gpt_image(api_key: &str, prompt: &str) -> Result<ImageResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let body = serde_json::json!({
        "model": "gpt-image-1",
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024",
        "background": "opaque"
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
        let t = res.text().await.unwrap_or_default();
        return Err(anyhow!("openai gpt-image-1 {status}: {t}"));
    }
    let json: serde_json::Value = res.json().await?;
    if let Some(b) = json["data"][0]["b64_json"].as_str() {
        let bytes = base64::engine::general_purpose::STANDARD.decode(b)?;
        let path = save_bytes_media(&bytes, "openai", prompt, "png")?;
        return Ok(ImageResult {
            saved_path: path.display().to_string(),
            provider_used: "openai/gpt-image-1".to_string(),
            prompt: prompt.to_string(),
        });
    }
    if let Some(url) = json["data"][0]["url"].as_str() {
        let img_bytes = client.get(url).send().await?.bytes().await?;
        let path = save_bytes_media(&img_bytes, "openai", prompt, "png")?;
        return Ok(ImageResult {
            saved_path: path.display().to_string(),
            provider_used: "openai/gpt-image-1".to_string(),
            prompt: prompt.to_string(),
        });
    }
    Err(anyhow!("no b64 or url in gpt-image-1 response"))
}

async fn generate_openai_image_edit(api_key: &str, prompt: &str, photo_path: &str) -> Result<Vec<u8>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let full = format!(
        "Use the uploaded photo only as identity/reference. Generate a single full-body chibi desktop companion sprite based on it. {prompt}. Clean solid white or pastel background, no text, no frame, thick friendly outlines, readable at 32x32."
    );
    let image_part = reqwest::multipart::Part::bytes(std::fs::read(photo_path)?)
        .file_name(
            std::path::Path::new(photo_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("reference.png")
                .to_string(),
        );
    let form = reqwest::multipart::Form::new()
        .text("model", "gpt-image-1")
        .text("prompt", full)
        .text("size", "1024x1024")
        .part("image", image_part);
    let res = client
        .post("https://api.openai.com/v1/images/edits")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await?;
    if !res.status().is_success() {
        let status = res.status();
        let t = res.text().await.unwrap_or_default();
        return Err(anyhow!("openai image edit {status}: {t}"));
    }
    let json: serde_json::Value = res.json().await?;
    if let Some(b) = json["data"][0]["b64_json"].as_str() {
        return Ok(base64::engine::general_purpose::STANDARD.decode(b)?);
    }
    if let Some(url) = json["data"][0]["url"].as_str() {
        return Ok(client.get(url).send().await?.bytes().await?.to_vec());
    }
    Err(anyhow!("no b64 or url in image edit response"))
}

async fn generate_openai_dalle3(api_key: &str, prompt: &str) -> Result<ImageResult> {
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
        let t = res.text().await.unwrap_or_default();
        return Err(anyhow!("openai dalle-3 {status}: {t}"));
    }
    let json: serde_json::Value = res.json().await?;
    let url = json["data"][0]["url"]
        .as_str()
        .ok_or_else(|| anyhow!("no image url in openai response"))?;
    let img_bytes = client.get(url).send().await?.bytes().await?;
    let path = save_bytes_media(&img_bytes, "openai", prompt, "png")?;
    Ok(ImageResult {
        saved_path: path.display().to_string(),
        provider_used: "openai/dall-e-3".to_string(),
        prompt: prompt.to_string(),
    })
}

async fn generate_gemini_bytes(api_key: &str, prompt: &str) -> Result<Vec<u8>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()?;
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key={}",
        urlencoding::encode(api_key)
    );
    let p = format!("{prompt} — isolated subject on flat white or pastel background, no frame, full body, centered, single character");
    let body = serde_json::json!({
        "instances": [{ "prompt": p }],
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
        let t = res.text().await.unwrap_or_default();
        return Err(anyhow!("gemini imagen {status}: {t}"));
    }
    let json: serde_json::Value = res.json().await?;
    let b64 = json["predictions"][0]["bytesBase64Encoded"]
        .as_str()
        .ok_or_else(|| anyhow!("no image data in gemini response"))?;
    Ok(base64::engine::general_purpose::STANDARD.decode(b64)?)
}

fn extract_svg(s: &str) -> Option<String> {
    let t = s.trim();
    if let Some(i) = t.find("<svg") {
        if let Some(j) = t[i..].find("</svg>") {
            let svg = t[i..i + j + 6].to_string();
            let lower = svg.to_ascii_lowercase();
            if lower.contains("<svg")
                && lower.contains("</svg>")
                && lower.contains("viewbox")
                && !lower.contains("<script")
            {
                return Some(svg);
            }
        }
    }
    None
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

fn sprites_dir() -> PathBuf {
    let p = crate::paths::claude_dir().join("twin").join("sprites");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn save_bytes_media(bytes: &[u8], source: &str, prompt: &str, ext: &str) -> Result<PathBuf> {
    use chrono::Local;
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let slug = slug_prompt(prompt);
    let dir = media_dir().join(&date_str);
    std::fs::create_dir_all(&dir).map_err(|e| anyhow!("create media dir: {e}"))?;
    let path = dir.join(format!("{source}-{slug}.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| anyhow!("write image: {e}"))?;
    Ok(path)
}

fn save_bytes_sprite(bytes: &[u8], source: &str, prompt: &str, ext: &str) -> Result<PathBuf> {
    use chrono::Local;
    let ts = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let slug = slug_prompt(prompt);
    let dir = sprites_dir();
    let path = dir.join(format!("{ts}-{source}-{slug}.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| anyhow!("write sprite: {e}"))?;
    Ok(path)
}

fn save_svg_sprite(svg: &str, prompt: &str) -> Result<PathBuf> {
    use chrono::Local;
    let ts = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let slug = slug_prompt(prompt);
    let path = sprites_dir().join(format!("{ts}-claude-{slug}.svg"));
    std::fs::write(&path, svg.as_bytes()).map_err(|e| anyhow!("write svg: {e}"))?;
    Ok(path)
}

fn slug_prompt(prompt: &str) -> String {
    let s: String = prompt
        .chars()
        .take(36)
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    s.trim_matches('-').to_string()
}

fn expand_tilde(input: &str) -> String {
    if let Some(rest) = input.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    input.to_string()
}
