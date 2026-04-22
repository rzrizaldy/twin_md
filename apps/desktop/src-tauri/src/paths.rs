use std::path::PathBuf;

/// The twin-md shared state directory under `~/.claude/`.
pub fn claude_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("TWIN_CLAUDE_DIR") {
        return PathBuf::from(custom);
    }
    let home = directories::UserDirs::new()
        .and_then(|u| Some(u.home_dir().to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".claude")
}

pub fn twin_state_path() -> PathBuf {
    claude_dir().join("twin-state.json")
}

pub fn twin_md_path() -> PathBuf {
    claude_dir().join("twin.md")
}

pub fn twin_reminders_path() -> PathBuf {
    claude_dir().join("twin-reminders.jsonl")
}

pub fn twin_config_path() -> PathBuf {
    claude_dir().join("twin.config.json")
}

pub fn twin_companion_path() -> PathBuf {
    claude_dir().join("twin.companion.json")
}
