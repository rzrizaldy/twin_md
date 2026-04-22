//! Helper for opening the web companion in the user's default browser.
//! Honours `TWIN_WEB_URL` env for custom ports / tunneled demos.

use anyhow::{Context, Result};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

pub fn public_web_url() -> String {
    std::env::var("TWIN_WEB_URL").unwrap_or_else(|_| "http://localhost:3000".to_string())
}

pub async fn open_web_companion(app: AppHandle) -> Result<()> {
    let url = public_web_url();
    app.shell()
        .open(url, None)
        .context("open web companion URL")
}
