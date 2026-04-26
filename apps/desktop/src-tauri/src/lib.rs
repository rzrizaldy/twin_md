mod ai_agents;
mod chat;
mod commands;
mod context;
mod credentials;
mod harvest;
mod image_gen;
mod ipc;
mod rembg;
mod model;
mod paths;
mod profile;
mod presence;
mod provider;
mod screentime;
mod sprite;
mod state;
mod tray;
mod windows;

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_autostart::MacosLauncher;

use crate::model::Reminder;
use crate::presence::PresenceState;
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
        .manage(PresenceState::new())
        .invoke_handler(tauri::generate_handler![
            ipc::get_state,
            ipc::get_chat_status,
            ipc::install_rembg,
            ipc::get_sprite_evolution,
            ipc::generated_asset_data_url,
            ipc::apply_custom_sprite_preview,
            ipc::apply_sprite_evolution_preview,
            ipc::request_claude_action,
            ipc::list_twin_actions,
            ipc::clear_twin_actions,
            ipc::approve_twin_action,
            ipc::reject_twin_action,
            ipc::open_claude_action_runner,
            ipc::open_terminal_action_approval,
            ipc::dismiss_bubble,
            ipc::trigger_harvest,
            ipc::send_chat,
            ipc::run_local_command,
            ipc::stream_slash_command,
            ipc::validate_provider_key,
            ipc::set_vault_path,
            ipc::get_vault_profile_status,
            ipc::delete_previous_session,
            ipc::load_previous_session,
            ipc::save_vault_profile_ui,
            ipc::run_onboarding,
            ipc::ensure_claude_dir,
            ipc::create_starter_vault,
            ipc::save_provider_credentials,
            ipc::logout_provider_session,
            ipc::list_models,
            // Chat window (Dinoki-style panel)
            ipc::open_chat_window,
            ipc::send_chat_window,
            ipc::save_chat_session,
            // Brain vault writes
            ipc::write_vault_note,
            ipc::log_mood_entry,
            // Image generation
            ipc::generate_image,
            ipc::regenerate_sprite,
            ipc::generate_sprite_preview,
            ipc::generate_sprite_preview_from_photo,
            ipc::generate_sprite_evolution_preview,
            ipc::generate_chat_background,
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
            // Evolutionary sprite when mood or environment changes.
            let h_sprite = handle.clone();
            let _ = handle.clone().listen("twin://state-changed", move |e| {
                let h = h_sprite.clone();
                if let Ok(state) = serde_json::from_str::<crate::model::PetState>(e.payload()) {
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::sprite::on_pet_state_changed(&h, state).await;
                    });
                }
            });


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

            // Presence sampler — gates bubble emission on active user.
            let presence = app.state::<Arc<PresenceState>>().inner().clone();
            presence::spawn_sampler(handle.clone(), presence);

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
            let presence = app.state::<Arc<PresenceState>>().inner().clone();
            if presence.can_emit() {
                // If the dedicated chat window is open, seed it instead of
                // spawning a separate bubble window (Dinoki-style proactive nudge).
                if app.get_webview_window("chat").is_some() {
                    let _ = app.emit("twin://cw-seed", &reminder.body);
                }
                // Always spawn the bubble too (visible on companion window).
                if let Err(err) = windows::spawn_bubble(&app, &reminder) {
                    eprintln!("[twin] bubble spawn failed: {err:?}");
                }
            } else {
                presence.enqueue(reminder);
            }
        }
    });
}
