// Resume Match labels. Claude scores how well the selected resume shows the fit; code only bands it. Pure.
import { MATCH_BANDS } from "./constants";
import type { MatchBand } from "../types";

export function matchBand(total: number): MatchBand {
  if (total >= MATCH_BANDS.strong) return "strong";
  if (total >= MATCH_BANDS.moderate) return "moderate";
  return "weak";
}

export const MATCH_BAND_LABEL: Record<MatchBand, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
};
