import type { ResumeRecommendation } from "./types";

/** Present historical recommendations through the current two-choice workflow without rewriting records. */
export function currentRecommendation(
  recommendation: Pick<ResumeRecommendation, "kind" | "reason">,
): ResumeRecommendation {
  const kind =
    recommendation.kind === "tailor" || recommendation.kind === "light-tailor"
      ? "tailor"
      : "use-master";
  return {
    kind,
    text: kind === "tailor" ? "Tailor" : "Use Master",
    reason: recommendation.reason,
  };
}
