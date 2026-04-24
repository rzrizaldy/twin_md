//! Evolutionary desk sprite — re-renders on mood / environment change.

use anyhow::{anyhow, Result};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::image_gen;
use crate::model::{Environment, Mood, PetState};
use crate::paths::twin_config_path;
use std::fs;

const DEFAULT_AXO: &str = "Cute chibi axolotl: pink-peach body, feathery external gills, big dark eyes, \
soft-serve line art, friendly proportions, paper-cutout style, single character only.";

fn mood_key(m: &Mood) -> &'static str {
    match m {
        Mood::Healthy => "healthy",
        Mood::SleepDeprived => "sleep_deprived",
        Mood::Stressed => "stressed",
        Mood::Neglected => "neglected",
    }
}

fn env_key(e: &Environment) -> &'static str {
    match e {
        Environment::SunnyIsland => "sunny_island",
        Environment::StarsAtNoon => "stars_at_noon",
        Environment::StormRoom => "storm_room",
        Environment::GreyNook => "grey_nook",
    }
}

fn baseline_description() -> String {
    let path = twin_config_path();
    let bytes = match fs::read(&path) {
        Ok(b) if !b.is_empty() => b,
        _ => return DEFAULT_AXO.to_string(),
    };
    let v: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(x) => x,
        _ => return DEFAULT_AXO.to_string(),
    };
    let se = v.get("spriteEvolution");
    if se.and_then(|x| x.get("kind")).and_then(|k| k.as_str()) == Some("custom") {
        if let Some(p) = se.and_then(|x| x.get("customPrompt")).and_then(|p| p.as_str()) {
            if !p.trim().is_empty() {
                return p.trim().to_string();
            }
        }
    }
    DEFAULT_AXO.to_string()
}

/// Full evolutionary prompt for the active image route.
pub fn build_evolutionary_prompt(state: &PetState) -> String {
    let base = baseline_description();
    let out_fmt = "transparent PNG, alpha channel, no background, no drop shadow, no text";
    let mood = mood_key(&state.state);
    let env = env_key(&state.environment);
    format!(
        r#"You are generating a single sprite of a persistent desktop companion.
Render: full body, centered, facing 3/4 forward, isolated — no frame, no UI, no text, no title.

Output must be: {out_fmt}

BASELINE (do not break identity across evolutions; keep the same character readable):
{base}

CURRENT STATE (subtle, small mutations only — pose, eyes, gill color, line weight, tint):
- mood: {mood}
- environment vibe: {env}
- energy: {}/100
- stress: {}/100
- caption hint: "{cap}"

Mood → visual cues (apply lightly, keep silhouette):
- healthy: upright, warm saturation, soft smile
- sleep_deprived: droopy lids, slight slouch, cool muted palette
- stressed: tense micro-pose, slightly warmer stress tint
- neglected: dimmer color, averted eye line, quieter posture
"#,
        state.energy,
        state.stress,
        cap = state.caption.replace('"', "'")
    )
}

fn read_last_pair() -> Option<(String, String)> {
    let bytes = fs::read(twin_config_path()).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let se = v.get("spriteEvolution")?;
    let a = se.get("lastMood")?.as_str()?.to_string();
    let b = se.get("lastEnvironment")?.as_str()?.to_string();
    Some((a, b))
}

fn write_evolution_meta(path: &str, mood: &str, env: &str) -> Result<()> {
    let p = twin_config_path();
    fs::create_dir_all(
        p.parent()
            .ok_or_else(|| anyhow!("no config parent"))?,
    )?;
    let mut value: serde_json::Value = match fs::read(&p) {
        Ok(b) if !b.is_empty() => serde_json::from_slice(&b).unwrap_or_else(|_| json!({})),
        _ => json!({}),
    };
    if !value.is_object() {
        value = json!({});
    }
    let o = value.as_object_mut().expect("object");
    let mut se = o
        .get("spriteEvolution")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !se.is_object() {
        se = json!({});
    }
    let m = se.as_object_mut().expect("obj");
    m.insert("currentPath".to_string(), json!(path));
    m.insert("lastMood".to_string(), json!(mood));
    m.insert("lastEnvironment".to_string(), json!(env));
    m.insert(
        "updatedAt".to_string(),
        json!(chrono::Local::now().to_rfc3339()),
    );
    o.insert("spriteEvolution".to_string(), se);
    fs::write(
        &p,
        serde_json::to_string_pretty(&value).map_err(|e| anyhow!(e))?,
    )?;
    Ok(())
}

/// If mood or environment changed from last saved evolution, return true.
fn needs_evolution(state: &PetState) -> bool {
    let m = mood_key(&state.state);
    let e = env_key(&state.environment);
    match read_last_pair() {
        None => true,
        Some((lm, le)) => lm != m || le != e,
    }
}

/// Called when `twin-state.json` changes (mood or scene lane).
pub async fn on_pet_state_changed(app: &AppHandle, state: PetState) -> Result<()> {
    if !needs_evolution(&state) {
        return Ok(());
    }
    let _ = run_evolution(app, &state).await?;
    Ok(())
}

/// Manual "regenerate" from UI — always runs, updates meta.
pub async fn regenerate(app: &AppHandle) -> Result<String> {
    let state = crate::state::read_state_file()?
        .ok_or_else(|| anyhow!("no pet state on disk — wait for harvest"))?;
    run_evolution(app, &state).await
}

async fn run_evolution(app: &AppHandle, state: &PetState) -> Result<String> {
    let prompt = build_evolutionary_prompt(state);
    let img = image_gen::render_evolutionary_sprite(&prompt)
        .await
        .map_err(|e| anyhow!(e))?;
    let mood = mood_key(&state.state);
    let env = env_key(&state.environment);
    write_evolution_meta(&img.saved_path, mood, env)?;
    let is_svg = img.saved_path.ends_with(".svg");
    let p = img.saved_path.clone();
    let _ = app.emit(
        "twin://sprite-updated",
        json!({ "path": p, "isSvg": is_svg }),
    );
    Ok(p)
}
