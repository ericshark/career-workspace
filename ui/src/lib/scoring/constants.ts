// The few thresholds the review still applies in code. Claude scores Fit and Match itself
// (prompts/review-job.md); code only maps those scores to labels.

/** Fit bands → verdict: Strong/Reasonable → Apply, Possible fit → Optional, below → Skip. */
export const FIT_BANDS = { strong: 80, reasonable: 60, stretch: 45 } as const;

export const MATCH_BANDS = { strong: 80, moderate: 60 } as const;

// ───────── Posting age ─────────

export const AGE_BANDS = { fresh: 3, recent: 7, older: 30 } as const;
