use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Species {
    Axolotl,
    Cat,
    Slime,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Mood {
    Healthy,
    SleepDeprived,
    Stressed,
    Neglected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Environment {
    SunnyIsland,
    StarsAtNoon,
    StormRoom,
    GreyNook,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Animation {
    Dancing,
    Yawning,
    Pacing,
    Sitting,
}

/// Mirrors the PetState written by `@twin-md/core`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetState {
    pub species: Species,
    pub state: Mood,
    pub energy: u8,
    pub stress: u8,
    pub glow: u8,
    pub environment: Environment,
    pub animation: Animation,
    pub caption: String,
    pub scene: String,
    pub message: String,
    pub reason: Vec<String>,
    pub updated: String,
    #[serde(rename = "sourceUpdated")]
    pub source_updated: String,
    #[serde(default)]
    pub ascii: String,
    #[serde(default)]
    pub svg: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BubbleTone {
    Soft,
    Groggy,
    Clipped,
    Quiet,
}

impl From<&Mood> for BubbleTone {
    fn from(mood: &Mood) -> Self {
        match mood {
            Mood::Healthy => BubbleTone::Soft,
            Mood::SleepDeprived => BubbleTone::Groggy,
            Mood::Stressed => BubbleTone::Clipped,
            Mood::Neglected => BubbleTone::Quiet,
        }
    }
}

impl BubbleTone {
    pub fn as_slug(&self) -> &'static str {
        match self {
            BubbleTone::Soft => "soft",
            BubbleTone::Groggy => "groggy",
            BubbleTone::Clipped => "clipped",
            BubbleTone::Quiet => "quiet",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub tone: BubbleTone,
    pub title: String,
    pub body: String,
    #[serde(rename = "firedAt")]
    pub fired_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompanionPrefs {
    pub position: Option<(i32, i32)>,
    pub launch_at_login: bool,
}
