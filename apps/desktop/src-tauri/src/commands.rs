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
use std::path::PathBuf;

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

    fs::create_dir_all(&vault).context("create vault dir")?;
    let inbox_path = vault.join("inbox.md");
    let stamp = Local::now().format("%Y-%m-%d %H:%M");
    let line = format!("- [ ] {stamp} {body}\n");

    if !inbox_path.exists() {
        let header = "# inbox\n\nquick captures from your twin. sort later.\n\n";
        fs::write(&inbox_path, format!("{header}{line}")).context("seed inbox.md")?;
    } else {
        let current = fs::read_to_string(&inbox_path).unwrap_or_default();
        let prefix = if current.ends_with('\n') { "" } else { "\n" };
        let mut file = OpenOptions::new()
            .append(true)
            .open(&inbox_path)
            .context("open inbox.md for append")?;
        write!(file, "{prefix}{line}").context("append inbox line")?;
    }

    Ok(CommandOutcome {
        ok: true,
        message: format!(
            "caught it. saved to `{}`.",
            inbox_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "inbox.md".into())
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
