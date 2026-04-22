//! macOS fatigue signals: idle seconds and frontmost-app switch rate.
//!
//! v1 intentionally uses CLI shell-outs (`ioreg`, `osascript`) instead of
//! objc2 bindings — see PLAN_V2 §8.2. This keeps the crate lean and avoids a
//! Full Disk Access prompt. The richer `knowledgeC.db` path stays a stretch
//! goal behind a `--full-disk` flag.

use std::time::{Duration, Instant};

use parking_lot::Mutex;

#[derive(Debug, Default, Clone)]
pub struct Fatigue {
    pub idle_seconds: f64,
    pub context_switches_per_hour: f64,
    pub last_foreground_app: Option<String>,
}

#[derive(Default)]
pub struct FatigueTracker {
    state: Mutex<FatigueState>,
}

#[derive(Default)]
struct FatigueState {
    last_app: Option<String>,
    window_start: Option<Instant>,
    switches_in_window: u32,
}

impl FatigueTracker {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(target_os = "macos")]
    pub fn sample(&self) -> Fatigue {
        let idle = read_idle_seconds().unwrap_or(0.0);
        let foreground = read_frontmost_app();

        let mut state = self.state.lock();
        let now = Instant::now();
        let window_start = *state.window_start.get_or_insert(now);

        if let Some(app) = foreground.clone() {
            if state.last_app.as_deref() != Some(app.as_str()) {
                state.switches_in_window += 1;
                state.last_app = Some(app);
            }
        }

        let elapsed = now.duration_since(window_start).as_secs_f64().max(1.0);
        let per_hour = (state.switches_in_window as f64) * (3600.0 / elapsed);

        // Reset the window every 15 min so the EMA stays responsive.
        if elapsed > 15.0 * 60.0 {
            state.window_start = Some(now);
            state.switches_in_window = 0;
        }

        Fatigue {
            idle_seconds: idle,
            context_switches_per_hour: per_hour,
            last_foreground_app: foreground,
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn sample(&self) -> Fatigue {
        Fatigue::default()
    }
}

#[cfg(target_os = "macos")]
fn read_idle_seconds() -> Option<f64> {
    use std::process::Command;
    let output = Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("\"HIDIdleTime\" = ") {
            let nanos: f64 = rest.trim().parse().ok()?;
            return Some(nanos / 1_000_000_000.0);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn read_frontmost_app() -> Option<String> {
    use std::process::Command;
    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// Background sampler that updates shared `Fatigue` every 15s.
pub async fn spawn_sampler(tracker: std::sync::Arc<FatigueTracker>) {
    let mut interval = tokio::time::interval(Duration::from_secs(15));
    interval.tick().await; // first tick fires immediately
    loop {
        interval.tick().await;
        let _ = tracker.sample();
    }
}
