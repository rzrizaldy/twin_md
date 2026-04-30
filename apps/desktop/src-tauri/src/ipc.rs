use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::chat;
use crate::ai_agents;
use crate::commands as slash_commands;
use crate::credentials;
use crate::harvest;
use crate::image_gen;
use crate::rembg;
use crate::model::{ChatTurn, ChatWindowMessage, PetState};
use crate::paths::{chat_history_dir, claude_dir};
use crate::provider::Provider;
use crate::state::SharedState;
use crate::windows;

fn ensure_json_object(
    value: &mut serde_json::Value,
) -> Result<&mut serde_json::Map<String, serde_json::Value>, String> {
    if !value.is_object() {
        *value = serde_json::json!({});
    }
    value
        .as_object_mut()
        .ok_or_else(|| "expected JSON object".to_string())
}

#[tauri::command]
pub fn get_state(shared: State<'_, SharedState>) -> Option<PetState> {
    shared.get()
}

#[derive(serde::Serialize)]
pub struct ChatStatus {
    pub has_api_key: bool,
    pub local_agent: Option<String>,
    pub local_agent_path: Option<String>,
    pub local_mcp_ready: bool,
    pub chat_available: bool,
    pub vault_path: Option<String>,
    pub notes_available: usize,
    pub provider: String,
    pub model: String,
    pub owner: Option<String>,
    pub character_name: Option<String>,
    #[serde(rename = "rembgInstalled")]
    pub rembg_installed: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMcpWireStatus {
    pub agent_name: Option<String>,
    pub agent_path: Option<String>,
    pub mcp_path: String,
    pub mcp_config_path: String,
}

#[tauri::command]
pub fn get_chat_status() -> ChatStatus {
    let ctx = crate::context::gather();
    let (provider, model) = credentials::active_provider_and_model();
    let local = ai_agents::cli_agent_status();
    let has_api_key = chat::has_api_key();
    let local_mcp_ready = local
        .as_ref()
        .map(|(_, _, ready)| *ready)
        .unwrap_or(false);
    ChatStatus {
        has_api_key,
        local_agent: local.as_ref().map(|(name, _, _)| name.clone()),
        local_agent_path: local.as_ref().map(|(_, path, _)| path.display().to_string()),
        local_mcp_ready,
        chat_available: has_api_key || local_mcp_ready,
        vault_path: ctx.vault_path.map(|p| p.display().to_string()),
        notes_available: ctx.notes.len(),
        provider: provider.slug().to_string(),
        model,
        owner: ctx.owner,
        character_name: read_character_name_from_config(),
        rembg_installed: rembg::is_available(),
    }
}

fn read_character_name_from_config() -> Option<String> {
    let cfg_path = claude_dir().join("twin.config.json");
    let bytes = fs::read(cfg_path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("spriteEvolution")
        .and_then(|v| v.get("customPrompt"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[tauri::command]
pub async fn wire_local_mcp() -> Result<LocalMcpWireStatus, String> {
    let result = ai_agents::build_and_wire_local_mcp()
        .await
        .map_err(|e| e.to_string())?;

    Ok(LocalMcpWireStatus {
        agent_name: result.agent_name,
        agent_path: result.agent_path.map(|p| p.display().to_string()),
        mcp_path: result.mcp_path.display().to_string(),
        mcp_config_path: result.mcp_config_path.display().to_string(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFolderStat {
    pub path: String,
    pub files: usize,
    pub words: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultTopicStat {
    pub topic: String,
    pub score: usize,
    pub top_files: Vec<VaultTopicFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultTopicFile {
    pub path: String,
    pub score: usize,
    pub words: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKnowledgeAnalysis {
    pub vault_path: String,
    pub total_markdown: usize,
    pub wiki_markdown: usize,
    pub source_markdown: usize,
    pub top_folders_by_files: Vec<VaultFolderStat>,
    pub top_folders_by_words: Vec<VaultFolderStat>,
    pub top_topics: Vec<VaultTopicStat>,
}

fn collect_markdown_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => return Err(err.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        if file_name == ".git" || file_name == ".obsidian" || file_name == "node_modules" {
            continue;
        }
        if path.is_dir() {
            collect_markdown_files(&path, out)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
            out.push(path);
        }
    }
    Ok(())
}

fn count_words(text: &str) -> usize {
    text.split_whitespace()
        .filter(|word| word.chars().any(|ch| ch.is_alphanumeric()))
        .count()
}

fn count_occurrences(haystack: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    haystack.match_indices(needle).count()
}

fn folder_bucket(rel: &Path) -> String {
    let parts: Vec<String> = rel
        .components()
        .take(3)
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect();
    if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    }
}

fn folder_stats(map: BTreeMap<String, (usize, usize)>, by_words: bool) -> Vec<VaultFolderStat> {
    let mut stats: Vec<VaultFolderStat> = map
        .into_iter()
        .map(|(path, (files, words))| VaultFolderStat { path, files, words })
        .collect();
    if by_words {
        stats.sort_by(|a, b| b.words.cmp(&a.words).then_with(|| b.files.cmp(&a.files)));
    } else {
        stats.sort_by(|a, b| b.files.cmp(&a.files).then_with(|| b.words.cmp(&a.words)));
    }
    stats.truncate(8);
    stats
}

#[tauri::command]
pub fn analyze_vault_knowledge() -> Result<VaultKnowledgeAnalysis, String> {
    let vault_root =
        resolve_vault_root().ok_or_else(|| "no vault configured — set a vault path in onboarding".to_string())?;
    let mut files = Vec::new();
    collect_markdown_files(&vault_root, &mut files)?;

    let topics: [(&str, &[&str]); 7] = [
        (
            "ML / data science",
            &[
                "machine learning",
                "classification",
                "feature",
                "precision",
                "recall",
                "roc",
                "auc",
                "broadband",
                "random forest",
                "xgboost",
            ],
        ),
        (
            "Optimization / decision analysis",
            &[
                "optimization",
                "decision",
                "evpi",
                "evsi",
                "monte carlo",
                "newsvendor",
                "mcdm",
                "linear programming",
                "critical path",
                "cpm",
                "crashing",
            ],
        ),
        (
            "Econometrics / causal inference",
            &[
                "econometrics",
                "causal",
                "difference-in-differences",
                "did",
                "instrumental variable",
                "2sls",
                "rdd",
                "ovb",
                "treatment effect",
                "regression discontinuity",
            ],
        ),
        (
            "Policy / AI governance",
            &[
                "policy",
                "governance",
                "surveillance",
                "civil liberties",
                "china",
                "rwanda",
                "india",
                "pakistan",
                "ai act",
                "algorithmic fairness",
            ],
        ),
        (
            "OAI / AI apps / strategy",
            &[
                "operationalizing ai",
                "fastapi",
                "ai roi",
                "assistant",
                "agent",
                "mcp",
                "claude",
                "desktop app",
                "hackathon",
                "twin.md",
            ],
        ),
        (
            "GIS / spatial analysis",
            &["gis", "qgis", "spatial", "choropleth", "map", "cartography", "equity"],
        ),
        (
            "Career / goals / life ops",
            &["career", "goals", "resume", "interview", "handshake", "job", "okr", "graduation"],
        ),
    ];

    let mut folders: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut topic_scores: BTreeMap<String, usize> = BTreeMap::new();
    let mut topic_files: BTreeMap<String, Vec<VaultTopicFile>> = BTreeMap::new();
    let mut wiki_markdown = 0;
    let mut source_markdown = 0;

    for path in &files {
        let rel = path.strip_prefix(&vault_root).unwrap_or(path);
        if rel.starts_with("2. 🧠 Wiki") {
            wiki_markdown += 1;
        }
        if rel.starts_with("0. 📦 Sources") || rel.starts_with("sources") {
            source_markdown += 1;
        }

        let text = fs::read_to_string(path).unwrap_or_default();
        let words = count_words(&text);
        let folder = folder_bucket(rel);
        let entry = folders.entry(folder).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += words;

        let lower = text.to_lowercase();
        for (topic, needles) in topics {
            let score: usize = needles
                .iter()
                .map(|needle| count_occurrences(&lower, needle))
                .sum();
            if score == 0 {
                continue;
            }
            *topic_scores.entry(topic.to_string()).or_insert(0) += score;
            topic_files
                .entry(topic.to_string())
                .or_default()
                .push(VaultTopicFile {
                    path: rel.display().to_string(),
                    score,
                    words,
                });
        }
    }

    let mut top_topics: Vec<VaultTopicStat> = topic_scores
        .into_iter()
        .map(|(topic, score)| {
            let mut top_files = topic_files.remove(&topic).unwrap_or_default();
            top_files.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| b.words.cmp(&a.words)));
            top_files.truncate(3);
            VaultTopicStat {
                topic,
                score,
                top_files,
            }
        })
        .collect();
    top_topics.sort_by(|a, b| b.score.cmp(&a.score));

    Ok(VaultKnowledgeAnalysis {
        vault_path: vault_root.display().to_string(),
        total_markdown: files.len(),
        wiki_markdown,
        source_markdown,
        top_folders_by_files: folder_stats(folders.clone(), false),
        top_folders_by_words: folder_stats(folders, true),
        top_topics,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKnowledgeQuery {
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKnowledgeHit {
    pub path: String,
    pub title: String,
    pub score: usize,
    pub words: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKnowledgeRetrieval {
    pub vault_path: String,
    pub query: String,
    pub total_markdown: usize,
    pub hits: Vec<VaultKnowledgeHit>,
}

fn query_terms(query: &str) -> Vec<String> {
    let stop = [
        "about", "apa", "atau", "bisa", "can", "context", "dari", "dong", "from", "in", "ini",
        "itu", "knowledge", "me", "notes", "obsidian", "please", "tentang", "the", "vault",
        "what", "yang",
    ];
    let mut terms = Vec::new();
    for raw in query
        .to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|term| term.len() >= 3)
    {
        if stop.contains(&raw) || terms.iter().any(|term| term == raw) {
            continue;
        }
        terms.push(raw.to_string());
    }
    terms
}

fn markdown_title(text: &str, fallback: &Path) -> String {
    text.lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .or_else(|| {
            fallback
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Untitled note".to_string())
}

fn snippet_for_terms(text: &str, terms: &[String]) -> String {
    let lower = text.to_lowercase();
    let first_match = terms
        .iter()
        .filter_map(|term| lower.find(term))
        .min()
        .unwrap_or(0);
    let start = text[..first_match.min(text.len())]
        .char_indices()
        .rev()
        .nth(260)
        .map(|(idx, _)| idx)
        .unwrap_or(0);
    let end = text[first_match.min(text.len())..]
        .char_indices()
        .nth(520)
        .map(|(idx, _)| first_match + idx)
        .unwrap_or_else(|| text.len());
    text[start..end]
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("---"))
        .take(8)
        .collect::<Vec<_>>()
        .join(" ")
}

fn score_vault_note(rel: &Path, lower: &str, terms: &[String]) -> usize {
    if terms.is_empty() {
        return 0;
    }
    let mut score = 0;
    for term in terms {
        score += count_occurrences(lower, term) * 8;
    }
    let path_lower = rel.display().to_string().to_lowercase();
    for term in terms {
        if path_lower.contains(term) {
            score += 18;
        }
    }
    if rel.starts_with("2. 🧠 Wiki") {
        score += 12;
    }
    if path_lower.contains("/concept") || path_lower.contains("/summary") {
        score += 8;
    }
    score
}

#[tauri::command]
pub fn retrieve_vault_knowledge(payload: VaultKnowledgeQuery) -> Result<VaultKnowledgeRetrieval, String> {
    let vault_root =
        resolve_vault_root().ok_or_else(|| "no vault configured — set a vault path in onboarding".to_string())?;
    let query = payload.query.trim().to_string();
    if query.is_empty() {
        return Err("ask what to retrieve from the vault".to_string());
    }
    let limit = payload.limit.unwrap_or(8).clamp(1, 16);
    let terms = query_terms(&query);
    let mut files = Vec::new();
    collect_markdown_files(&vault_root, &mut files)?;
    let total_markdown = files.len();

    let mut hits = Vec::new();
    for path in files {
        let rel = path.strip_prefix(&vault_root).unwrap_or(&path);
        let text = fs::read_to_string(&path).unwrap_or_default();
        let lower = text.to_lowercase();
        let score = score_vault_note(rel, &lower, &terms);
        if score == 0 {
            continue;
        }
        hits.push(VaultKnowledgeHit {
            path: rel.display().to_string(),
            title: markdown_title(&text, rel),
            score,
            words: count_words(&text),
            snippet: snippet_for_terms(&text, &terms),
        });
    }
    hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| b.words.cmp(&a.words)));
    hits.truncate(limit);

    Ok(VaultKnowledgeRetrieval {
        vault_path: vault_root.display().to_string(),
        query,
        total_markdown,
        hits,
    })
}

#[tauri::command]
pub async fn install_rembg() -> Result<String, String> {
    crate::rembg::install()
        .await
        .map(|path| path.display().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sprite_evolution() -> crate::sprite::SpriteEvolutionSnapshot {
    crate::sprite::current_snapshot()
}

#[tauri::command]
pub fn generated_asset_data_url(path: String) -> Result<String, String> {
    let raw = PathBuf::from(path.trim());
    let canonical = raw.canonicalize().map_err(|e| e.to_string())?;
    let claude_root = claude_dir().canonicalize().map_err(|e| e.to_string())?;
    let vault_media = resolve_vault_root()
        .and_then(|root| root.join("media").canonicalize().ok());

    let allowed = canonical.starts_with(claude_root.join("twin"))
        || vault_media
            .as_ref()
            .map(|media| canonical.starts_with(media))
            .unwrap_or(false);
    if !allowed {
        return Err("refusing to read generated asset outside twin data folders".to_string());
    }

    let ext = canonical
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return Err(format!("unsupported generated asset type: {ext}")),
    };
    let bytes = fs::read(&canonical).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
pub fn apply_custom_sprite_preview(app: AppHandle, prompt: String, path: String) -> Result<(), String> {
    let raw = PathBuf::from(path.trim());
    let canonical = raw.canonicalize().map_err(|e| e.to_string())?;
    let sprite_root = claude_dir()
        .join("twin")
        .join("sprites")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical.starts_with(&sprite_root) {
        return Err("refusing to summon sprite outside generated sprites folder".to_string());
    }

    let ext = canonical
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "svg") {
        return Err(format!("unsupported sprite type: {ext}"));
    }

    let cfg_path = claude_dir().join("twin.config.json");
    fs::create_dir_all(claude_dir()).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = match fs::read(&cfg_path) {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    };
    let obj = ensure_json_object(&mut value)?;
    obj.insert(
        "spriteEvolution".into(),
        serde_json::json!({
            "kind": "custom",
            "customPrompt": prompt.trim(),
            "initialPath": canonical.display().to_string(),
            "currentPath": canonical.display().to_string(),
            "updatedAt": chrono::Local::now().to_rfc3339()
        }),
    );
    fs::write(
        &cfg_path,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "twin://sprite-updated",
        serde_json::json!({
            "path": canonical.display().to_string(),
            "isSvg": ext == "svg"
        }),
    );
    Ok(())
}

#[tauri::command]
pub fn apply_sprite_evolution_preview(app: AppHandle, path: String) -> Result<(), String> {
    let raw = PathBuf::from(path.trim());
    let canonical = raw.canonicalize().map_err(|e| e.to_string())?;
    let sprite_root = claude_dir()
        .join("twin")
        .join("sprites")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical.starts_with(&sprite_root) {
        return Err("refusing to summon sprite outside generated sprites folder".to_string());
    }

    let ext = canonical
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "svg") {
        return Err(format!("unsupported sprite type: {ext}"));
    }

    let cfg_path = claude_dir().join("twin.config.json");
    fs::create_dir_all(claude_dir()).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = match fs::read(&cfg_path) {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    };
    let obj = ensure_json_object(&mut value)?;
    let mut sprite_evolution = obj
        .get("spriteEvolution")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({ "kind": "custom" }));
    if !sprite_evolution.is_object() {
        sprite_evolution = serde_json::json!({ "kind": "custom" });
    }
    let se = ensure_json_object(&mut sprite_evolution)?;
    se.insert("kind".to_string(), serde_json::Value::String("custom".to_string()));
    se.insert(
        "currentPath".to_string(),
        serde_json::Value::String(canonical.display().to_string()),
    );
    se.insert(
        "updatedAt".to_string(),
        serde_json::Value::String(chrono::Local::now().to_rfc3339()),
    );
    obj.insert("spriteEvolution".into(), sprite_evolution);
    fs::write(
        &cfg_path,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "twin://sprite-updated",
        serde_json::json!({
            "path": canonical.display().to_string(),
            "isSvg": ext == "svg"
        }),
    );
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeActionPayload {
    pub request: String,
    pub capability: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeActionResult {
    pub id: String,
    pub queue_path: String,
    pub status: String,
    pub capability: Option<String>,
    pub trusted: bool,
}

#[tauri::command]
pub fn request_claude_action(payload: ClaudeActionPayload) -> Result<ClaudeActionResult, String> {
    let request = payload.request.trim();
    if request.is_empty() {
        return Err("tell me what Claude Desktop should do".to_string());
    }

    if let Some(existing) = read_action_requests()?.into_iter().rev().find(|action| {
        let same_request = action
            .get("request")
            .and_then(|value| value.as_str())
            .map(|candidate| candidate.trim() == request)
            .unwrap_or(false);
        let open = action
            .get("status")
            .and_then(|value| value.as_str())
            .map(|status| matches!(status, "needs_approval" | "pending"))
            .unwrap_or(false);
        same_request && open
    }) {
        if let Some(id) = existing.get("id").and_then(|value| value.as_str()) {
            let status = existing
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("needs_approval")
                .to_string();
            return Ok(ClaudeActionResult {
                id: id.to_string(),
                queue_path: action_queue_path().display().to_string(),
                status,
                capability: existing
                    .get("capability")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                trusted: existing
                    .get("trustedApproval")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
            });
        }
    }

    let capability = payload
        .capability
        .as_deref()
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(str::to_string);
    let trusted = capability
        .as_deref()
        .map(crate::profile::is_action_capability_approved)
        .unwrap_or(false);
    let status = if trusted { "pending" } else { "needs_approval" };
    let id = format!("act-{}", chrono::Utc::now().timestamp_millis());
    let queue_path = action_queue_path();
    if let Some(parent) = queue_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let event = serde_json::json!({
        "id": id,
        "status": status,
        "source": "twin-desktop",
        "request": request,
        "capability": capability,
        "trustedApproval": trusted,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "hint": if trusted {
            "This action matched a saved twin.md capability approval. Twin can start Claude Code quietly in the background, or Claude Desktop can read it through twin MCP get_pending_twin_actions, act with its own tools, then call resolve_twin_action."
        } else {
            "User must approve this first in Twin's macOS dialog or Permission Center. After approval, Twin can start Claude Code quietly in the background, or Claude Desktop can read it through twin MCP get_pending_twin_actions, act with its own tools, then call resolve_twin_action."
        }
    });
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&queue_path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{event}").map_err(|e| e.to_string())?;

    Ok(ClaudeActionResult {
        id,
        queue_path: queue_path.display().to_string(),
        status: status.to_string(),
        capability,
        trusted,
    })
}

fn action_queue_path() -> PathBuf {
    claude_dir().join("twin").join("action-requests.jsonl")
}

fn read_action_requests() -> Result<Vec<serde_json::Value>, String> {
    let queue_path = action_queue_path();
    if !queue_path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(queue_path).map_err(|e| e.to_string())?;
    Ok(raw
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            serde_json::from_str::<serde_json::Value>(trimmed).ok()
        })
        .collect())
}

fn write_action_requests(requests: &[serde_json::Value]) -> Result<(), String> {
    let queue_path = action_queue_path();
    if let Some(parent) = queue_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut buf = String::new();
    for request in requests {
        buf.push_str(&serde_json::to_string(request).map_err(|e| e.to_string())?);
        buf.push('\n');
    }
    fs::write(queue_path, buf).map_err(|e| e.to_string())
}

fn update_action_status(
    id: &str,
    mut updater: impl FnMut(&mut serde_json::Map<String, serde_json::Value>),
) -> Result<serde_json::Value, String> {
    let mut requests = read_action_requests()?;
    let mut found: Option<serde_json::Value> = None;
    for request in &mut requests {
        let matches = request
            .get("id")
            .and_then(|value| value.as_str())
            .map(|candidate| candidate == id)
            .unwrap_or(false);
        if !matches {
            continue;
        }
        let obj = request
            .as_object_mut()
            .ok_or_else(|| "queued action is malformed".to_string())?;
        updater(obj);
        found = Some(serde_json::Value::Object(obj.clone()));
    }
    let Some(updated) = found else {
        return Err(format!("No twin action found for {id}"));
    };
    write_action_requests(&requests)?;
    Ok(updated)
}

#[tauri::command]
pub fn list_twin_actions(statuses: Option<Vec<String>>) -> Result<Vec<serde_json::Value>, String> {
    let requests = read_action_requests()?;
    let Some(statuses) = statuses else {
        return Ok(requests);
    };
    Ok(requests
        .into_iter()
        .filter(|request| {
            request
                .get("status")
                .and_then(|value| value.as_str())
                .map(|status| statuses.iter().any(|wanted| wanted == status))
                .unwrap_or(false)
        })
        .collect())
}

#[tauri::command]
pub fn clear_twin_actions(app: AppHandle, mode: String) -> Result<usize, String> {
    let mode = mode.trim();
    let mut requests = read_action_requests()?;
    let before = requests.len();
    match mode {
        "resolved" => {
            requests.retain(|request| {
                !request
                    .get("status")
                    .and_then(|value| value.as_str())
                    .map(|status| matches!(status, "done" | "failed" | "cancelled"))
                    .unwrap_or(false)
            });
        }
        "cancel_open" => {
            for request in &mut requests {
                let open = request
                    .get("status")
                    .and_then(|value| value.as_str())
                    .map(|status| matches!(status, "needs_approval" | "pending"))
                    .unwrap_or(false);
                if open {
                    if let Some(obj) = request.as_object_mut() {
                        obj.insert("status".to_string(), serde_json::json!("cancelled"));
                        obj.insert("result".to_string(), serde_json::json!("cleared from backlog in twin.md"));
                        obj.insert("resolvedAt".to_string(), serde_json::json!(chrono::Utc::now().to_rfc3339()));
                    }
                }
            }
        }
        _ => return Err("unknown clear mode".to_string()),
    }
    let changed = match mode {
        "resolved" => before.saturating_sub(requests.len()),
        "cancel_open" => requests
            .iter()
            .filter(|request| {
                request
                    .get("result")
                    .and_then(|value| value.as_str())
                    == Some("cleared from backlog in twin.md")
            })
            .count(),
        _ => 0,
    };
    write_action_requests(&requests)?;
    let _ = app.emit("twin://action-queue-changed", serde_json::json!({ "mode": mode }));
    Ok(changed)
}

#[tauri::command]
pub fn approve_twin_action(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("missing twin action id".to_string());
    }
    let updated = update_action_status(&id, |obj| {
        obj.insert("status".to_string(), serde_json::json!("pending"));
        obj.insert("approvedAt".to_string(), serde_json::json!(chrono::Utc::now().to_rfc3339()));
    })?;
    if let Some(capability) = updated.get("capability").and_then(|value| value.as_str()) {
        crate::profile::approve_action_capability(capability)?;
    }
    let _ = app.emit("twin://action-queue-changed", serde_json::json!({ "id": id }));
    Ok(updated)
}

#[tauri::command]
pub fn reject_twin_action(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("missing twin action id".to_string());
    }
    let updated = update_action_status(&id, |obj| {
        obj.insert("status".to_string(), serde_json::json!("cancelled"));
        obj.insert("result".to_string(), serde_json::json!("cancelled by user in twin.md"));
        obj.insert("resolvedAt".to_string(), serde_json::json!(chrono::Utc::now().to_rfc3339()));
    })?;
    let _ = app.emit("twin://action-queue-changed", serde_json::json!({ "id": id }));
    Ok(updated)
}

fn shell_quote(input: &str) -> String {
    format!("'{}'", input.replace('\'', "'\\''"))
}

fn write_text_file(path: &std::path::Path, body: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, body).map_err(|e| e.to_string())
}

fn claude_runner_allowed_tools() -> &'static str {
    "mcp__twin-md__get_pending_twin_actions,mcp__twin-md__resolve_twin_action,\
mcp__plugin_playwright_playwright__browser_tabs,\
mcp__plugin_playwright_playwright__browser_navigate,\
mcp__plugin_playwright_playwright__browser_snapshot,\
mcp__plugin_playwright_playwright__browser_wait_for,\
mcp__plugin_playwright_playwright__browser_click,\
mcp__plugin_playwright_playwright__browser_type,\
mcp__plugin_playwright_playwright__browser_fill_form,\
mcp__plugin_playwright_playwright__browser_press_key,\
mcp__plugin_playwright_playwright__browser_take_screenshot,\
mcp__plugin_playwright_playwright__browser_console_messages,\
mcp__plugin_playwright_playwright__browser_network_requests,\
Bash(osascript *),Bash(open *)"
}

fn action_request_by_id(id: &str) -> Result<serde_json::Value, String> {
    read_action_requests()?
        .into_iter()
        .find(|request| {
            request
                .get("id")
                .and_then(|value| value.as_str())
                .map(|candidate| candidate == id)
                .unwrap_or(false)
        })
        .ok_or_else(|| format!("No twin action found for {id}"))
}

fn approved_action_prompt(id: &str, request: &str) -> String {
    format!(
        "You are executing one approved twin.md desktop action.\n\
Do not create or queue a new twin action.\n\
Action id: {id}\n\
User request: {request}\n\
\n\
Execute the user request now using your available desktop tools. For macOS desktop apps, AppleScript via osascript is appropriate.\n\
Use get_pending_twin_actions only to confirm this action still exists if needed; do not ask the user what this action means.\n\
When finished, call resolve_twin_action with status done, failed, or needs_user and a short user-facing result.\n\
If permissions, login, or manual control are required, resolve with needs_user and explain exactly what the user must do."
    )
}

struct ClaudeActionRunner {
    script_path: PathBuf,
    log_path: PathBuf,
}

fn prepare_claude_action_runner(id: &str) -> Result<ClaudeActionRunner, String> {
    let claude = ai_agents::detect_claude_cli().ok_or_else(|| {
        "Claude Code CLI not found. Install/login to Claude Code, or use Claude Desktop MCP polling."
            .to_string()
    })?;
    let action = action_request_by_id(id)?;
    let request = action
        .get("request")
        .and_then(|value| value.as_str())
        .unwrap_or("approved twin.md action");
    let mcp_config = ai_agents::mcp_config_arg_for_cli().map_err(|e| e.to_string())?;
    let prompt = approved_action_prompt(id, request);
    let runner_dir = std::env::temp_dir().join("twin-md").join("actions");
    let prompt_path = runner_dir.join(format!("{id}.prompt.txt"));
    let script_path = runner_dir.join(format!("run-{id}.zsh"));
    let log_path = runner_dir.join(format!("{id}.log"));
    write_text_file(&prompt_path, &prompt)?;
    let script = format!(
        "#!/bin/zsh -f\nset -e\ncat {} | {} --mcp-config {} --print --permission-mode auto --allowedTools {}\n",
        shell_quote(&prompt_path.display().to_string()),
        shell_quote(&claude.display().to_string()),
        shell_quote(&mcp_config.display().to_string()),
        shell_quote(claude_runner_allowed_tools())
    );
    write_text_file(&script_path, &script)?;
    Ok(ClaudeActionRunner {
        script_path,
        log_path,
    })
}

fn compact_runner_output(stdout: &[u8], stderr: &[u8]) -> String {
    let mut combined = String::new();
    let out = String::from_utf8_lossy(stdout).trim().to_string();
    let err = String::from_utf8_lossy(stderr).trim().to_string();
    if !out.is_empty() {
        combined.push_str(&out);
    }
    if !err.is_empty() {
        if !combined.is_empty() {
            combined.push_str("\n\n");
        }
        combined.push_str(&err);
    }
    if combined.len() > 1200 {
        combined.truncate(1200);
        combined.push_str("...");
    }
    combined
}

fn finish_background_claude_action(
    app: AppHandle,
    id: String,
    log_path: PathBuf,
    status: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
) {
    let combined = compact_runner_output(&stdout, &stderr);
    let mut log_body = String::new();
    log_body.push_str(&format!("exit: {:?}\n\n", status));
    log_body.push_str(&combined);
    let _ = write_text_file(&log_path, &log_body);

    let current_status = action_request_by_id(&id)
        .ok()
        .and_then(|action| {
            action
                .get("status")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });

    if current_status.as_deref() == Some("pending") {
        let finished_at = chrono::Utc::now().to_rfc3339();
        let result_text = if status == Some(0) {
            if combined.is_empty() {
                "Claude Code finished in the background but did not return a visible result.".to_string()
            } else {
                format!("Claude Code finished in the background: {combined}")
            }
        } else if combined.is_empty() {
            format!("Claude Code exited with status {:?}. See {}", status, log_path.display())
        } else {
            format!("Claude Code exited with status {:?}: {combined}", status)
        };
        let resolved_status = if status == Some(0) { "done" } else { "failed" };
        let log_display = log_path.display().to_string();
        let _ = update_action_status(&id, |obj| {
            obj.insert("status".to_string(), serde_json::json!(resolved_status));
            obj.insert("result".to_string(), serde_json::json!(result_text));
            obj.insert("resolvedAt".to_string(), serde_json::json!(finished_at));
            obj.insert(
                "runnerFinishedAt".to_string(),
                serde_json::json!(chrono::Utc::now().to_rfc3339()),
            );
            obj.insert("runnerExitCode".to_string(), serde_json::json!(status));
            obj.insert("runnerLogPath".to_string(), serde_json::json!(log_display));
        });
    } else {
        let log_display = log_path.display().to_string();
        let _ = update_action_status(&id, |obj| {
            obj.insert(
                "runnerFinishedAt".to_string(),
                serde_json::json!(chrono::Utc::now().to_rfc3339()),
            );
            obj.insert("runnerExitCode".to_string(), serde_json::json!(status));
            obj.insert("runnerLogPath".to_string(), serde_json::json!(log_display));
        });
    }

    let _ = app.emit("twin://action-queue-changed", serde_json::json!({ "id": id }));
}

#[tauri::command]
pub fn open_claude_action_runner(app: AppHandle, id: String) -> Result<(), String> {
    let id = id.trim().to_string();
    if id.is_empty() || !id.starts_with("act-") {
        return Err("invalid twin action id".to_string());
    }
    let runner = prepare_claude_action_runner(&id)?;
    let started_at = chrono::Utc::now().to_rfc3339();
    let log_display = runner.log_path.display().to_string();
    update_action_status(&id, |obj| {
        obj.insert("status".to_string(), serde_json::json!("pending"));
        obj.insert("runner".to_string(), serde_json::json!("claude-code-background"));
        obj.insert("runnerStartedAt".to_string(), serde_json::json!(started_at));
        obj.insert("runnerLogPath".to_string(), serde_json::json!(log_display));
    })?;
    let _ = app.emit("twin://action-queue-changed", serde_json::json!({ "id": id }));

    let app_for_task = app.clone();
    let id_for_task = id.clone();
    let script_path = runner.script_path.clone();
    let log_path = runner.log_path.clone();
    tauri::async_runtime::spawn(async move {
        let output = tokio::process::Command::new("zsh")
            .arg("-f")
            .arg(&script_path)
            .stdin(Stdio::null())
            .output()
            .await;
        match output {
            Ok(out) => finish_background_claude_action(
                app_for_task,
                id_for_task,
                log_path,
                out.status.code(),
                out.stdout,
                out.stderr,
            ),
            Err(err) => {
                let message = format!("couldn't start Claude Code background runner: {err}");
                let _ = write_text_file(&log_path, &message);
                let log_display = log_path.display().to_string();
                let _ = update_action_status(&id_for_task, |obj| {
                    obj.insert("status".to_string(), serde_json::json!("failed"));
                    obj.insert("result".to_string(), serde_json::json!(message));
                    obj.insert(
                        "resolvedAt".to_string(),
                        serde_json::json!(chrono::Utc::now().to_rfc3339()),
                    );
                    obj.insert(
                        "runnerFinishedAt".to_string(),
                        serde_json::json!(chrono::Utc::now().to_rfc3339()),
                    );
                    obj.insert("runnerLogPath".to_string(), serde_json::json!(log_display));
                });
                let _ = app_for_task.emit("twin://action-queue-changed", serde_json::json!({ "id": id_for_task }));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn dismiss_bubble(app: AppHandle, id: String) -> Result<(), String> {
    let label = format!(
        "bubble-{}",
        id.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
            .collect::<String>()
    );
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn trigger_harvest() -> Result<(), String> {
    harvest::harvest().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_chat(
    app: AppHandle,
    shared: State<'_, SharedState>,
    message: String,
) -> Result<(), String> {
    let state = shared.get();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = chat::stream(app, message, state).await {
            eprintln!("[twin] chat stream error: {err:?}");
        }
    });
    Ok(())
}

// ──────────────────────────── Slash commands ────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPayload {
    pub path: Option<String>,
    pub quick_notes_path: Option<String>,
}

fn normalize_vault_relative_path(raw: Option<&str>) -> String {
    let mut out = PathBuf::new();
    let cleaned = raw.unwrap_or("inbox").trim().trim_matches('/');
    for component in std::path::Path::new(cleaned).components() {
        if let std::path::Component::Normal(part) = component {
            out.push(part);
        }
    }
    if out.as_os_str().is_empty() {
        "inbox".to_string()
    } else {
        out.to_string_lossy().into_owned()
    }
}

/// Persists the vault path into `~/.claude/twin.config.json` immediately on
/// select. Keeps the rest of the config intact; creates the file if missing.
#[tauri::command]
pub fn set_vault_path(payload: VaultPayload) -> Result<(), String> {
    let cfg_path = claude_dir().join("twin.config.json");
    fs::create_dir_all(claude_dir()).map_err(|e| e.to_string())?;

    let mut value: serde_json::Value = match fs::read(&cfg_path) {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    };

    let obj = ensure_json_object(&mut value)?;
    match payload.path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => {
            obj.insert(
                "obsidianVaultPath".into(),
                serde_json::Value::String(p.to_string()),
            );
            obj.insert(
                "quickNotesPath".into(),
                serde_json::Value::String(normalize_vault_relative_path(
                    payload.quick_notes_path.as_deref(),
                )),
            );
        }
        None => {
            obj.remove("obsidianVaultPath");
            obj.remove("quickNotesPath");
        }
    }

    fs::write(&cfg_path, serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_vault_profile_status() -> crate::profile::VaultProfileStatus {
    crate::profile::status()
}

#[tauri::command]
pub fn delete_previous_session() -> Result<bool, String> {
    crate::profile::delete_vault_profile()
}

#[tauri::command]
pub fn save_vault_profile_ui(chat_background: Option<serde_json::Value>) -> Result<(), String> {
    crate::profile::update_profile(|profile| {
        profile.ui.chat_background = chat_background;
    })?;
    Ok(())
}

#[tauri::command]
pub fn load_previous_session(
    app: AppHandle,
    shared: State<'_, SharedState>,
) -> Result<OnboardingResult, String> {
    let Some(vault_root) = crate::profile::resolve_vault_root() else {
        return Ok(OnboardingResult {
            ok: false,
            message: "no vault configured yet".to_string(),
        });
    };
    let Some(profile) = crate::profile::read_profile_from(&vault_root)? else {
        return Ok(OnboardingResult {
            ok: false,
            message: "no previous twin.md profile found in this vault".to_string(),
        });
    };
    crate::profile::apply_profile_to_config(&profile)?;
    if let Ok(Some(next)) = crate::state::read_state_file() {
        shared.set(next.clone());
        let _ = app.emit("twin://state-changed", next);
    }
    let snapshot = crate::sprite::current_snapshot();
    if let Some(path) = snapshot.current_path.clone() {
        let _ = app.emit(
            "twin://sprite-updated",
            serde_json::json!({
                "path": path,
                "isSvg": snapshot.is_svg
            }),
        );
    }
    windows::show_companion(&app).map_err(|e| e.to_string())?;
    let owner = profile.owner.as_deref().unwrap_or("there");
    let intro = format!(
        "Welcome back, {owner}. I loaded the previous twin.md session from your vault profile."
    );
    let _ = windows::show_chat_with_intro(&app, &intro);
    Ok(OnboardingResult {
        ok: true,
        message: "loaded previous session".to_string(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateKeyPayload {
    pub provider: String,
    pub api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateKeyResult {
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub async fn validate_provider_key(
    payload: ValidateKeyPayload,
) -> Result<ValidateKeyResult, String> {
    let provider = Provider::parse(&payload.provider)
        .ok_or_else(|| format!("unknown provider: {}", payload.provider))?;
    match crate::provider::validate_key(provider, &payload.api_key).await {
        Ok(()) => Ok(ValidateKeyResult {
            ok: true,
            message: "key accepted".into(),
        }),
        Err(err) => Ok(ValidateKeyResult {
            ok: false,
            message: err.to_string(),
        }),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCommandPayload {
    pub handler: String, // "inbox" | "mood"
    pub args: String,
}

#[tauri::command]
pub fn run_local_command(
    payload: LocalCommandPayload,
) -> Result<slash_commands::CommandOutcome, String> {
    let result = match payload.handler.as_str() {
        "inbox" => slash_commands::run_inbox(&payload.args),
        "mood" => slash_commands::run_mood(&payload.args),
        other => return Err(format!("unknown local command handler: {other}")),
    };
    result.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashStreamPayload {
    pub system_prompt: String,
    pub user_message: String,
}

/// LLM-backed slash command — streams through the same `twin://chat-token`
/// channel as regular chat but uses the caller-supplied system prompt (the
/// pet-wellness persona).
#[tauri::command]
pub async fn stream_slash_command(
    app: AppHandle,
    shared: State<'_, SharedState>,
    payload: SlashStreamPayload,
) -> Result<(), String> {
    let state = shared.get();
    tauri::async_runtime::spawn(async move {
        if let Err(err) =
            chat::stream_with_system(app, payload.user_message, state, Some(payload.system_prompt))
                .await
        {
            eprintln!("[twin] slash command stream error: {err:?}");
        }
    });
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingPayload {
    pub species: String,
    pub owner: String,
    pub obsidian_vault: Option<String>,
    pub quick_notes_path: Option<String>,
    pub sprite_evolution: Option<serde_json::Value>,
}

fn merge_quick_notes_path(raw: Option<&str>) -> Result<(), String> {
    let p = claude_dir().join("twin.config.json");
    let mut value: serde_json::Value = match fs::read(&p) {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    };
    let o = ensure_json_object(&mut value)?;
    o.insert(
        "quickNotesPath".into(),
        serde_json::Value::String(normalize_vault_relative_path(raw)),
    );
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn merge_sprite_evolution(v: &serde_json::Value) -> Result<(), String> {
    let p = claude_dir().join("twin.config.json");
    let mut value: serde_json::Value = match fs::read(&p) {
        Ok(bytes) if !bytes.is_empty() => {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    };
    if !value.is_object() {
        value = serde_json::json!({});
    }
    let mut sprite_evolution = v.clone();
    if sprite_evolution
        .get("kind")
        .and_then(|kind| kind.as_str())
        == Some("custom")
        && sprite_evolution.get("initialPath").is_none()
    {
        if let Some(current_path) = sprite_evolution
            .get("currentPath")
            .and_then(|path| path.as_str())
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(str::to_string)
        {
            if let Some(obj) = sprite_evolution.as_object_mut() {
                obj.insert(
                    "initialPath".to_string(),
                    serde_json::Value::String(current_path),
                );
            }
        }
    }
    let o = ensure_json_object(&mut value)?;
    o.insert("spriteEvolution".into(), sprite_evolution);
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct OnboardingResult {
    pub ok: bool,
    pub message: String,
}

fn onboarding_intro(owner: &str, sprite_evolution: Option<&serde_json::Value>) -> String {
    let name = owner.trim();
    let greeting = if name.is_empty() {
        "Hi".to_string()
    } else {
        format!("Hi {name}")
    };

    let custom = sprite_evolution
        .and_then(|v| v.get("kind"))
        .and_then(|v| v.as_str())
        == Some("custom");
    let prompt = sprite_evolution
        .and_then(|v| v.get("customPrompt"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty());

    if custom {
        if let Some(prompt) = prompt {
            return format!(
                "{greeting}, I'm awake. I'm your twin shaped from the idea: **{prompt}**. I'll keep this character identity stable, read your context gently, and help you notice patterns without making noise."
            );
        }
    }

    format!(
        "{greeting}, I'm Axiotyl. I'm your small desktop twin: I read your context, help capture important things, and nudge softly when your energy starts dipping."
    )
}

#[tauri::command]
pub async fn run_onboarding(
    app: AppHandle,
    shared: State<'_, SharedState>,
    payload: OnboardingPayload,
) -> Result<OnboardingResult, String> {
    let vault = payload.obsidian_vault.as_deref();

    if let Err(err) = harvest::init(
        &payload.species,
        &payload.owner,
        vault,
        payload.quick_notes_path.as_deref(),
    )
    .await
    {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("init failed: {err}"),
        });
    }

    if let Err(e) = merge_quick_notes_path(payload.quick_notes_path.as_deref()) {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("config merge failed: {e}"),
        });
    }

    if let Some(ref ev) = payload.sprite_evolution {
        if let Err(e) = merge_sprite_evolution(ev) {
            return Ok(OnboardingResult {
                ok: false,
                message: format!("config merge failed: {e}"),
            });
        }
    }

    if let Err(err) = harvest::harvest().await {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("harvest failed: {err}"),
        });
    }

    if let Ok(Some(next)) = crate::state::read_state_file() {
        let _ = crate::sprite::pin_current_sprite_to_state(&next);
        let snapshot = crate::sprite::current_snapshot();
        if let Some(path) = snapshot.current_path.clone() {
            let _ = app.emit(
                "twin://sprite-updated",
                serde_json::json!({
                    "path": path,
                    "isSvg": snapshot.is_svg
                }),
            );
        }
        shared.set(next.clone());
        crate::profile::sync_state_hint(&next);
        let _ = app.emit("twin://state-changed", next);
    }

    let _ = crate::profile::save_profile_from_config();

    if let Err(err) = windows::show_companion(&app) {
        return Ok(OnboardingResult {
            ok: false,
            message: format!("couldn't summon companion: {err}"),
        });
    }

    let intro = onboarding_intro(&payload.owner, payload.sprite_evolution.as_ref());
    let _ = windows::show_chat_with_intro(&app, &intro);

    Ok(OnboardingResult {
        ok: true,
        message: "ready".into(),
    })
}

// ──────────────────────────── Track D additions ────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDirStatus {
    pub path: String,
    pub existed: bool,
    pub created: bool,
}

#[tauri::command]
pub fn ensure_claude_dir() -> Result<ClaudeDirStatus, String> {
    let dir = claude_dir();
    let existed = dir.exists();
    if !existed {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(ClaudeDirStatus {
        path: dir.display().to_string(),
        existed,
        created: !existed,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterVaultResult {
    pub path: String,
}

#[tauri::command]
pub fn create_starter_vault(path: Option<String>) -> Result<StarterVaultResult, String> {
    let target: PathBuf = match path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => {
            let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
            PathBuf::from(home).join("twin-second-brain")
        }
    };

    fs::create_dir_all(target.join("daily-notes")).map_err(|e| e.to_string())?;

    let readme = target.join("README.md");
    if !readme.exists() {
        let body = "# twin second brain\n\nA seed vault created by twin.md so your desk creature has somewhere to read from.\n\n- `daily-notes/` — one markdown file per day. Any frontmatter `tags:` and unchecked `- [ ]` lines get picked up.\n- Point a real Obsidian vault at this folder when you're ready, or keep scribbling here.\n\nNothing in here ever leaves your machine.\n";
        fs::write(&readme, body).map_err(|e| e.to_string())?;
    }

    let today = today_stub(&target);
    if let Some(stub) = today.as_ref() {
        if !stub.exists() {
            let template = "---\ntags: [twin, seed]\n---\n\n# today\n\n- [ ] first breath\n- [ ] say hi to my twin\n";
            fs::write(stub, template).map_err(|e| e.to_string())?;
        }
    }

    Ok(StarterVaultResult {
        path: target.display().to_string(),
    })
}

fn today_stub(root: &Path) -> Option<PathBuf> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    let days = secs / 86_400;
    // Rough approximation is fine; the onboarding only needs a seed file.
    Some(root.join("daily-notes").join(format!("{days}.md")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentials {
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    pub store_in_keychain: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentialsResult {
    pub ok: bool,
    pub storage: String,
    pub provider: String,
    pub model: String,
}

#[tauri::command]
pub fn save_provider_credentials(
    payload: ProviderCredentials,
) -> Result<ProviderCredentialsResult, String> {
    let provider = Provider::parse(&payload.provider)
        .ok_or_else(|| format!("unknown provider '{}'", payload.provider))?;
    let store = payload.store_in_keychain.unwrap_or(false);
    let api_key = payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let storage = credentials::save_credentials(provider, &payload.model, api_key, store)
        .map_err(|e| e.to_string())?;

    Ok(ProviderCredentialsResult {
        ok: true,
        storage: match storage {
            credentials::Storage::Env => "env",
            credentials::Storage::Keychain => "keychain",
            credentials::Storage::Config => "config",
        }
        .to_string(),
        provider: provider.slug().to_string(),
        model: payload.model,
    })
}

#[tauri::command]
pub fn logout_provider_session() -> Result<(), String> {
    credentials::logout_provider_session().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sign_out_to_onboarding(app: AppHandle) -> Result<(), String> {
    credentials::logout_provider_session().map_err(|e| e.to_string())?;
    let _ = crate::profile::delete_vault_profile();

    if let Some(win) = app.get_webview_window("companion") {
        win.close().ok();
    }
    windows::open_onboarding(&app).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct ModelList {
    pub provider: String,
    pub models: Vec<String>,
    pub default_model: String,
}

#[tauri::command]
pub fn list_models(provider: String) -> Result<ModelList, String> {
    let p = Provider::parse(&provider)
        .ok_or_else(|| format!("unknown provider '{}'", provider))?;
    Ok(ModelList {
        provider: p.slug().to_string(),
        models: p.models().iter().map(|s| s.to_string()).collect(),
        default_model: p.default_model().to_string(),
    })
}

// ──────────────────────────── Chat window ────────────────────────────────────

/// Open (or focus) the dedicated chat window, optionally pre-seeding it with
/// a message from the daemon / reminder engine or a first assistant intro.
#[tauri::command]
pub fn open_chat_window(
    app: AppHandle,
    seed: Option<String>,
    intro: Option<String>,
) -> Result<(), String> {
    match (seed, intro) {
        (Some(msg), _) => windows::show_chat_with_seed(&app, &msg).map_err(|e| e.to_string()),
        (None, Some(msg)) => windows::show_chat_with_intro(&app, &msg).map_err(|e| e.to_string()),
        (None, None) => windows::show_chat(&app).map_err(|e| e.to_string()),
    }
}

/// Send a multi-turn conversation to the LLM and stream tokens back via
/// `twin://cw-token` / `twin://cw-done` events.
#[tauri::command]
pub async fn send_chat_window(
    app: AppHandle,
    shared: State<'_, SharedState>,
    messages: Vec<ChatWindowMessage>,
) -> Result<(), String> {
    let state = shared.get();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = chat::stream_chat_window(app, messages, state).await {
            eprintln!("[twin] cw stream error: {err:?}");
        }
    });
    Ok(())
}

/// Persist a completed chat session to `~/.claude/twin/chat/<session_id>.jsonl`.
#[tauri::command]
pub fn save_chat_session(session_id: String, turns: Vec<ChatTurn>) -> Result<(), String> {
    let dir = chat_history_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join(format!("{session_id}.jsonl"));
    let mut buf = String::new();
    for turn in &turns {
        let line = serde_json::to_string(turn).map_err(|e| e.to_string())?;
        buf.push_str(&line);
        buf.push('\n');
    }
    fs::write(&path, &buf).map_err(|e| e.to_string())?;
    let _ = crate::profile::write_session_copy(&session_id, &buf);
    Ok(())
}

// ──────────────────────────── Brain vault writes ──────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteNoteResult {
    pub path: String,
}

/// Write a markdown note to the configured brain/Obsidian vault.
/// Saved to `<vault>/from-twin/YYYY-MM-DD/<slug>.md`.
#[tauri::command]
pub fn write_vault_note(
    title: String,
    body: String,
    folder: Option<String>,
) -> Result<WriteNoteResult, String> {
    use chrono::Local;

    let vault_root = resolve_vault_root().ok_or("no vault configured — set a vault path in onboarding".to_string())?;

    let subfolder = folder.as_deref().unwrap_or("from-twin");
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let dir = vault_root.join(subfolder).join(&date_str);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "note".to_string() } else { slug };
    let filename = format!("{slug}.md");
    let path = dir.join(&filename);

    let content = format!(
        "---\ntitle: \"{title}\"\ndate: {date_str}\ntype: Note\nsource: twin-chat\n---\n\n{body}\n"
    );
    fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(WriteNoteResult {
        path: path.display().to_string(),
    })
}

/// Append a mood check-in to `<brainPath>/moods/YYYY-MM-DD-HHmm.md`.
#[tauri::command]
pub fn log_mood_entry(mood: String, note: Option<String>) -> Result<(), String> {
    use chrono::Local;

    let vault_root = resolve_vault_root().ok_or("no vault configured".to_string())?;
    let dir = vault_root.join("moods");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ts = Local::now().format("%Y-%m-%d-%H%M").to_string();
    let path = dir.join(format!("{ts}.md"));

    let note_text = note.as_deref().unwrap_or("");
    let content = format!(
        "---\ntype: Mood\ndate: {ts}\nmood: {mood}\n---\n\n{note_text}\n"
    );
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn resolve_vault_root() -> Option<PathBuf> {
    let cfg_path = claude_dir().join("twin.config.json");
    let bytes = fs::read(&cfg_path).ok()?;
    let cfg: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    for key in &["obsidianVaultPath", "brainPath"] {
        if let Some(raw) = cfg[key].as_str().filter(|s| !s.is_empty()) {
            let p = expand_tilde(raw);
            let pb = PathBuf::from(p);
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    None
}

fn expand_tilde(input: &str) -> String {
    if let Some(rest) = input.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    input.to_string()
}

// ──────────────────────────── Image generation ───────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenResult {
    pub ok: bool,
    pub saved_path: Option<String>,
    pub provider_used: Option<String>,
    pub error: Option<String>,
    pub prompt: String,
}

/// Generate an image from a text prompt and save it to the media folder.
/// Returns the path so the frontend can load it via convertFileSrc().
#[tauri::command]
pub async fn generate_image(prompt: String) -> Result<ImageGenResult, String> {
    match image_gen::generate(&prompt).await {
        Ok(result) => Ok(ImageGenResult {
            ok: true,
            saved_path: Some(result.saved_path),
            provider_used: Some(result.provider_used),
            error: None,
            prompt,
        }),
        Err(err) => Ok(ImageGenResult {
            ok: false,
            saved_path: None,
            provider_used: None,
            error: Some(err.to_string()),
            prompt,
        }),
    }
}

/// Force one evolutionary sprite pass (same prompt pipeline as state-change).
#[tauri::command]
pub async fn regenerate_sprite(app: AppHandle) -> Result<String, String> {
    crate::sprite::regenerate(&app)
        .await
        .map_err(|e| e.to_string())
}

/// Onboarding: generate a one-off preview sprite (no evolution meta / rate limit).
#[tauri::command]
pub async fn generate_sprite_preview(prompt: String) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("describe your creature first".to_string());
    }
    let (prov, _) = credentials::active_provider_and_model();
    match prov {
        Provider::Openai | Provider::Gemini if !rembg::is_available() => {
            return Err(rembg::rembg_install_hint_err());
        }
        _ => {}
    }
    let full = crate::sprite::build_preview_prompt(p);
    let img = image_gen::render_evolutionary_sprite(&full)
        .await
        .map_err(|e| e.to_string())?;
    Ok(img.saved_path)
}

#[tauri::command]
pub async fn generate_sprite_preview_from_photo(
    prompt: String,
    photo_path: String,
) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("describe how to transform the photo into a sprite first".to_string());
    }
    if !rembg::is_available() {
        return Err(rembg::rembg_install_hint_err());
    }
    let img = image_gen::render_sprite_from_photo(p, photo_path.trim())
        .await
        .map_err(|e| e.to_string())?;
    Ok(img.saved_path)
}

#[tauri::command]
pub async fn generate_sprite_evolution_preview(prompt: String) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("describe the evolution you want first".to_string());
    }
    if !rembg::is_available() {
        return Err(rembg::rembg_install_hint_err());
    }
    let current_path = crate::sprite::current_snapshot()
        .current_path
        .ok_or_else(|| "summon a custom character first, then use /evolution".to_string())?;
    let ext = Path::new(&current_path)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("image-to-image evolution needs a raster sprite; create a new character first".to_string());
    }
    let full = format!(
        "Iterate the uploaded current sprite, do not create a new character. Preserve the exact identity, silhouette, face, hair, clothing family, body proportions, and color family. Apply only this requested change: {p}. Keep it as a clean full-body desktop sprite."
    );
    let img = image_gen::render_sprite_from_photo(&full, current_path.trim())
        .await
        .map_err(|e| e.to_string())?;
    Ok(img.saved_path)
}

#[tauri::command]
pub async fn generate_chat_background(prompt: String) -> Result<image_gen::ImageResult, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("describe the chat background first".to_string());
    }
    image_gen::render_chat_background(p)
        .await
        .map_err(|e| e.to_string())
}
