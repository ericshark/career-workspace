// Candidate Fit labels and verdicts follow the score; the workspace owner checks eligibility himself.
import { FIT_BANDS } from "./constants";
import type {
  Blockers,
  ClaudeBlocker,
  FitBand,
  FitScore,
  Verdict,
} from "../types";

/** Keep incoming legacy blocker notes readable without letting them override a new review. */
export function classifyBlockers(
  blockers: ClaudeBlocker[],
  _jobPost: string,
): Blockers {
  return {
    confirmed: [],
    check: blockers.map((b) => ({
      ...b,
      reason:
        "Eligibility is checked by the workspace owner; review does not screen eligibility",
    })),
  };
}

export function fitBand(total: number): FitBand {
  if (total >= FIT_BANDS.strong) return "strong";
  if (total >= FIT_BANDS.reasonable) return "reasonable";
  if (total >= FIT_BANDS.stretch) return "stretch";
  return "weak";
}

/** Apply/skip, from Candidate Fit only. */
export function verdictFor(fit: FitScore): Verdict {
  switch (fit.band) {
    case "strong":
    case "reasonable":
      return { kind: "apply", text: "Apply" };
    case "stretch":
      return { kind: "optional", text: "Possible fit" };
    default:
      return { kind: "skip", text: "Skip" };
  }
}

export const FIT_BAND_LABEL: Record<FitBand, string> = {
  strong: "Strong",
  reasonable: "Reasonable",
  stretch: "Possible fit",
  weak: "Weak",
};
