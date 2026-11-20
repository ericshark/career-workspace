import type { HistoryItem, ReviewRequirement, ScoreResult } from "./types";
export type HistoryFilter =
  "all" | "undecided" | "reviews" | "to-apply" | "summaries" | "in-progress";

export function savedHistoryFilter(value: unknown): HistoryFilter {
  return value === "reviews" ||
    value === "to-apply" ||
    value === "in-progress" ||
    value === "summaries"
    ? value
    : "summaries";
}
export function needsDecision(item: HistoryItem): boolean {
  return (
    item.kind === "review" &&
    item.decision === "undecided" &&
    item.status === "not decided"
  );
}
export function filterHistory(items: HistoryItem[], filter: HistoryFilter) {
  const sorted = items
    .filter((item) => {
      if (filter === "summaries")
        return ["applied", "in progress"].includes(item.status);
      if (filter === "in-progress") return item.status === "in progress";
      if (filter === "to-apply" || filter === "undecided")
        return (
          item.kind === "review" &&
          (item.status === "to apply" || needsDecision(item))
        );
      return (
        item.kind === "review" &&
        (filter === "all" || ["applied", "in progress"].includes(item.status))
      );
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  if (filter !== "summaries" && filter !== "in-progress") return sorted;
  const seen = new Set<string>();
  const candidates =
    filter === "in-progress"
      ? sorted.filter(
          (item) =>
            item.kind === "review" ||
            !sorted.some(
              (other) =>
                other.kind === "review" && other.sourceRecordId === item.id,
            ),
        )
      : sorted;
  return candidates.filter((item) => {
    const key = item.sourceRecordId ?? item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function evidenceLabel(requirement: ReviewRequirement) {
  return requirement.effectiveCredit === "strong"
    ? "Supported"
    : requirement.effectiveCredit === "partial"
      ? "Partial"
      : "Not documented";
}
export function reviewReasons(result: ScoreResult): string[] {
  const ordered = [
    ...result.why,
    result.fit.summary,
    result.match.summary,
    ...result.gaps,
  ];
  const unique = new Map<string, string>();
  for (const text of ordered) {
    const clean = text.trim();
    const key = clean.toLowerCase().replace(/[.!?]+$/, "");
    if (clean && !unique.has(key)) unique.set(key, clean);
  }
  return [...unique.values()].slice(0, 3);
}

/** Recommend tailoring only for supported, substantive improvements to core work evidence. */
export function reviewTailoringChange(result: ScoreResult) {
  if (result.fit.total < 60 || result.match.total === null) return undefined;
  if (!["tailor", "light-tailor"].includes(result.recommendation.kind))
    return undefined;
  return result.recommendedChanges.find((change) => {
    if (
      !change.text.trim() ||
      !["surface", "emphasize", "swap"].includes(change.action)
    )
      return false;
    // A strong resume needs a genuinely missing piece of work evidence, not polishing.
    if (result.match.total! >= 80 && change.action === "emphasize")
      return false;
    const requirement = result.requirements.find(
      (item) => item.id === change.requirementId,
    );
    return (
      requirement?.kind === "must" &&
      requirement.effectiveCredit !== "none" &&
      !!requirement.careerQuote.trim() &&
      (requirement.effectivePresence !== "bullet" ||
        requirement.placement === "buried")
    );
  });
}

/** Keep the visible recommendation, verdict and Tailor button consistent. */
export function reviewTailoring(result: ScoreResult): boolean {
  return !!reviewTailoringChange(result);
}

export function reviewTailoringReason(result: ScoreResult): string {
  const change = reviewTailoringChange(result);
  if (change) return change.text;
  if (result.fit.total < 60) return "Tailoring is low priority for this fit.";
  if (result.match.total === null)
    return "No resume assessment is available to justify tailoring.";
  return "No substantial, supported improvement to a core requirement was identified. Wording and keyword tweaks alone are not worth tailoring.";
}
export function reviewJudgment(result: ScoreResult): string {
  const fit = result.fit.total;
  if (fit < 30) return "Skip";
  if (fit < 45) return "Low priority";
  if (fit < 60) return "Possible fit";
  if (fit < 80) return "Apply";
  return reviewTailoring(result)
    ? "Strong fit — tailor first"
    : "Strong fit — apply as-is";
}
export function reviewDecisionBrief(result: ScoreResult) {
  const firstSentence = (text: string) =>
    text
      .trim()
      .match(/^.*?[.!?](?:\s|$)/)?.[0]
      .trim() || text.trim();
  return {
    strengths:
      result.decisionBrief?.strengths ||
      firstSentence(
        result.fit.summary || result.why[0] || "No fit explanation recorded.",
      ),
    gaps:
      result.decisionBrief?.gaps ||
      firstSentence(result.gaps[0] || "No major work gap recorded."),
    resumeAction: reviewTailoring(result)
      ? reviewTailoringReason(result)
      : `Use the current resume if you apply. ${reviewTailoringReason(result)}`,
  };
}
export function reviewDecisionActions(status?: string | null) {
  if (status === "to apply") return { skip: true, later: false, applied: true };
  if (!status || status === "not decided")
    return { skip: true, later: true, applied: true };
  return { skip: false, later: false, applied: false };
}

/** Colors follow the current priority, independently of historical saved verdict strings. */
export function reviewVerdictColor(fit: number): string {
  if (fit < 30) return "var(--destructive)";
  if (fit < 45) return "var(--muted-foreground)";
  if (fit < 60) return "var(--warning)";
  if (fit < 80) return "var(--chart-1)";
  return "var(--success)";
}
