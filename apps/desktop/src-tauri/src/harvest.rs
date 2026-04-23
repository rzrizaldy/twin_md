//! Shell-out to the Node CLI. The desktop app never parses `twin.md` itself —
//! it trusts `twin-md harvest` to write `twin-state.json`. See ARCHITECTURE.md.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{anyhow, Context, Result};
use tokio::process::Command;

/// Climb up from this binary's location to find the monorepo root.
/// `target/debug/twin-desktop` lives inside `apps/desktop/src-tauri/target/debug/`,
/// so the monorepo root is four parents up.
fn monorepo_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut cursor: &Path = exe.as_path();
    for _ in 0..8 {
        cursor = cursor.parent()?;
        let candidate = cursor.join("packages").join("cli").join("dist").join("bin.js");
        if candidate.exists() {
            return Some(cursor.to_path_buf());
        }
    }
    None
}

fn cli_candidates() -> Vec<String> {
    let mut out = vec!["twin-md".to_string()];
    if let Ok(home) = std::env::var("HOME") {
        out.push(format!("{home}/.npm-global/bin/twin-md"));
        out.push(format!("{home}/.volta/bin/twin-md"));
        out.push(format!("{home}/.local/bin/twin-md"));
    }
    if let Some(root) = monorepo_root() {
        let candidate = root
            .join("packages")
            .join("cli")
            .join("dist")
            .join("bin.js");
        out.push(candidate.to_string_lossy().into_owned());
    }
    if let Ok(pwd) = std::env::current_dir() {
        out.push(
            pwd.join("packages")
                .join("cli")
                .join("dist")
                .join("bin.js")
                .to_string_lossy()
                .into_owned(),
        );
    }
    out
}

async fn spawn_cli(args: &[&str]) -> Result<()> {
    let mut last_err: Option<anyhow::Error> = None;
    for bin in cli_candidates() {
        let path = PathBuf::from(&bin);
        let is_absolute = path.is_absolute();
        // Skip absolute paths that don't exist so we try the next candidate fast.
        if is_absolute && !path.exists() {
            continue;
        }
        let runs_as_node = path.extension().and_then(|e| e.to_str()) == Some("js");
        let mut command = if runs_as_node {
            let mut c = Command::new("node");
            c.arg(&bin);
            c
        } else {
            Command::new(&bin)
        };
        command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());

        match command.output().await {
            Ok(out) if out.status.success() => return Ok(()),
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let detail = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    format!("exit {}", out.status)
                };
                last_err = Some(anyhow!("{bin}: {detail}"));
            }
            Err(err) => {
                last_err = Some(err.into());
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow!("no twin-md CLI found")))
}

pub async fn harvest() -> Result<()> {
    spawn_cli(&["harvest"]).await.context("twin-md harvest")
}

pub async fn init(
    species: &str,
    owner: &str,
    obsidian_vault: Option<&str>,
    pet_sprite_variant: Option<&str>,
) -> Result<()> {
    let mut args: Vec<&str> = vec!["init", "--species", species, "--owner", owner];
    if let Some(path) = obsidian_vault {
        args.push("--obsidian-vault");
        args.push(path);
    }
    if let Some("reference") = pet_sprite_variant {
        args.push("--pet-sprite-variant");
        args.push("reference");
    }
    spawn_cli(&args).await.context("twin-md init")?;
    Ok(())
}
