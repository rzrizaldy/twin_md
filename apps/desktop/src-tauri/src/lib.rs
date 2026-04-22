mod chat;
mod context;
mod harvest;
mod ipc;
mod model;
mod paths;
mod screentime;
mod state;
mod tray;
mod windows;

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_autostart::MacosLauncher;

use crate::model::Reminder;
use crate::screentime::FatigueTracker;
use crate::state::SharedState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = windows::show_companion(&app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SharedState::default())
        .manage(Arc::new(FatigueTracker::new()))
        .invoke_handler(tauri::generate_handler![
            ipc::get_state,
            ipc::get_chat_status,
            ipc::dismiss_bubble,
            ipc::open_chat,
            ipc::trigger_harvest,
            ipc::send_chat,
            ipc::run_onboarding,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let shared = app.state::<SharedState>().inner().clone();

            // Seed with whatever's on disk.
            if let Ok(Some(state)) = state::read_state_file() {
                shared.set(state.clone());
                let _ = handle.emit("twin://state-changed", state);
            }

            // File watchers for state + reminders.
            state::spawn_watchers(handle.clone(), shared.clone());

            // Tray + menu.
            if let Err(err) = tray::install(&handle) {
                eprintln!("[twin] tray install failed: {err:?}");
            }

            // Bubble spawner — every reminder event materializes a window.
            register_reminder_listener(handle.clone());

            // Fatigue sampler.
            let fatigue = app.state::<Arc<FatigueTracker>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                screentime::spawn_sampler(fatigue).await;
            });

            // Always boot into onboarding — the companion summons itself once
            // the user hits "summon my twin" (see ipc::run_onboarding).
            windows::open_onboarding(&handle)?;

            // Warm the companion in the background so it's ready to show
            // immediately after onboarding completes.
            tauri::async_runtime::spawn(async {
                let _ = harvest::harvest().await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start twin desktop");
}

fn register_reminder_listener(handle: AppHandle) {
    let app = handle.clone();
    handle.listen("twin://reminder", move |event| {
        let payload = event.payload();
        if let Ok(reminder) = serde_json::from_str::<Reminder>(payload) {
            if let Err(err) = windows::spawn_bubble(&app, &reminder) {
                eprintln!("[twin] bubble spawn failed: {err:?}");
            }
        }
    });
}
