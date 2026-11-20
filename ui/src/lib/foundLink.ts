// What a stored link is, named for the button that opens it. Only two names are shown: "Job posting"
// (the employer's posting, the board's posting, any other site that lists it, or one the workspace owner pasted) and
// "Careers page" (the employer's careers page or website). The kind still records where it came from.
export const FOUND_LINK_LABELS = {
  posting: "Job posting",
  source: "Job posting",
  careers: "Careers page",
  website: "Careers page",
  other: "Job posting",
  manual: "Job posting",
} as const;

export type FoundLink = {
  kind: keyof typeof FOUND_LINK_LABELS;
  url: string;
};

/** A search that found nothing, or a job the workspace owner chose to stop offering the Find button for. */
export type LinkLookup =
  { kind: "none"; checkedAt: string } | { kind: "ignored" };

export type StoredLink = FoundLink | LinkLookup;

export function isFoundLink(value: StoredLink | undefined): value is FoundLink {
  return !!value && value.kind !== "none" && value.kind !== "ignored";
}

export function usableJobLink(value?: string | null): value is string {
  try {
    const url = new URL(value ?? "");
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
