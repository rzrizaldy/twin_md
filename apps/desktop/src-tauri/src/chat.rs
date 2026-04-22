//! Streaming chat. Routes through provider.rs so Anthropic / OpenAI / Gemini
//! all surface the same `twin://chat-token` events.

use anyhow::Result;
use futures::StreamExt;
use tauri::{AppHandle, Emitter};

use crate::context;
use crate::credentials::{active_provider_and_model, resolve_api_key};
use crate::model::PetState;
use crate::provider;

pub fn has_api_key() -> bool {
    let (provider, _) = active_provider_and_model();
    resolve_api_key(provider).is_some()
}

pub async fn stream(app: AppHandle, message: String, state: Option<PetState>) -> Result<()> {
    stream_with_system(app, message, state, None).await
}

/// Streams using a custom system prompt. Used by slash commands that need the
/// wellness persona (/daily, /recap, /weekahead, /reflect).
pub async fn stream_with_system(
    app: AppHandle,
    message: String,
    state: Option<PetState>,
    system_override: Option<String>,
) -> Result<()> {
    let (provider_kind, model) = active_provider_and_model();
    let Some(api_key) = resolve_api_key(provider_kind) else {
        fallback(&app, provider_kind);
        let _ = app.emit("twin://chat-done", ());
        return Ok(());
    };

    let ctx = context::gather();
    let system = match system_override {
        Some(custom) => {
            let base = context::render_prompt(&ctx);
            format!("{base}\n\n== persona ==\n{custom}\n")
        }
        None => build_system(state.as_ref(), &ctx),
    };

    match provider::stream(provider_kind, &model, &api_key, &system, &message).await {
        Ok(mut stream) => {
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(delta) if !delta.is_empty() => {
                        let _ = app.emit("twin://chat-token", delta);
                    }
                    Ok(_) => {}
                    Err(err) => {
                        eprintln!("[twin] chat stream error: {err:?}");
                        let _ = app.emit(
                            "twin://chat-token",
                            format!("\n\n_(stream error: {err})_"),
                        );
                        break;
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("[twin] chat request failed: {err:?}");
            let _ = app.emit(
                "twin://chat-token",
                format!("couldn't reach {}: {err}", provider_kind.slug()),
            );
        }
    }

    let _ = app.emit("twin://chat-done", ());
    Ok(())
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

fn fallback(app: &AppHandle, provider: provider::Provider) {
    let line = format!(
        "I can't reach {} yet — re-open onboarding to pick a provider and drop in an API key, or set {} in your shell and restart me.",
        provider.slug(),
        provider.env_key(),
    );
    let _ = app.emit("twin://chat-token", line);
}
