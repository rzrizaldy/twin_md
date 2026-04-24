use anyhow::Result;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tauri_plugin_autostart::ManagerExt;

use crate::windows;

pub fn install(app: &AppHandle) -> Result<()> {
    let summon = MenuItem::with_id(app, "summon", "summon twin", true, None::<&str>)?;
    let open_chat = MenuItem::with_id(app, "open_chat", "open chat", true, None::<&str>)?;
    let harvest = MenuItem::with_id(app, "harvest", "harvest now", true, None::<&str>)?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        "launch at login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "quit twin", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &summon,
            &open_chat,
            &harvest,
            &separator,
            &autostart_item,
            &separator,
            &quit,
        ],
    )?;

    let _tray = TrayIconBuilder::with_id("twin-tray")
        .tooltip("twin")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "summon" => {
                let _ = windows::show_companion(app);
            }
            "open_chat" => {
                let _ = windows::show_chat(app);
            }
            "harvest" => {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = crate::harvest::harvest().await {
                        eprintln!("[twin] harvest failed: {err:?}");
                    }
                    // Re-emit current state after harvest.
                    if let Ok(Some(next)) = crate::state::read_state_file() {
                        if let Some(shared) = app_clone.try_state::<crate::state::SharedState>() {
                            shared.set(next.clone());
                        }
                        let _ = tauri::Emitter::emit(&app_clone, "twin://state-changed", next);
                    }
                });
            }
            "autostart" => {
                let enabled = app.autolaunch().is_enabled().unwrap_or(false);
                let _ = if enabled {
                    app.autolaunch().disable()
                } else {
                    app.autolaunch().enable()
                };
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
