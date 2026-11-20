// Browser-safe workflow gate: a validated tailored artifact is auto-selected (switchable back to its master).
import type { TailorResult } from "./types";

export function tailorValidated(r: TailorResult): boolean {
  const common =
    r.build.ok &&
    r.build.pages === 1 &&
    !!r.build.ats?.startsWith("PASS") &&
    r.mastersUnchanged &&
    r.evidenceValidation === "passed" &&
    !!r.pngUrl &&
    !!r.hashes;
  if (!common) return false;
  if (r.validationMethod === "cli") return true;
  return (
    r.validationMethod === "controlled" &&
    r.candidateHash === r.hashes?.source &&
    r.verification?.report === true &&
    r.verification.evidence === true &&
    r.verification.visual === true &&
    r.verification.readingOrder === true
  );
}

export function tailorPassed(r: TailorResult): boolean {
  return tailorValidated(r);
}
