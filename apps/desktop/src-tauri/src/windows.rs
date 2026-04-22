use anyhow::{Context, Result};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::model::{BubbleTone, Reminder};

pub fn show_companion(app: &AppHandle) -> Result<()> {
    if let Some(win) = app.get_webview_window("companion") {
        win.show().ok();
        win.set_focus().ok();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "companion", WebviewUrl::App("index.html".into()))
        .title("twin")
        .inner_size(320.0, 320.0)
        .min_inner_size(240.0, 240.0)
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

pub fn open_chat_window(app: &AppHandle) -> Result<()> {
    if let Some(win) = app.get_webview_window("chat") {
        win.show().ok();
        win.set_focus().ok();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "chat", WebviewUrl::App("chat.html".into()))
        .title("twin · chat")
        .inner_size(420.0, 540.0)
        .min_inner_size(360.0, 420.0)
        .resizable(true)
        .visible(true)
        .build()
        .context("build chat window")?;
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
    .inner_size(560.0, 620.0)
    .resizable(false)
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
