//! Evolutionary desk sprite — re-renders on mood / environment change.

use anyhow::{anyhow, Result};
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::image_gen;
use crate::model::{Animation, Environment, Mood, PetState, Species};
use crate::paths::twin_config_path;
use crate::provider::Provider;
use crate::rembg;
use std::fs;

const DEFAULT_AXO: &str = "Cute chibi axolotl: pink-peach body, feathery external gills, big dark eyes, \
soft-serve line art, friendly proportions, paper-cutout style, single character only.";

static EVO_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

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

fn species_key(s: &Species) -> &'static str {
    match s {
        Species::Axolotl => "axolotl",
        Species::Cat => "cat",
        Species::Slime => "slime",
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

fn custom_evolution_enabled() -> bool {
    let bytes = match fs::read(twin_config_path()) {
        Ok(b) if !b.is_empty() => b,
        _ => return false,
    };
    let v: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(x) => x,
        _ => return false,
    };
    v.get("spriteEvolution")
        .and_then(|x| x.get("kind"))
        .and_then(|k| k.as_str())
        == Some("custom")
}

/// Onboarding preview: neutral state + user-supplied baseline (not yet in config).
pub fn build_preview_prompt(user_baseline: &str) -> String {
    let state = PetState {
        species: Species::Axolotl,
        state: Mood::Healthy,
        energy: 70,
        stress: 20,
        glow: 75,
        environment: Environment::SunnyIsland,
        animation: Animation::Dancing,
        caption: "preview".into(),
        scene: String::new(),
        message: String::new(),
        reason: vec![],
        updated: String::new(),
        source_updated: String::new(),
        ascii: String::new(),
        svg: String::new(),
        color: "#8b5cf6".into(),
    };
    build_evolutionary_prompt_with_baseline(&state, user_baseline.trim(), true)
}

/// Full evolutionary prompt for the active image route.
pub fn build_evolutionary_prompt(state: &PetState) -> String {
    let base = baseline_description();
    build_evolutionary_prompt_with_baseline(state, &base, custom_evolution_enabled())
}

fn build_evolutionary_prompt_with_baseline(state: &PetState, base: &str, custom_identity: bool) -> String {
    let out_fmt = "full-body sprite on a clean solid white or pastel background; single character; rembg will remove the background — do not use transparency / checkerboard patterns in raster image routes.";
    let mood = mood_key(&state.state);
    let env = env_key(&state.environment);
    let mutation_hint = if custom_identity {
        "tiny expression or tint adjustments only; no outfit, hair, body, age, species, or silhouette changes"
    } else {
        "pose, eyes, gill color, line weight, tint"
    };
    let identity_rule = if custom_identity {
        "CUSTOM IDENTITY RULE: The first-summon character is sacred. Preserve it almost exactly: same silhouette, age, clothing, hair, body proportions, face structure, color family, and recognizable identity. Mood and scene may NEVER redesign the character. Do not add axolotl gills, cat ears, slime body, or any default twin.md mascot traits unless BASELINE explicitly asks for them."
    } else {
        "DEFAULT IDENTITY RULE: Preserve the selected bundled species identity."
    };
    let mood_cues = if custom_identity {
        "Mood is secondary and optional. If mood is sad/stressed/tired, do NOT make a visibly sad new character. At most use a tiny eyelid change, micro-pose, or barely visible tint. Never change clothes, hair, face shape, body, species, age, or silhouette. The result must look like the same first-summon image at a glance."
    } else {
        "Mood -> visual cues (apply lightly, keep silhouette):\n- healthy: upright, warm saturation, soft smile\n- sleep_deprived: droopy lids, slight slouch, cool muted palette\n- stressed: tense micro-pose, slightly warmer stress tint\n- neglected: dimmer color, averted eye line, quieter posture"
    };
    let (species, species_cue) = if custom_identity {
        (
            "custom companion",
            "follow BASELINE exactly; do not reinterpret it as an axolotl/cat/slime unless the baseline explicitly says so",
        )
    } else {
        let species = species_key(&state.species);
        let species_cue = match state.species {
            Species::Axolotl => "axolotl silhouette: frilled external gills, soft rounded body, curious eyes",
            Species::Cat => "cat silhouette: clear triangle ears, compact body, self-contained expression",
            Species::Slime => "slime silhouette: rounded dome body, bouncy droop, goofy low-ego face",
        };
        (species, species_cue)
    };
    format!(
        r#"You are generating a single sprite of a persistent desktop companion.
Render: full body, centered, facing 3/4 forward, isolated — no frame, no UI, no text, no title.
The sprite must read at 32x32 px by silhouette alone. Avoid corporate mascot energy, SaaS flat-vector filler, sticker-pack gloss, and Memoji realism.
{identity_rule}

Output must be: {out_fmt}

BASELINE (do not break identity across evolutions; keep the same character readable):
{base}

CURRENT STATE (subtle, small mutations only — {mutation_hint}):
- species: {species} ({species_cue})
- mood: {mood}
- environment vibe: {env}
- energy: {}/100
- stress: {}/100
- caption hint: "{cap}"

{mood_cues}
"#,
        state.energy,
        state.stress,
        cap = state.caption.replace('"', "'")
    )
}

