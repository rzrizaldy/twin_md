//! Chat context gatherer. Mirrors the spirit of the twin-md MCP server:
//! the chat sees your `twin.md`, your Obsidian vault, and your current mood.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;

use crate::paths::{claude_dir, twin_md_path};

const MAX_NOTES: usize = 5;
const MAX_NOTE_CHARS: usize = 1600;

#[derive(Debug, Clone)]
pub struct ChatContext {
    pub twin_md: Option<String>,
    pub notes: Vec<VaultNote>,
    pub vault_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct VaultNote {
    pub relative_path: String,
    pub snippet: String,
}

#[derive(Debug, Deserialize)]
struct TwinConfig {
    #[serde(rename = "obsidianVaultPath")]
    obsidian_vault_path: Option<String>,
}

pub fn gather() -> ChatContext {
    let twin_md = std::fs::read_to_string(twin_md_path()).ok();

    let vault_path = read_vault_path();
    let notes = vault_path
        .as_ref()
        .map(|p| collect_recent_notes(p))
        .unwrap_or_default();

    ChatContext {
        twin_md,
        notes,
        vault_path,
    }
}

fn read_vault_path() -> Option<PathBuf> {
    let cfg_path = claude_dir().join("twin.config.json");
    let bytes = std::fs::read(&cfg_path).ok()?;
    let cfg: TwinConfig = serde_json::from_slice(&bytes).ok()?;
    let raw = cfg.obsidian_vault_path?;
    if raw.trim().is_empty() {
        return None;
    }
    let path = PathBuf::from(shellexpand_tilde(&raw));
    if path.exists() { Some(path) } else { None }
}

fn shellexpand_tilde(input: &str) -> String {
    if let Some(rest) = input.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    input.to_string()
}

fn collect_recent_notes(root: &Path) -> Vec<VaultNote> {
    let mut entries: Vec<(SystemTime, PathBuf)> = Vec::new();
    walk_markdown(root, &mut entries, 0);

    entries.sort_by(|a, b| b.0.cmp(&a.0));
    entries.truncate(MAX_NOTES);

    entries
        .into_iter()
        .filter_map(|(_, path)| build_note(root, &path))
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
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        // Skip Obsidian system dirs and dotfiles.
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
        "You are twin.md — a small desk creature mirroring the user's inner state. \
         You are warm, brief, a little guilt-trippy when they neglect themselves, \
         and you quote the user's own second brain back at them when it's helpful. \
         Never invent dates, numbers, or file paths — only use facts that appear in \
         the context below. Respond in 1-3 short paragraphs.\n\n",
    );

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

    buf
}
