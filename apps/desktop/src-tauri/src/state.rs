use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use notify::{recommended_watcher, EventKind, RecursiveMode, Watcher};
use parking_lot::RwLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::unbounded_channel;

use crate::model::{PetState, Reminder};
use crate::paths::{twin_reminders_path, twin_state_path};

#[derive(Clone, Default)]
pub struct SharedState {
    inner: Arc<RwLock<Option<PetState>>>,
}

impl SharedState {
    pub fn get(&self) -> Option<PetState> {
        self.inner.read().clone()
    }

    pub fn set(&self, value: PetState) {
        *self.inner.write() = Some(value);
    }
}

pub fn read_state_file() -> Result<Option<PetState>> {
    let path = twin_state_path();
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)
        .with_context(|| format!("read {}", path.display()))?;
    if bytes.is_empty() {
        return Ok(None);
    }
    let state: PetState = serde_json::from_slice(&bytes)
        .with_context(|| format!("parse {}", path.display()))?;
    Ok(Some(state))
}

/// Watch `~/.claude/twin-state.json` and the reminders log, re-emit on change.
pub fn spawn_watchers(app: AppHandle, shared: SharedState) {
    let claude_dir = twin_state_path()
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    if !claude_dir.exists() {
        return;
    }

    std::thread::spawn(move || {
        if let Err(err) = run_watcher(app, shared, claude_dir) {
            eprintln!("[twin] state watcher stopped: {err:?}");
        }
    });
}

fn run_watcher(app: AppHandle, shared: SharedState, dir: PathBuf) -> Result<()> {
    let (tx, mut rx) = unbounded_channel::<()>();

    let mut watcher = recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let _ = tx.send(());
        }
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    let state_file = twin_state_path();
    let reminders_file = twin_reminders_path();
    let mut last_reminder_len: u64 = reminders_file
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);

    if let Ok(Some(initial)) = read_state_file() {
        shared.set(initial.clone());
        let _ = app.emit("twin://state-changed", initial);
    }

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    runtime.block_on(async move {
        let mut last_state_mtime: Option<std::time::SystemTime> = state_file
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok());

        while let Some(()) = rx.recv().await {
            // Debounce: give multi-write saves time to settle.
            tokio::time::sleep(Duration::from_millis(120)).await;
            while rx.try_recv().is_ok() {}

            // twin-state.json
            if let Ok(meta) = state_file.metadata() {
                let mtime = meta.modified().ok();
                if mtime != last_state_mtime {
                    last_state_mtime = mtime;
                    if let Ok(Some(next)) = read_state_file() {
                        shared.set(next.clone());
                        let _ = app.emit("twin://state-changed", next);
                    }
                }
            }

            // twin-reminders.jsonl append
            if let Ok(meta) = reminders_file.metadata() {
                if meta.len() != last_reminder_len {
                    if let Ok(new_last) =
                        tail_new_reminders(&reminders_file, last_reminder_len, &app)
                    {
                        last_reminder_len = new_last;
                    }
                }
            }
        }
    });

    // Hold the watcher for the life of the thread.
    drop(watcher);
    Ok(())
}

fn tail_new_reminders(path: &PathBuf, from: u64, app: &AppHandle) -> Result<u64> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    let meta = file.metadata()?;
    if meta.len() < from {
        return Ok(meta.len());
    }
    file.seek(SeekFrom::Start(from))?;
    let mut buf = String::new();
    file.read_to_string(&mut buf)?;
    for line in buf.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(reminder) = serde_json::from_str::<Reminder>(trimmed) {
            let _ = app.emit("twin://reminder", reminder);
        }
    }
    Ok(meta.len())
}
