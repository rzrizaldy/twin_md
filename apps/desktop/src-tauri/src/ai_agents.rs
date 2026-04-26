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

#[derive(Debug, Clone)]
pub struct LocalMcpWireResult {
    pub agent_name: Option<String>,
    pub agent_path: Option<PathBuf>,
    pub mcp_path: PathBuf,
    pub mcp_config_path: PathBuf,
}

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
    for _ in 0..14 {
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

fn find_monorepo_root() -> Option<PathBuf> {
    let mut starts = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }

    for start in starts {
        let mut cursor = start.as_path();
        for _ in 0..14 {
            if cursor.join("packages").join("mcp").join("package.json").exists()
                && cursor.join("packages").join("core").join("package.json").exists()
            {
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

pub fn mcp_config_json() -> Result<String> {
    let mcp_path = mcp_entrypoint()
        .ok_or_else(|| anyhow!("twin-md MCP dist not found; run `npm run build -w @twin-md/mcp` first"))?;
    Ok(serde_json::json!({
        "mcpServers": {
            "twin-md": {
                "command": "node",
                "args": [mcp_path.to_string_lossy()]
            }
        }
    })
    .to_string())
}

pub fn write_temp_mcp_config() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join("twin-md");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("mcp-config.json");
    std::fs::write(&path, mcp_config_json()?)?;
    Ok(path)
}

pub fn mcp_config_arg_for_cli() -> Result<PathBuf> {
    write_temp_mcp_config()
}

async fn run_npm_build(root: &PathBuf, package: &str) -> Result<()> {
    let output = Command::new("npm")
        .arg("run")
        .arg("build")
        .arg("-w")
        .arg(package)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| anyhow!("spawn npm build for {package}: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("exit {}", output.status)
    };
    Err(anyhow!("npm build failed for {package}: {detail}"))
}

pub async fn build_and_wire_local_mcp() -> Result<LocalMcpWireResult> {
    let root = find_monorepo_root().ok_or_else(|| {
        anyhow!("couldn't find the twin-md monorepo root from the desktop app")
    })?;

    run_npm_build(&root, "@twin-md/core").await?;
    run_npm_build(&root, "@twin-md/brain").await?;
    run_npm_build(&root, "@twin-md/mcp").await?;

    let mcp_path = mcp_entrypoint().ok_or_else(|| {
        anyhow!("MCP build finished but packages/mcp/dist/server.js was not found")
    })?;
    let mcp_config_path = write_temp_mcp_config()?;
    let agent = detect_cli_agent();

    Ok(LocalMcpWireResult {
        agent_name: agent.as_ref().map(|a| a.name().to_string()),
        agent_path: agent.as_ref().map(|a| a.path().clone()),
        mcp_path,
        mcp_config_path,
    })
}

pub fn detect_claude_cli() -> Option<PathBuf> {
    match detect_cli_agent()? {
        CliAgent::Claude(path) => Some(path),
        CliAgent::Codex(_) => None,
    }
}

/// Human-readable readiness for UI surfaces. A CLI alone is not enough; the
/// chat path also needs the bundled twin-md MCP server entrypoint.
pub fn cli_agent_status() -> Option<(String, PathBuf, bool)> {
    let agent = detect_cli_agent()?;
    let mcp_ready = mcp_entrypoint().is_some();
    Some((agent.name().to_string(), agent.path().clone(), mcp_ready))
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
    let mcp_config = mcp_config_arg_for_cli()?;

    let mut cmd = Command::new(agent.path());
    cmd.arg("--mcp-config").arg(mcp_config);

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
