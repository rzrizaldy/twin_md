//! Open the web mirror in the system browser.
//!
//! Order: `TWIN_WEB_URL` if set → else local web-lite (`http://127.0.0.1:4730/`) when
//! `state.json` responds → else GitHub Pages project site.

use anyhow::{Context, Result};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

const WEB_LITE_BASE: &str = "http://127.0.0.1:4730/";
const LANDING_FALLBACK: &str = "https://rzrizaldy.github.io/twin_md/";

pub fn public_web_url() -> String {
    std::env::var("TWIN_WEB_URL").unwrap_or_else(|_| WEB_LITE_BASE.to_string())
}

async fn web_lite_reachable() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(700))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let url = format!("{WEB_LITE_BASE}state.json");
    match client.get(url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

async fn resolve_open_url() -> String {
    if let Ok(url) = std::env::var("TWIN_WEB_URL") {
        if !url.trim().is_empty() {
            return url;
        }
    }
    if web_lite_reachable().await {
        WEB_LITE_BASE.to_string()
    } else {
        LANDING_FALLBACK.to_string()
    }
}

pub async fn open_web_companion(app: AppHandle) -> Result<()> {
    let url = resolve_open_url().await;
    app.shell()
        .open(url, None)
        .context("open web companion URL")
}
