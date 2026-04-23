//! CLI-agent subprocess integration — Tolaria B5 pattern.
//!
//! Instead of storing API keys ourselves, we try to spawn the user's installed
//! `claude` or `codex` CLI with our MCP server injected as a stdio tool.
//! Fall back to direct API-key chat only when neither CLI is detected.

use std::path::PathBuf;
use std::process::Stdio;

use anyhow::{anyhow, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliAgent {
    Claude(PathBuf),
    Codex(PathBuf),
}

impl CliAgent {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Claude(_) => "claude",
            Self::Codex(_) => "codex",
        }
    }

    pub fn path(&self) -> &PathBuf {
        match self {
            Self::Claude(p) | Self::Codex(p) => p,
        }
    }
}

/// Probe common install locations for `claude` and `codex` CLIs.
/// Returns the first one found in preference order: claude → codex.
pub fn detect_cli_agent() -> Option<CliAgent> {
    let home = std::env::var("HOME").ok().unwrap_or_default();

    let claude_candidates = [
        "claude".to_string(),
        format!("{home}/.npm-global/bin/claude"),
        format!("{home}/.volta/bin/claude"),
        format!("{home}/.local/bin/claude"),
        "/usr/local/bin/claude".to_string(),
        "/opt/homebrew/bin/claude".to_string(),
    ];

    let codex_candidates = [
        "codex".to_string(),
        format!("{home}/.npm-global/bin/codex"),
        format!("{home}/.volta/bin/codex"),
        format!("{home}/.local/bin/codex"),
        "/usr/local/bin/codex".to_string(),
        "/opt/homebrew/bin/codex".to_string(),
    ];

    for name in &claude_candidates {
        if let Some(p) = resolve_bin(name) {
            return Some(CliAgent::Claude(p));
        }
    }
    for name in &codex_candidates {
        if let Some(p) = resolve_bin(name) {
            return Some(CliAgent::Codex(p));
        }
    }
    None
}

fn resolve_bin(name: &str) -> Option<PathBuf> {
    let p = PathBuf::from(name);
    if p.is_absolute() {
        return if p.exists() { Some(p) } else { None };
    }
    // Try `which`-style resolution for short names
    std::env::var("PATH")
        .ok()?
        .split(':')
        .map(|dir| PathBuf::from(dir).join(name))
        .find(|p| p.exists())
}

/// Resolve the path to the MCP entrypoint for twin-md.
/// Mirrors the logic in harvest.rs — climbs from the binary to find dist/mcp.js.
fn mcp_entrypoint() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut cursor = exe.as_path();
    for _ in 0..8 {
        cursor = cursor.parent()?;
        let candidate = cursor
            .join("packages")
            .join("mcp")
            .join("dist")
            .join("server.js");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Spawn the CLI agent with the twin-md MCP server wired in via `--mcp-config`.
/// Streams stdout line-by-line; each line is emitted as a chat token.
/// Returns an error immediately if no MCP entrypoint is found — the caller
/// falls back to API-key chat in that case.
pub async fn stream_via_cli(
    agent: &CliAgent,
    prompt: &str,
    on_token: impl Fn(String) + Send + 'static,
) -> Result<()> {
    let mcp_path = mcp_entrypoint()
        .ok_or_else(|| anyhow!("twin-md MCP dist not found; run `pnpm build` first"))?;

    // Build the inline MCP config JSON that both `claude` and `codex` accept
    // via their `--mcp-config` flag.
    let mcp_json = serde_json::json!({
        "mcpServers": {
            "twin-md": {
                "command": "node",
                "args": [mcp_path.to_string_lossy()]
            }
        }
    })
    .to_string();

    let mut cmd = Command::new(agent.path());
    cmd.arg("--mcp-config").arg(&mcp_json);

    match agent {
        CliAgent::Claude(_) => {
            cmd.arg("--print");
            cmd.arg(prompt);
        }
        CliAgent::Codex(_) => {
            cmd.arg("--quiet");
            cmd.arg(prompt);
        }
    }

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| anyhow!("spawn {}: {e}", agent.name()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("no stdout from {}", agent.name()))?;

    let mut reader = BufReader::new(stdout).lines();
    while let Some(line) = reader.next_line().await? {
        if !line.is_empty() {
            on_token(line + "\n");
        }
    }

    let status = child.wait().await?;
    if !status.success() {
        return Err(anyhow!(
            "{} exited with code {}",
            agent.name(),
            status.code().unwrap_or(-1)
        ));
    }

    Ok(())
}
