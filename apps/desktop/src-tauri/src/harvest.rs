//! Shell-out to the Node CLI. The desktop app never parses `twin.md` itself —
//! it trusts `twin-md harvest` to write `twin-state.json`. See ARCHITECTURE.md.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{anyhow, Context, Result};
use tokio::process::Command;

fn is_monorepo_root(path: &Path) -> bool {
    path.join("packages").join("cli").join("dist").join("bin.js").exists()
        && path.join("packages").join("core").join("package.json").exists()
}

/// Release builds run from /Applications/twin.app, so parent walking alone does
/// not find the source checkout. Prefer the explicit env override, then common
/// local checkout locations, then fall back to executable/current-dir parents.
fn monorepo_root() -> Option<PathBuf> {
    let mut starts = Vec::new();
    if let Ok(repo) = std::env::var("TWIN_MD_REPO") {
        starts.push(PathBuf::from(repo));
    }
    if let Ok(home) = std::env::var("HOME") {
        starts.push(PathBuf::from(&home).join("CodeFolder").join("twin_md"));
        starts.push(PathBuf::from(&home).join("CodeFolder").join("twin-md"));
        starts.push(PathBuf::from(&home).join("twin_md"));
        starts.push(PathBuf::from(&home).join("twin-md"));
    }
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(pwd) = std::env::current_dir() {
        starts.push(pwd);
    }

    for start in starts {
        let mut cursor: &Path = start.as_path();
        for _ in 0..14 {
            if is_monorepo_root(cursor) {
                return Some(cursor.to_path_buf());
            }
            let Some(parent) = cursor.parent() else {
                break;
            };
            cursor = parent;
        }
    }
    None
}

fn resolve_bin(name: &str, extra_candidates: &[&str]) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PATH") {
        if let Some(found) = path
            .split(':')
            .map(|dir| PathBuf::from(dir).join(name))
            .find(|candidate| candidate.exists())
        {
            return Some(found);
        }
    }
    extra_candidates
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.exists())
}

fn resolve_node() -> PathBuf {
    let home = std::env::var("HOME").ok().unwrap_or_default();
    let candidates = [
        format!("{home}/.volta/bin/node"),
        format!("{home}/.npm-global/bin/node"),
        format!("{home}/.local/bin/node"),
        "/usr/local/bin/node".to_string(),
        "/opt/homebrew/bin/node".to_string(),
    ];
    let refs: Vec<&str> = candidates.iter().map(String::as_str).collect();
    resolve_bin("node", &refs).unwrap_or_else(|| PathBuf::from("node"))
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
            let mut c = Command::new(resolve_node());
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
) -> Result<()> {
    let mut args: Vec<&str> = vec!["init", "--species", species, "--owner", owner];
    if let Some(path) = obsidian_vault {
        args.push("--obsidian-vault");
        args.push(path);
    }
    spawn_cli(&args).await.context("twin-md init")?;
    Ok(())
}
