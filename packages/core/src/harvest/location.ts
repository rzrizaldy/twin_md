import type { TwinConfig } from "../config.js";
import type { TwinSection } from "../schema.js";
import { numberFromUnknown, pickDeepValue, safeReadJson } from "./shared.js";

export async function harvestLocationSignals(
  config: TwinConfig
): Promise<TwinSection> {
  const data = await safeReadJson<Record<string, unknown>>(config.locationPath);
  if (!data) {
    return {
      home_ratio_7d: "unknown",
      novelty_score: "unknown"
    };
  }

  const homeRatio = pickDeepValue(data, ["home_ratio_7d", "homeRatio7d"]);
  const novelty = pickDeepValue(data, ["novelty_score", "noveltyScore"]);

  const homeRatioNumeric = numberFromUnknown(homeRatio);
  const noveltyNumeric = numberFromUnknown(novelty);

  return {
    home_ratio_7d:
      homeRatioNumeric > 0
        ? Number(homeRatioNumeric.toFixed(2))
        : typeof homeRatio === "string"
          ? homeRatio
          : "unknown",
    novelty_score:
      typeof novelty === "string" && novelty.trim()
        ? novelty
        : noveltyNumeric >= 0.66
          ? "high"
          : noveltyNumeric >= 0.33
            ? "medium"
            : noveltyNumeric > 0
              ? "low"
              : "unknown"
  };
}
