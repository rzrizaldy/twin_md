//! Native implementations of the local slash commands (inbox, mood, help).
//!
//! Keeps behaviour byte-identical with the TypeScript impl in
//! `@twin-md/core/commands/*` so desktop, web, and CLI converge on the same
//! files/markdown shape.
//!
//! LLM-backed commands (/daily, /recap, /weekahead, /reflect) live in chat.rs
//! and use the wellness system prompt there.

use anyhow::{Context, Result};
use chrono::Local;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use crate::context;

#[derive(Debug, Serialize)]
pub struct CommandOutcome {
    pub ok: bool,
    pub message: String,
    pub path: Option<String>,
}

fn fail(msg: impl Into<String>) -> CommandOutcome {
    CommandOutcome {
        ok: false,
        message: msg.into(),
        path: None,
    }
}

fn vault_path() -> Option<PathBuf> {
    context::gather().vault_path
}

fn quick_notes_path() -> PathBuf {
    let raw = context::gather()
        .quick_notes_path
        .unwrap_or_else(|| "inbox".to_string());
    let mut out = PathBuf::new();
    for component in Path::new(raw.trim().trim_matches('/')).components() {
        if let Component::Normal(part) = component {
            out.push(part);
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from("inbox")
    } else {
        out
    }
}

fn clean_title_source(raw: &str) -> String {
    let mut trimmed = raw.trim();
    trimmed = trimmed.trim_start_matches(|c| c == '-' || c == '*' || c == ' ');
    trimmed = trimmed
        .strip_prefix("[ ]")
        .or_else(|| trimmed.strip_prefix("[x]"))
        .or_else(|| trimmed.strip_prefix("[X]"))
        .unwrap_or(trimmed)
        .trim();
    let mut out = String::new();
    for c in trimmed.chars() {
        if c.is_alphanumeric() || c.is_whitespace() {
            out.push(c);
        } else {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn title_case(raw: &str) -> String {
    raw.split_whitespace()
        .take(8)
        .map(|word| {
            if word
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && word.len() > 1
            {
                return word.to_string();
            }
            let mut chars = word.chars();
            let Some(first) = chars.next() else {
                return String::new();
            };
            let mut out = first.to_uppercase().collect::<String>();
            out.push_str(&chars.as_str().to_lowercase());
            out
        })
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_from_note(body: &str) -> String {
    let explicit = body.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix("title:")
            .or_else(|| trimmed.strip_prefix("Title:"))
            .map(str::trim)
            .filter(|s| !s.is_empty())
    });
    let source = explicit.or_else(|| {
        body.lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
    });
    let title = source
        .map(clean_title_source)
        .map(|s| title_case(&s))
        .unwrap_or_default();
    if title.is_empty() {
        "Quick Note".to_string()
    } else {
        title
    }
}

fn body_without_explicit_title(body: &str) -> String {
    let mut lines = body.lines();
    let Some(first) = lines.next() else {
        return body.to_string();
    };
    if first.trim_start().to_ascii_lowercase().starts_with("title:") {
        let stripped = lines.collect::<Vec<_>>().join("\n").trim().to_string();
        if !stripped.is_empty() {
            return stripped;
        }
    }
    body.to_string()
}

fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for c in title.to_ascii_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
        if slug.len() >= 80 {
            break;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "quick-note".to_string()
    } else {
        trimmed
    }
}

fn unique_note_path(dir: &Path, slug: &str) -> PathBuf {
    let mut path = dir.join(format!("{slug}.md"));
    let mut counter = 2;
    while path.exists() {
        path = dir.join(format!("{slug}-{counter}.md"));
        counter += 1;
    }
    path
}

pub fn run_inbox(note: &str) -> Result<CommandOutcome> {
    let body = note.trim();
    if body.is_empty() {
        return Ok(fail("give me something to save — /inbox <note>"));
    }

    let Some(vault) = vault_path() else {
        return Ok(fail(
            "no vault wired yet — set obsidianVaultPath in twin.config.json",
        ));
    };

    let quick_notes_dir = vault.join(quick_notes_path());
    fs::create_dir_all(&quick_notes_dir).context("create quick notes dir")?;
    let title = title_from_note(body);
    let inbox_path = unique_note_path(&quick_notes_dir, &slugify(&title));
    let stamp = Local::now().format("%Y-%m-%d %H:%M");
    let created = Local::now().to_rfc3339();
    let note_body = body_without_explicit_title(body);
    let content = format!(
        "---\ncreated: \"{created}\"\ncaptured: \"{stamp}\"\nsource: \"twin.md /inbox\"\nstatus: inbox\n---\n\n# {title}\n\n{note_body}\n"
    );
    fs::write(&inbox_path, content).context("write inbox note")?;

    Ok(CommandOutcome {
        ok: true,
        message: format!(
            "caught it. saved to `{}`.",
            inbox_path.strip_prefix(&vault)
                .unwrap_or(inbox_path.as_path())
                .display()
        ),
        path: Some(inbox_path.display().to_string()),
    })
}

pub fn run_mood(args: &str) -> Result<CommandOutcome> {
    let trimmed = args.trim();
    if trimmed.is_empty() {
        return Ok(fail("try `/mood 7` or `/mood 4 rough morning`."));
    }
    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let score_raw = parts.next().unwrap_or("");
    let note = parts.next().unwrap_or("").trim();

    let score: u32 = match score_raw.parse() {
        Ok(n) if n <= 10 => n,
        _ => return Ok(fail("mood is a 0-10 scale. try `/mood 6`.")),
    };

    let Some(vault) = vault_path() else {
        return Ok(fail(
            "no vault wired yet — set obsidianVaultPath in twin.config.json",
        ));
    };

    let daily_dir = vault.join("daily-notes");
    fs::create_dir_all(&daily_dir).context("create daily-notes dir")?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    let file = daily_dir.join(format!("{today}.md"));
    let time = Local::now().format("%H:%M");
    let entry = if note.is_empty() {
        format!("- {time} mood {score}/10\n")
    } else {
        format!("- {time} mood {score}/10 — {note}\n")
    };

    if !file.exists() {
        let header = format!("# {today}\n\n## mood\n{entry}");
        fs::write(&file, header).context("seed daily note")?;
    } else {
        let existing = fs::read_to_string(&file).unwrap_or_default();
        let mut handle = OpenOptions::new()
            .append(true)
            .open(&file)
            .context("open daily note")?;
        let needs_header = !existing.to_lowercase().contains("## mood");
        let prefix = if existing.ends_with('\n') { "" } else { "\n" };
        if needs_header {
            write!(handle, "{prefix}\n## mood\n{entry}").context("append mood section")?;
        } else {
            write!(handle, "{prefix}{entry}").context("append mood entry")?;
        }
    }

    Ok(CommandOutcome {
        ok: true,
        message: format!(
            "logged mood {score}/10.{}",
            if note.is_empty() {
                String::new()
            } else {
                " thanks for the note.".into()
            }
        ),
        path: Some(file.display().to_string()),
    })
}
