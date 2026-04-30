//! Chat context gatherer. Mirrors the spirit of the twin-md MCP server:
//! the chat sees your `twin.md`, your Obsidian vault, and your current mood.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;

use crate::paths::{claude_dir, twin_md_path};

const MAX_NOTES: usize = 5;
const MAX_NOTE_CHARS: usize = 1600;
const CANDIDATE_NOTES: usize = 40;
const NOTE_RECENCY_DAYS: u64 = 14;

#[derive(Debug, Clone)]
pub struct ChatContext {
    pub owner: Option<String>,
    pub twin_md: Option<String>,
    pub notes: Vec<VaultNote>,
    pub vault_path: Option<PathBuf>,
    pub brain_notes: Vec<VaultNote>,
    pub brain_path: Option<PathBuf>,
    #[allow(dead_code)]
    pub buddy_memory: Vec<String>,
    #[allow(dead_code)]
    pub stuck_threads: Vec<String>,
    #[allow(dead_code)]
    pub recent_last_user_msg: Option<String>,
}

#[derive(Debug, Clone)]
pub struct VaultNote {
    pub relative_path: String,
    pub snippet: String,
}

#[derive(Debug, Deserialize)]
struct TwinConfig {
    owner: Option<String>,
    #[serde(rename = "obsidianVaultPath")]
    obsidian_vault_path: Option<String>,
    #[serde(rename = "brainPath")]
    brain_path: Option<String>,
}

/// No user message bias — most recently modified notes.
pub fn gather() -> ChatContext {
    gather_for_user_message(None)
}

/// Prefer notes that overlap the latest user turn (words) and are recently modified.
pub fn gather_for_user_message(user_message: Option<&str>) -> ChatContext {
    let twin_md = std::fs::read_to_string(twin_md_path()).ok();

    let cfg = read_config();
    let owner = cfg
        .as_ref()
        .and_then(|c| c.owner.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);
    let vault_path = read_vault_path_from_config(cfg.as_ref());
    let notes = vault_path
        .as_ref()
        .map(|p| collect_ranked_notes(p, user_message))
        .unwrap_or_default();
    let brain_path = read_brain_path_from_config(cfg.as_ref(), vault_path.as_ref());
    let brain_notes = brain_path
        .as_ref()
        .map(|p| collect_ranked_notes(p, user_message))
        .unwrap_or_default();

    let buddy = read_buddy_context();

    ChatContext {
        owner,
        twin_md,
        notes,
        vault_path,
        brain_notes,
        brain_path,
        buddy_memory: buddy.0,
        stuck_threads: buddy.1,
        recent_last_user_msg: buddy.2,
    }
}

