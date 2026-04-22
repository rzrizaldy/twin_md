use std::sync::atomic::{AtomicI64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::time;

use crate::model::Reminder;
use crate::windows;

const IDLE_THRESHOLD_SECS: u64 = 180; // 3 minutes
const QUEUE_MAX_AGE_SECS: i64 = 15 * 60;
const SAMPLE_INTERVAL_SECS: u64 = 10;
const FLUSH_STAGGER_MS: u64 = 2_000;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presence {
    Active = 0,
    Idle = 1,
    Locked = 2,
    Busy = 3,
}

impl Presence {
    fn from_u8(value: u8) -> Self {
        match value {
            1 => Presence::Idle,
            2 => Presence::Locked,
            3 => Presence::Busy,
            _ => Presence::Active,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Presence::Active => "active",
            Presence::Idle => "idle",
            Presence::Locked => "locked",
            Presence::Busy => "busy",
        }
    }
}

#[derive(Debug, Clone)]
struct QueuedReminder {
    reminder: Reminder,
    queued_at_epoch_s: i64,
    presence_status: Presence,
}

#[derive(Default)]
pub struct PresenceState {
    current: AtomicU8,
    last_transition_epoch_s: AtomicI64,
    queue: Mutex<Vec<QueuedReminder>>,
}

impl PresenceState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn current(&self) -> Presence {
        Presence::from_u8(self.current.load(Ordering::Relaxed))
    }

    fn set(&self, next: Presence) -> Option<(Presence, Presence)> {
        let prev = Presence::from_u8(self.current.swap(next as u8, Ordering::Relaxed));
        if prev == next {
            return None;
        }
        self.last_transition_epoch_s
            .store(now_epoch_s(), Ordering::Relaxed);
        Some((prev, next))
    }

    pub fn can_emit(&self) -> bool {
        matches!(self.current(), Presence::Active)
    }

    pub fn enqueue(&self, reminder: Reminder) {
        let mut queue = self.queue.lock();
        queue.push(QueuedReminder {
            reminder,
            queued_at_epoch_s: now_epoch_s(),
            presence_status: self.current(),
        });
    }

    fn drain_fresh(&self) -> Vec<Reminder> {
        let now = now_epoch_s();
        let mut queue = self.queue.lock();
        let (fresh, _stale): (Vec<_>, Vec<_>) = queue
            .drain(..)
            .partition(|entry| now - entry.queued_at_epoch_s <= QUEUE_MAX_AGE_SECS);
        fresh.into_iter().map(|entry| entry.reminder).collect()
    }
}

/// Start the sampler loop. Runs every `SAMPLE_INTERVAL_SECS` and emits
/// `twin://presence-changed` on every transition.
pub fn spawn_sampler(app: AppHandle, state: Arc<PresenceState>) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(SAMPLE_INTERVAL_SECS));
        ticker.tick().await; // first tick completes immediately
        loop {
            let next = sample().await;
            if let Some((prev, now)) = state.set(next) {
                let _ = app.emit(
                    "twin://presence-changed",
                    serde_json::json!({
                        "from": prev.as_str(),
                        "to": now.as_str(),
                    }),
                );
                if now == Presence::Active && matches!(prev, Presence::Idle | Presence::Locked) {
                    flush_queue(app.clone(), state.clone());
                }
            }
            ticker.tick().await;
        }
    });
}

fn flush_queue(app: AppHandle, state: Arc<PresenceState>) {
    tauri::async_runtime::spawn(async move {
        let queued = state.drain_fresh();
        for reminder in queued {
            if let Err(err) = windows::spawn_bubble(&app, &reminder) {
                eprintln!("[twin] bubble spawn (flush) failed: {err:?}");
            }
            time::sleep(Duration::from_millis(FLUSH_STAGGER_MS)).await;
        }
    });
}

async fn sample() -> Presence {
    if screen_is_locked().await {
        return Presence::Locked;
    }
    if do_not_disturb_on().await {
        return Presence::Busy;
    }
    let idle = idle_seconds().await.unwrap_or(0);
    if idle >= IDLE_THRESHOLD_SECS {
        Presence::Idle
    } else {
        Presence::Active
    }
}

#[cfg(target_os = "macos")]
async fn idle_seconds() -> Option<u64> {
    // Shell out to ioreg (matches the team's existing "no objc2" stance; see Cargo.toml §target macos).
    let output = Command::new("sh")
        .arg("-c")
        .arg("ioreg -c IOHIDSystem | awk '/HIDIdleTime/ { print $NF; exit }'")
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let nanos: u128 = raw.trim().parse().ok()?;
    Some((nanos / 1_000_000_000) as u64)
}

#[cfg(target_os = "macos")]
async fn screen_is_locked() -> bool {
    // The console-user dict has `CGSSessionScreenIsLocked = 1` when locked.
    let script = "ioreg -n Root -d1 -a 2>/dev/null | \
                  plutil -extract IOConsoleUsers xml1 -o - - 2>/dev/null | \
                  grep -c 'CGSSessionScreenIsLocked</key><true/>'";
    let output = match Command::new("sh").arg("-c").arg(script).output().await {
        Ok(o) => o,
        Err(_) => return false,
    };
    String::from_utf8_lossy(&output.stdout).trim() != "0"
}

#[cfg(target_os = "macos")]
async fn do_not_disturb_on() -> bool {
    // Focus modes landed in macOS 12; the cached prefs live under
    // ~/Library/DoNotDisturb/DB/Assertions.json. A non-empty `data` array means
    // *some* focus is active. We treat any active focus as "busy".
    let script = "/bin/cat \"$HOME/Library/DoNotDisturb/DB/Assertions.json\" 2>/dev/null | \
                  python3 -c 'import json,sys;\
d=json.load(sys.stdin);\
print(1 if any(d.get(\"data\",[])) else 0)' 2>/dev/null";
    let output = match Command::new("sh").arg("-c").arg(script).output().await {
        Ok(o) => o,
        Err(_) => return false,
    };
    String::from_utf8_lossy(&output.stdout).trim() == "1"
}

#[cfg(not(target_os = "macos"))]
async fn idle_seconds() -> Option<u64> {
    None
}

#[cfg(not(target_os = "macos"))]
async fn screen_is_locked() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
async fn do_not_disturb_on() -> bool {
    false
}

fn now_epoch_s() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
