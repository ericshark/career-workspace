// Server-only lookup for CLI defaults when a tailored reference is selected without its review ID.
import { laneForResume } from "./config";
import { listReviews } from "./reviews";
import { loadRun } from "./runs";
export function defaultResumeLane(resume: string): "tech" | "bridge" {
  if (!resume.startsWith("tailored/")) return laneForResume(resume);
  for (const summary of [...listReviews()].sort((a, b) =>
    b.savedAt.localeCompare(a.savedAt),
  )) {
    if (summary.kind !== "review") continue;
    const run = loadRun(summary.id);
    if (run?.tailor?.slug === resume.slice(9))
      return laneForResume(resume, run.result.resume);
  }
  return laneForResume(resume);
}
