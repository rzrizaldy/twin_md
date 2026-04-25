//! Background removal via [rembg](https://github.com/danielgatis/rembg) CLI (stdin/stdout).
//! Requires `rembg` on PATH, or at common install locations, or `TWIN_REMBG_PATH`.

use anyhow::{anyhow, Result};
use once_cell::sync::OnceCell;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::time::timeout;

static REMBG_PATH: OnceCell<Option<PathBuf>> = OnceCell::new();

/// Resolve `rembg` executable once per process.
pub fn resolve_rembg_binary() -> Option<PathBuf> {
    REMBG_PATH
        .get_or_init(|| {
            if let Ok(p) = std::env::var("TWIN_REMBG_PATH") {
                let pb = PathBuf::from(p.trim());
                if pb.is_file() {
                    return Some(pb);
                }
            }
            if let Ok(p) = which::which("rembg") {
                return Some(p);
            }
            if let Ok(home) = std::env::var("HOME") {
                for rel in [
                    ".local/bin/rembg",
                    "Library/Python/3.13/bin/rembg",
                    "Library/Python/3.12/bin/rembg",
                    "Library/Python/3.11/bin/rembg",
                ] {
                    let cand = PathBuf::from(&home).join(rel);
                    if cand.is_file() {
                        return Some(cand);
                    }
                }
            }
            for fixed in ["/opt/homebrew/bin/rembg", "/usr/local/bin/rembg"] {
                if Path::new(fixed).is_file() {
                    return Some(PathBuf::from(fixed));
                }
            }
            None
        })
        .clone()
}

pub fn is_available() -> bool {
    resolve_rembg_binary().is_some()
}

fn rembg_model() -> String {
    std::env::var("TWIN_REMBG_MODEL").unwrap_or_else(|_| "u2netp".to_string())
}

/// Pipe PNG bytes through `rembg i -m <model> - -` → transparent PNG.
/// On total failure, returns a clear error (callers can surface `rembg_missing:…`).
pub async fn strip_bg(png: Vec<u8>) -> Result<Vec<u8>> {
    let Some(bin) = resolve_rembg_binary() else {
        return Err(anyhow!(rembg_install_hint_err()));
    };
    let model = rembg_model();
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.arg("i");
    cmd.arg("-m");
    cmd.arg(&model);
    cmd.arg("-");
    cmd.arg("-");
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| anyhow!("rembg spawn: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(&png)
            .await
            .map_err(|e| anyhow!("rembg stdin: {e}"))?;
    }

    // First run can download/load the ONNX model, so keep this comfortably above
    // normal per-image runtime while still preventing a permanently hung CLI.
    let out = match timeout(Duration::from_secs(180), child.wait_with_output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Err(anyhow!("rembg wait: {e}")),
        Err(_) => return Err(anyhow!("rembg timed out after 180s")),
    };

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("rembg failed ({}): {}", out.status, err.trim()));
    }
    if out.stdout.is_empty() {
        return Err(anyhow!("rembg returned empty output"));
    }
    Ok(out.stdout)
}

pub fn rembg_install_hint_err() -> String {
    "rembg_missing: run pipx install \"rembg[cpu,cli]\" (or pip install \"rembg[cpu,cli]\"), then restart twin.".to_string()
}