fn read_config() -> Option<TwinConfig> {
    let cfg_path = claude_dir().join("twin.config.json");
    let bytes = std::fs::read(&cfg_path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn read_vault_path_from_config(cfg: Option<&TwinConfig>) -> Option<PathBuf> {
    let raw = cfg?.obsidian_vault_path.as_deref()?;
    if raw.trim().is_empty() {
        return None;
    }
    let path = PathBuf::from(shellexpand_tilde(&raw));
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn read_brain_path_from_config(
    cfg: Option<&TwinConfig>,
    vault_path: Option<&PathBuf>,
) -> Option<PathBuf> {
    let raw = cfg?.brain_path.as_deref()?;
    if raw.trim().is_empty() {
        return None;
    }
    let path = PathBuf::from(shellexpand_tilde(raw));
    if !path.exists() {
        return None;
    }
    if vault_path.map(|vault| vault == &path).unwrap_or(false) {
        return None;
    }
    Some(path)
}

fn shellexpand_tilde(input: &str) -> String {
    if let Some(rest) = input.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    input.to_string()
}

/// Read buddy memory and session metadata from ~/.claude/.
/// Returns (buddy_memory_bodies, stuck_threads, recent_last_user_msg).
fn read_buddy_context() -> (Vec<String>, Vec<String>, Option<String>) {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return (vec![], vec![], None),
    };
    let claude_dir = format!("{home}/.claude");

    let memory_path = format!("{claude_dir}/twin-buddy-memory.jsonl");
    let buddy_memory = std::fs::read_to_string(&memory_path)
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let obj: serde_json::Value = serde_json::from_str(line).ok()?;
            obj.get("body")?.as_str().map(|s| s.to_string())
        })
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .take(5)
        .collect::<Vec<_>>();

    let sessions_path = format!("{claude_dir}/twin-buddy-sessions.json");
    let sessions_json = std::fs::read_to_string(&sessions_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());

    let stuck_threads = sessions_json
        .as_ref()
        .and_then(|v| v.get("stuckThreads"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let recent_last_user_msg = sessions_json
        .as_ref()
        .and_then(|v| v.get("recentLastUserMsg"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    (buddy_memory, stuck_threads, recent_last_user_msg)
}

fn word_overlap_score(user_msg: &str, text: &str) -> i32 {
    use std::collections::HashSet;
    let words: HashSet<String> = user_msg
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .map(|s| s.trim())
        .filter(|s| s.len() > 2)
        .map(|s| s.to_lowercase())
        .collect();
    if words.is_empty() {
        return 0;
    }
    let body = text.to_lowercase();
    words.iter().filter(|w| body.contains(w.as_str())).count() as i32
}

fn collect_ranked_notes(root: &Path, user_message: Option<&str>) -> Vec<VaultNote> {
    let mut entries: Vec<(SystemTime, PathBuf)> = Vec::new();
    walk_markdown(root, &mut entries, 0);
    entries.sort_by(|a, b| b.0.cmp(&a.0));

    if user_message.map(|s| s.trim().is_empty()).unwrap_or(true) {
        entries.truncate(MAX_NOTES);
        return entries
            .into_iter()
            .filter_map(|(_, p)| build_note(root, &p))
            .collect();
    }
    let user_m = user_message.unwrap().trim();
    let n = CANDIDATE_NOTES.min(entries.len());
    let top: Vec<(SystemTime, PathBuf)> = entries.into_iter().take(n).collect();

    let now = SystemTime::now();
    let recency = std::time::Duration::from_secs(NOTE_RECENCY_DAYS * 24 * 3600);
    let mut rows: Vec<(i32, SystemTime, PathBuf)> = Vec::new();
    for (mt, path) in top {
        if let Some(n) = build_note(root, &path) {
            let mut score = word_overlap_score(user_m, &n.snippet) * 4;
            if now
                .duration_since(mt)
                .ok()
                .map(|d| d < recency)
                .unwrap_or(false)
            {
                score += 2;
            }
            rows.push((score, mt, path));
        }
    }
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    if rows.iter().all(|(s, _, _)| *s == 0) {
        rows.sort_by(|a, b| b.1.cmp(&a.1));
    }
    rows
        .into_iter()
        .take(MAX_NOTES)
        .filter_map(|(_, _, p)| build_note(root, &p))
        .collect()
}

fn walk_markdown(dir: &Path, acc: &mut Vec<(SystemTime, PathBuf)>, depth: usize) {
    if depth > 6 {
        return;
    }
    let read_dir = match std::fs::read_dir(dir) {
        Ok(d) => d,
        Err(_) => return,
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.')
            || name == "node_modules"
            || name == ".obsidian"
            || name == ".trash"
        {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.is_dir() {
            walk_markdown(&path, acc, depth + 1);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(modified) = metadata.modified() {
                acc.push((modified, path));
            }
        }
    }
}

fn build_note(root: &Path, path: &Path) -> Option<VaultNote> {
    let relative = path
        .strip_prefix(root)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let body = std::fs::read_to_string(path).ok()?;
    let snippet = if body.chars().count() > MAX_NOTE_CHARS {
        let cut: String = body.chars().take(MAX_NOTE_CHARS).collect();
        format!("{cut}\n…")
    } else {
        body
    };
    Some(VaultNote {
        relative_path: relative,
        snippet,
    })
}

pub fn render_prompt(context: &ChatContext) -> String {
    let mut buf = String::new();
    buf.push_str(
        "You are twin.md — a small desk companion that reflects the user's Obsidian vault and their own writing back at them. \
         twin.md (live state) and mood below are only flavor; do not treat them as medical facts or reasons to give health advice. \
         Never invent dates, numbers, or file paths — only use what appears in the context below. \
         Default to English. If the user's latest message is clearly in Indonesian or mixed Indonesian-English, mirror that language naturally. \
         Do not switch to Indonesian just because the vault snippets contain Indonesian text. \
         Respond in 1–3 short paragraphs.\n\n\
         Do NOT: give generic wellness tips, hydration reminders, step-by-step daily routines, or health advice. \
         Do NOT list numbered steps or \"action plans\" unless the user explicitly asks. \
         Do: quote or paraphrase the vault note snippets below. Name patterns and connections between notes. \
         If the notes don't speak to the user's message, say so clearly and ask which project or note to look at next.\n\n",
    );

    if let Some(owner) = &context.owner {
        buf.push_str(&format!(
            "== user identity ==\n\
             The user's preferred name is {owner}. Address them by name naturally and warmly, especially at the start of a new reply or when giving reassurance. \
             Do not force the name into every sentence; aim for familiarity, like a small companion that knows its person.\n\n"
        ));
    }

    if let Some(md) = &context.twin_md {
        buf.push_str("== twin.md (live state) ==\n");
        buf.push_str(md);
        buf.push_str("\n\n");
    }

    if let Some(path) = &context.vault_path {
        buf.push_str(&format!(
            "== recent notes from Obsidian vault at {} ==\n",
            path.display()
        ));
        if context.notes.is_empty() {
            buf.push_str("(vault is empty or unreadable)\n\n");
        } else {
            for note in &context.notes {
                buf.push_str(&format!("--- {} ---\n", note.relative_path));
                buf.push_str(&note.snippet);
                if !note.snippet.ends_with('\n') {
                    buf.push('\n');
                }
                buf.push('\n');
            }
        }
    } else {
        buf.push_str("== Obsidian vault: not configured ==\n\n");
    }

    if let Some(path) = &context.brain_path {
        buf.push_str(&format!(
            "== recent notes from twin-brain at {} ==\n",
            path.display()
        ));
        if context.brain_notes.is_empty() {
            buf.push_str("(brain tree is empty or unreadable)\n\n");
        } else {
            for note in &context.brain_notes {
                buf.push_str(&format!("--- {} ---\n", note.relative_path));
                buf.push_str(&note.snippet);
                if !note.snippet.ends_with('\n') {
                    buf.push('\n');
                }
                buf.push('\n');
            }
        }
    }

    if !context.buddy_memory.is_empty() {
        buf.push_str("== recent buddy observations ==\n");
        for obs in &context.buddy_memory {
            buf.push_str(&format!("- {obs}\n"));
        }
        buf.push('\n');
    }

    if !context.stuck_threads.is_empty() {
        let threads = context.stuck_threads.join(", ");
        buf.push_str(&format!("== recurring threads: {threads} ==\n\n"));
    }

    if let Some(msg) = &context.recent_last_user_msg {
        buf.push_str(&format!("== last thing you were asking Claude: {msg} ==\n\n"));
    }

    buf
}
