// Offline fixtures exercise controlled edits, staging, validation and approval without a model call.
import { runTailor } from "./tailor";
import { contentHash } from "./inputs";
import type { TailorRequest, JobEvent } from "../types";
import type { TailorAssessment } from "./schemas";

export async function createFixtureTailor(
  req: TailorRequest,
  emit: (event: JobEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  await runTailor(req, emit, signal, async (submit, snapshot, review) => {
    const hash = contentHash(snapshot.resumeTex);
    await submit({ candidateHash: hash, edits: [], changes: [] });
    const report: TailorAssessment = {
      candidateHash: hash,
      visualPassed: true,
      readingOrderPassed: true,
      support: [],
      notes: "Offline fixture: unchanged master; simulated agent assessments.",
      requirements: review.requirements
        .filter((r) => r.kind !== "eligibility" && r.bucket !== 3)
        .map((r) => ({
          id: r.id,
          presence: "absent",
          placement: null,
          quote: "",
        })),
    };
    return {
      subtype: "success",
      structuredOutput: report,
      denied: [],
      durationMs: 0,
      metrics: {},
    };
  });
}
