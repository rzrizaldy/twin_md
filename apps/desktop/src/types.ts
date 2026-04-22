export type TwinSpecies = "axolotl" | "cat" | "slime";
export type TwinMood = "healthy" | "sleep_deprived" | "stressed" | "neglected";
export type TwinEnvironment =
  | "sunny_island"
  | "stars_at_noon"
  | "storm_room"
  | "grey_nook";
export type TwinAnimation = "dancing" | "yawning" | "pacing" | "sitting";
export type BubbleTone = "soft" | "groggy" | "clipped" | "quiet";

export interface PetState {
  species: TwinSpecies;
  state: TwinMood;
  energy: number;
  stress: number;
  glow: number;
  environment: TwinEnvironment;
  animation: TwinAnimation;
  caption: string;
  scene: string;
  message: string;
  reason: string[];
  updated: string;
  sourceUpdated: string;
  color: string;
}

export interface Reminder {
  id: string;
  tone: BubbleTone;
  title: string;
  body: string;
  firedAt: string;
}

export const BUBBLE_FOR_MOOD: Record<TwinMood, BubbleTone> = {
  healthy: "soft",
  sleep_deprived: "groggy",
  stressed: "clipped",
  neglected: "quiet"
};
