//! Unified streaming adapter for Anthropic / OpenAI / Gemini.
//!
//! Each provider exposes an SSE-style text stream; we normalise them into
//! plain `String` text deltas that chat.rs can relay as `twin://chat-token`.

use anyhow::{anyhow, Result};
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::pin::Pin;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";
const GEMINI_URL_TEMPLATE: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:streamGenerateContent?alt=sse&key={KEY}";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
    Gemini,
}

impl Provider {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "anthropic" | "claude" => Some(Self::Anthropic),
            "openai" | "gpt" => Some(Self::Openai),
            "gemini" | "google" => Some(Self::Gemini),
            _ => None,
        }
    }

    pub fn slug(&self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::Openai => "openai",
            Self::Gemini => "gemini",
        }
    }

    pub fn env_key(&self) -> &'static str {
        match self {
            Self::Anthropic => "ANTHROPIC_API_KEY",
            Self::Openai => "OPENAI_API_KEY",
            Self::Gemini => "GOOGLE_API_KEY",
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            Self::Anthropic => "claude-sonnet-4-6",
            Self::Openai => "gpt-5-mini",
            Self::Gemini => "gemini-2.5-flash",
        }
    }

    pub fn models(&self) -> &'static [&'static str] {
        match self {
            Self::Anthropic => &["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
            Self::Openai => &["gpt-5", "gpt-5-mini", "gpt-4.1"],
            Self::Gemini => &["gemini-2.5-pro", "gemini-2.5-flash"],
        }
    }
}

pub type TextStream = Pin<Box<dyn Stream<Item = Result<String>> + Send>>;

/// Lightweight liveness check for an API key. Hits a cheap models-list endpoint
/// (or equivalent) with a 5-second timeout. Returns `Ok(())` when the key is
/// accepted, `Err` with a human-facing message otherwise.
pub async fn validate_key(provider: Provider, api_key: &str) -> Result<()> {
    if api_key.trim().is_empty() {
        return Err(anyhow!("empty api key"));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    let response = match provider {
        Provider::Anthropic => client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .send()
            .await
            .map_err(|e| anyhow!("anthropic reachability: {e}"))?,
        Provider::Openai => client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|e| anyhow!("openai reachability: {e}"))?,
        Provider::Gemini => {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models?key={}",
                urlencoding::encode(api_key)
            );
            client
                .get(url)
                .send()
                .await
                .map_err(|e| anyhow!("gemini reachability: {e}"))?
        }
    };

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(160).collect();
        Err(anyhow!("key rejected ({status}): {snippet}"))
    }
}

pub async fn stream(
    provider: Provider,
    model: &str,
    api_key: &str,
    system: &str,
    user_message: &str,
) -> Result<TextStream> {
    match provider {
        Provider::Anthropic => stream_anthropic(model, api_key, system, user_message).await,
        Provider::Openai => stream_openai(model, api_key, system, user_message).await,
        Provider::Gemini => stream_gemini(model, api_key, system, user_message).await,
    }
}

async fn stream_anthropic(
    model: &str,
    api_key: &str,
    system: &str,
    user_message: &str,
) -> Result<TextStream> {
    let body = json!({
        "model": model,
        "max_tokens": 1200,
        "stream": true,
        "system": system,
        "messages": [{ "role": "user", "content": user_message }]
    });

    let client = reqwest::Client::new();
    let response = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("anthropic {status}: {text}"));
    }

    Ok(sse_stream(response, parse_anthropic_event))
}

async fn stream_openai(
    model: &str,
    api_key: &str,
    system: &str,
    user_message: &str,
) -> Result<TextStream> {
    let body = json!({
        "model": model,
        "stream": true,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_message }
        ]
    });

    let client = reqwest::Client::new();
    let response = client
        .post(OPENAI_URL)
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("openai {status}: {text}"));
    }

    Ok(sse_stream(response, parse_openai_event))
}

async fn stream_gemini(
    model: &str,
    api_key: &str,
    system: &str,
    user_message: &str,
) -> Result<TextStream> {
    let url = GEMINI_URL_TEMPLATE
        .replace("{MODEL}", &urlencoding::encode(model))
        .replace("{KEY}", &urlencoding::encode(api_key));

    let body = json!({
        "system_instruction": { "parts": [{ "text": system }] },
        "contents": [{ "role": "user", "parts": [{ "text": user_message }] }]
    });

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("gemini {status}: {text}"));
    }

    Ok(sse_stream(response, parse_gemini_event))
}

fn sse_stream(
    response: reqwest::Response,
    parse: fn(&str) -> Option<String>,
) -> TextStream {
    let byte_stream = response.bytes_stream();
    let stream = async_stream::try_stream! {
        let mut buffer = String::new();
        let mut byte_stream = byte_stream;
        while let Some(chunk) = byte_stream.next().await {
            let bytes = chunk?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            while let Some(pos) = buffer.find("\n\n") {
                let event: String = buffer.drain(..pos + 2).collect();
                if let Some(delta) = parse(&event) {
                    if !delta.is_empty() {
                        yield delta;
                    }
                }
            }
        }
    };
    Box::pin(stream)
}

fn parse_anthropic_event(event: &str) -> Option<String> {
    let data = event
        .lines()
        .find_map(|l| l.strip_prefix("data: "))
        .or_else(|| event.lines().find_map(|l| l.strip_prefix("data:")))?;
    if data.trim() == "[DONE]" {
        return None;
    }
    let payload: Value = serde_json::from_str(data.trim()).ok()?;
    if payload.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }
    let text = payload.get("delta")?.get("text")?.as_str()?;
    Some(text.to_string())
}

fn parse_openai_event(event: &str) -> Option<String> {
    let data = event
        .lines()
        .find_map(|l| l.strip_prefix("data: "))
        .or_else(|| event.lines().find_map(|l| l.strip_prefix("data:")))?;
    let trimmed = data.trim();
    if trimmed == "[DONE]" {
        return None;
    }
    let payload: Value = serde_json::from_str(trimmed).ok()?;
    let delta = payload
        .get("choices")?
        .as_array()?
        .first()?
        .get("delta")?
        .get("content")?
        .as_str()?;
    Some(delta.to_string())
}

fn parse_gemini_event(event: &str) -> Option<String> {
    let data = event
        .lines()
        .find_map(|l| l.strip_prefix("data: "))
        .or_else(|| event.lines().find_map(|l| l.strip_prefix("data:")))?;
    let payload: Value = serde_json::from_str(data.trim()).ok()?;
    let parts = payload
        .get("candidates")?
        .as_array()?
        .first()?
        .get("content")?
        .get("parts")?
        .as_array()?;
    let mut out = String::new();
    for part in parts {
        if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
            out.push_str(t);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}
