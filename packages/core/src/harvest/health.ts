import type { TwinConfig } from "../config.js";
import type { TwinSection } from "../schema.js";
import {
  formatHoursAndMinutes,
  numberFromUnknown,
  pickDeepValue,
  safeReadJson
} from "./shared.js";

export async function harvestHealthSignals(
  config: TwinConfig
): Promise<TwinSection> {
  const data = await safeReadJson<Record<string, unknown>>(config.healthPath);

  if (!data) {
    return {
      sleep_last_night: "unknown",
      sleep_7d_avg: "unknown",
      steps_today: 0,
      hrv_7d: "unknown",
      workouts_7d: 0
    };
  }

  const sleepLastNightMinutes = numberFromUnknown(
    pickDeepValue(data, ["sleep_last_night_minutes", "sleepLastNightMinutes", "sleep_last_night"])
  );
  const sleep7dMinutes = numberFromUnknown(
    pickDeepValue(data, ["sleep_7d_avg_minutes", "sleep7dAvgMinutes", "sleep_7d_avg"])
  );
  const stepsToday = numberFromUnknown(
    pickDeepValue(data, ["steps_today", "stepsToday", "step_count_today"])
  );
  const hrv7dValue = pickDeepValue(data, ["hrv_7d", "hrv7d", "heart_rate_variability"]);
  const workouts7d = numberFromUnknown(
    pickDeepValue(data, ["workouts_7d", "workouts7d", "workout_count_7d"])
  );

  return {
    sleep_last_night: sleepLastNightMinutes
      ? formatHoursAndMinutes(sleepLastNightMinutes)
      : "unknown",
    sleep_7d_avg: sleep7dMinutes ? formatHoursAndMinutes(sleep7dMinutes) : "unknown",
    steps_today: stepsToday,
    hrv_7d:
      typeof hrv7dValue === "string" && hrv7dValue.trim()
        ? hrv7dValue
        : numberFromUnknown(hrv7dValue) || "unknown",
    workouts_7d: workouts7d
  };
}
