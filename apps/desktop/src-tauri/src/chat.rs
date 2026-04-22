//! Streaming chat. Uses the Anthropic SSE endpoint directly so we stay
//! off the Node side while chatting.

use anyhow::{anyhow, Result};
use futures::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::context;
use crate::model::PetState;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

pub fn has_api_key() -> bool {
    resolve_api_key().is_some()
}

pub async fn stream(app: AppHandle, message: String, state: Option<PetState>) -> Result<()> {
    let api_key = resolve_api_key();
    let Some(api_key) = api_key else {
        fallback(&app, &message, state.as_ref());
        let _ = app.emit("twin://chat-done", ());
        return Ok(());
    };

    let model = std::env::var("TWIN_ANTHROPIC_MODEL")
        .unwrap_or_else(|_| "claude-sonnet-4-6".to_string());

    // Medium thinking effort — room to reason over the Obsidian context
    // before replying.
    let thinking_budget: u32 = std::env::var("TWIN_THINKING_BUDGET")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8000);

    let ctx = context::gather();
    let system = build_system(state.as_ref(), &ctx);

    let body = json!({
        "model": model,
        "max_tokens": thinking_budget + 1200,
        "stream": true,
        "system": system,
        "thinking": {
            "type": "enabled",
            "budget_tokens": thinking_budget
        },
        "messages": [{ "role": "user", "content": message }]
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

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buffer.find("\n\n") {
            let event: String = buffer.drain(..pos + 2).collect();
            if let Some(delta) = parse_sse_text_delta(&event) {
                let _ = app.emit("twin://chat-token", delta);
            }
        }
    }
    let _ = app.emit("twin://chat-done", ());
    Ok(())
}

fn parse_sse_text_delta(event: &str) -> Option<String> {
    let mut data: Option<&str> = None;
    for line in event.lines() {
        if let Some(rest) = line.strip_prefix("data: ") {
            data = Some(rest);
        }
    }
    let data = data?;
    let payload: Value = serde_json::from_str(data).ok()?;
    let event_type = payload.get("type")?.as_str()?;
    if event_type != "content_block_delta" {
        return None;
    }
    let delta = payload.get("delta")?;
    let text = delta.get("text")?.as_str()?;
    Some(text.to_string())
}

fn build_system(state: Option<&PetState>, ctx: &context::ChatContext) -> String {
    let mut buf = context::render_prompt(ctx);
    if let Some(state) = state {
        buf.push_str(&format!(
            "== current scene ==\nMood: {mood:?}\nCaption: {caption}\nScene: {scene}\nLast message you delivered: {msg}\n",
            mood = state.state,
            caption = state.caption,
            scene = state.scene,
            msg = state.message
        ));
    }
    buf
}

fn fallback(app: &AppHandle, _message: &str, _state: Option<&PetState>) {
    let line = "I can't answer from Claude yet — set ANTHROPIC_API_KEY and I'll wake up.\n\nDrop the key in ~/.claude/.env like this:\n\n    ANTHROPIC_API_KEY=sk-ant-...\n\nThen restart me.";
    let _ = app.emit("twin://chat-token", line);
}

fn resolve_api_key() -> Option<String> {
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.trim().is_empty() {
            return Some(key);
        }
    }
    // ~/.claude/.env (simple KEY=VALUE format)
    if let Some(home) = std::env::var("HOME").ok() {
        for candidate in [
            format!("{home}/.claude/.env"),
            format!("{home}/.twin-md.env"),
            format!("{home}/.anthropic_api_key"),
        ] {
            if let Ok(contents) = std::fs::read_to_string(&candidate) {
                for line in contents.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    if let Some(rest) = trimmed.strip_prefix("ANTHROPIC_API_KEY=") {
                        let val = rest.trim().trim_matches('"').trim_matches('\'');
                        if !val.is_empty() {
                            return Some(val.to_string());
                        }
                    } else if !trimmed.contains('=') && trimmed.starts_with("sk-") {
                        // raw key file
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}
