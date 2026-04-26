use anyhow::{Context, Result};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::model::{BubbleTone, Reminder};

pub fn show_companion(app: &AppHandle) -> Result<()> {
    if let Some(win) = app.get_webview_window("companion") {
        win.show().ok();
        win.set_focus().ok();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "companion", WebviewUrl::App("index.html".into()))
        .title("twin")
        .inner_size(320.0, 520.0)
        .min_inner_size(240.0, 360.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(false)
        .accept_first_mouse(true)
        .visible(true)
        .build()
        .context("build companion window")?;
    Ok(())
}

pub fn open_onboarding(app: &AppHandle) -> Result<()> {
    if let Some(win) = app.get_webview_window("onboarding") {
        win.show().ok();
        win.set_focus().ok();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        "onboarding",
        WebviewUrl::App("onboarding.html".into()),
    )
    .title("meet your twin")
    .inner_size(560.0, 640.0)
    .resizable(true)
    .min_inner_size(400.0, 420.0)
    .center()
    .visible(true)
    .build()
    .context("build onboarding window")?;
    Ok(())
}

pub fn spawn_bubble(app: &AppHandle, reminder: &Reminder) -> Result<()> {
    let label = format!("bubble-{}", sanitize_label(&reminder.id));
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    let tone = match &reminder.tone {
        BubbleTone::Soft => "soft",
        BubbleTone::Groggy => "groggy",
        BubbleTone::Clipped => "clipped",
        BubbleTone::Quiet => "quiet",
    };

    // Position bubble above the companion if it exists.
    let (x, y) = companion_bubble_anchor(app).unwrap_or((80.0, 80.0));

    let url = format!(
        "bubble.html?id={id}&tone={tone}&body={body}",
        id = urlencoding::encode(&reminder.id),
        tone = tone,
        body = urlencoding::encode(&reminder.body),
    );

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("twin · nudge")
        .inner_size(320.0, 160.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .position(x, y)
        .visible(true)
        .build()
        .context("build bubble window")?;
    Ok(())
}

fn sanitize_label(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect()
}

// ── Dedicated chat window ──────────────────────────────────────────────────

const CHAT_LABEL: &str = "chat";

/// Open the dedicated chat window, creating it if it doesn't exist yet.
pub fn show_chat(app: &AppHandle) -> Result<()> {
    show_chat_inner(app, None, None)
}

/// Open the dedicated chat window and pre-seed it with a message.
/// If the window is already open it is focused and the seed is emitted.
pub fn show_chat_with_seed(app: &AppHandle, seed: &str) -> Result<()> {
    show_chat_inner(app, Some(seed.to_string()), None)
}

/// Open the dedicated chat window and show a first assistant intro.
pub fn show_chat_with_intro(app: &AppHandle, intro: &str) -> Result<()> {
    show_chat_inner(app, None, Some(intro.to_string()))
}

fn show_chat_inner(app: &AppHandle, seed: Option<String>, intro: Option<String>) -> Result<()> {
    if let Some(win) = app.get_webview_window(CHAT_LABEL) {
        win.show().ok();
        win.set_focus().ok();
        if let Some(msg) = seed {
            let _ = app.emit("twin://cw-seed", msg);
        }
        if let Some(msg) = intro {
            let _ = app.emit("twin://cw-intro", msg);
        }
        return Ok(());
    }
    WebviewWindowBuilder::new(app, CHAT_LABEL, WebviewUrl::App("chat.html".into()))
        .title("twin · chat")
        .inner_size(520.0, 700.0)
        .min_inner_size(400.0, 480.0)
        .resizable(true)
        .decorations(true)
        .skip_taskbar(false)
        .center()
        .visible(true)
        .build()
        .context("build chat window")?;

    if let Some(msg) = seed {
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = app2.emit("twin://cw-seed", msg);
        });
    }
    if let Some(msg) = intro {
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = app2.emit("twin://cw-intro", msg);
        });
    }
    Ok(())
}

fn companion_bubble_anchor(app: &AppHandle) -> Option<(f64, f64)> {
    let win = app.get_webview_window("companion")?;
    let pos = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    let scale = win.scale_factor().ok()?;
    // Anchor above and slightly right of the companion.
    let x = pos.x as f64 / scale + size.width as f64 / scale - 200.0;
    let y = (pos.y as f64 / scale - 160.0).max(20.0);
    Some((x, y))
}