fn needs_rembg_for_provider() -> bool {
    let (p, _) = crate::credentials::active_provider_and_model();
    matches!(p, Provider::Openai | Provider::Gemini)
}

fn write_evolution_meta(path: &str, species: &str, mood: &str, env: &str) -> Result<()> {
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
    m.insert("lastSpecies".to_string(), json!(species));
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

pub fn pin_current_sprite_to_state(state: &PetState) -> Result<()> {
    if !custom_evolution_enabled() {
        return Ok(());
    }
    let path = fs::read(twin_config_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|v| {
            v.get("spriteEvolution")
                .and_then(|se| se.get("currentPath"))
                .and_then(|p| p.as_str())
                .map(|p| p.to_string())
        })
        .filter(|p| !p.trim().is_empty() && std::path::Path::new(p).exists());

    if let Some(path) = path {
        write_evolution_meta(
            &path,
            species_key(&state.species),
            mood_key(&state.state),
            env_key(&state.environment),
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteEvolutionSnapshot {
    pub current_path: Option<String>,
    pub is_svg: bool,
    pub custom_enabled: bool,
}

pub fn current_snapshot() -> SpriteEvolutionSnapshot {
    if !custom_evolution_enabled() {
        return SpriteEvolutionSnapshot {
            current_path: None,
            is_svg: false,
            custom_enabled: false,
        };
    }

    let path = fs::read(twin_config_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|v| {
            v.get("spriteEvolution")
                .and_then(|se| se.get("currentPath"))
                .and_then(|p| p.as_str())
                .map(|p| p.to_string())
        })
        .filter(|p| !p.trim().is_empty() && std::path::Path::new(p).exists());
    let is_svg = path.as_deref().map(|p| p.ends_with(".svg")).unwrap_or(false);
    SpriteEvolutionSnapshot {
        current_path: path,
        is_svg,
        custom_enabled: true,
    }
}

/// Called when `twin-state.json` changes (mood or scene lane).
pub async fn on_pet_state_changed(app: &AppHandle, state: PetState) -> Result<()> {
    if !custom_evolution_enabled() {
        return Ok(());
    }

    // Never auto-regenerate custom/photo companions from mood changes. The
    // accepted preview is the user's chosen identity; automatic re-rendering
    // from text can drift into a different person/character.
    let _ = app;
    let _ = pin_current_sprite_to_state(&state);
    Ok(())
}

/// Manual "regenerate" from UI.
pub async fn regenerate(app: &AppHandle) -> Result<String> {
    if !custom_evolution_enabled() {
        return Err(anyhow!(
            "custom_sprite_required: choose custom prompt mode in onboarding to use AI sprite evolution"
        ));
    }

    if needs_rembg_for_provider() && !rembg::is_available() {
        return Err(anyhow!(rembg::rembg_install_hint_err()));
    }
    let state = crate::state::read_state_file()?
        .ok_or_else(|| anyhow!("no pet state on disk — wait for harvest"))?;
    let _g = EVO_LOCK.lock().await;
    let _ = app.emit(
        "twin://sprite-evolving",
        json!({ "reason": "manual" }),
    );
    match run_evolution_inner(app, &state).await {
        Ok(p) => Ok(p),
        Err(e) => {
            let _ = app.emit("twin://sprite-evolve-error", json!({ "message": e.to_string() }));
            Err(e)
        }
    }
}

async fn run_evolution_inner(app: &AppHandle, state: &PetState) -> Result<String> {
    let prompt = build_evolutionary_prompt(state);
    let img = image_gen::render_evolutionary_sprite(&prompt)
        .await
        .map_err(|e| anyhow!(e))?;
    let species = species_key(&state.species);
    let mood = mood_key(&state.state);
    let env = env_key(&state.environment);
    write_evolution_meta(&img.saved_path, species, mood, env)?;
    let is_svg = img.saved_path.ends_with(".svg");
    let p = img.saved_path.clone();
    let _ = app.emit(
        "twin://sprite-updated",
        json!({ "path": p, "isSvg": is_svg }),
    );
    Ok(p)
}
