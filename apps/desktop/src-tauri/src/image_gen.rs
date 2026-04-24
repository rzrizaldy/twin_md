//! Image generation — OpenAI, Gemini, Anthropic (SVG) + sprite evolution routes.

use anyhow::{anyhow, Result};
use base64::Engine;
use image::{codecs::png::PngEncoder, ExtendedColorType, Rgba, RgbaImage};
use image::ImageEncoder;
use serde::Serialize;
use std::path::PathBuf;

use crate::credentials::{active_provider_and_model, resolve_api_key};
use crate::provider::Provider;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageResult {
    pub saved_path: String,
    pub provider_used: String,
    pub prompt: String,
}

/// Chat `/image` — follow active provider; OpenAI / Gemini only.
pub async fn generate(prompt: &str) -> Result<ImageResult> {
    let (prov, _model) = active_provider_and_model();
    let key = resolve_api_key(prov)
        .ok_or_else(|| anyhow!("no API key for {} — add one in settings", prov.slug()))?;
    match prov {
        Provider::Openai => {
            if let Ok(r) = generate_openai_gpt_image(&key, prompt).await {
                return Ok(r);
            }
            generate_openai_dalle3(&key, prompt).await
        }
        Provider::Gemini => {
            let bytes = generate_gemini_bytes(&key, prompt).await?;
            let processed = white_to_transparent(&bytes).unwrap_or(bytes);
            let path = save_bytes_media(&processed, "gemini", prompt, "png")?;
            Ok(ImageResult {
                saved_path: path.display().to_string(),
                provider_used: "gemini/imagen-3".to_string(),
                prompt: prompt.to_string(),
            })
        }
        Provider::Anthropic => Err(anyhow!(
            "/image with Anthropic: add an OpenAI or Google key in settings for photoreal /image, or use sprite evolution (Claude generates SVG for your companion automatically)"
        )),
    }
}

/// Evolutionary sprite: uses active provider (OpenAI transparent PNG, Gemini+matte, or Claude SVG).
pub async fn render_evolutionary_sprite(prompt: &str) -> Result<ImageResult> {
    let (prov, model) = active_provider_and_model();
    let key = resolve_api_key(prov)
        .ok_or_else(|| anyhow!("no API key for {} — add one in settings", prov.slug()))?;
    match prov {
        Provider::Openai => {
            if let Ok(r) = generate_openai_gpt_image(&key, prompt).await {
                return save_as_sprite(r, prompt, "openai/gpt-image-1");
            }
            let r = generate_openai_dalle3(&key, prompt).await?;
            save_as_sprite(r, prompt, "openai/dall-e-3")
        }
        Provider::Gemini => {
            let bytes = generate_gemini_bytes(&key, prompt).await?;
            let processed = white_to_transparent(&bytes).unwrap_or(bytes);
            let path = save_bytes_sprite(&processed, "gemini", prompt, "png")?;
            Ok(ImageResult {
                saved_path: path.display().to_string(),
                provider_used: "gemini/imagen-3".to_string(),
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

fn save_as_sprite(r: ImageResult, prompt: &str, prov: &str) -> Result<ImageResult> {
    let src = PathBuf::from(&r.saved_path);
    let bytes = std::fs::read(&src).map_err(|e| anyhow!("read temp image: {e}"))?;
    let out = if prov.contains("dall") {
        white_to_transparent(&bytes).unwrap_or(bytes)
    } else {
        bytes
    };
    let p = save_bytes_sprite(&out, "sprite", prompt, "png")?;
    let _ = std::fs::remove_file(&src);
    Ok(ImageResult {
        saved_path: p.display().to_string(),
        provider_used: prov.to_string(),
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
        "background": "transparent"
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
    let p = format!("{prompt} — isolated subject on flat white background, no frame, full body, centered");
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

/// Near-white → transparent; cheap matte key for sprites.
fn white_to_transparent(png: &[u8]) -> Result<Vec<u8>> {
    let img = image::load_from_memory(png)
        .map_err(|e| anyhow!("decode png: {e}"))?
        .to_rgba8();
    let (w, h) = (img.width(), img.height());
    let mut out = RgbaImage::new(w, h);
    for (x, y, p) in img.enumerate_pixels() {
        let [r, g, b, a] = p.0;
        let a2 = if r >= 243 && g >= 243 && b >= 243 { 0 } else { a };
        out.put_pixel(x, y, Rgba([r, g, b, a2]));
    }
    let mut buf = Vec::new();
    PngEncoder::new(&mut buf)
        .write_image(out.as_raw(), w, h, ExtendedColorType::Rgba8)
        .map_err(|e| anyhow!("encode png: {e}"))?;
    Ok(buf)
}

fn extract_svg(s: &str) -> Option<String> {
    let t = s.trim();
    if let Some(i) = t.find("<svg") {
        if let Some(j) = t[i..].find("</svg>") {
            return Some(t[i..i + j + 6].to_string());
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
