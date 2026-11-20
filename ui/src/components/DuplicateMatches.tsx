import type { DuplicateMatch, DuplicateReport } from "@/lib/types";

export function duplicateLine(m: DuplicateMatch): string {
  const kind =
    m.reason === "company-title"
      ? "Possible matching record"
      : m.kind === "review"
        ? m.recordKind === "quick"
          ? "Saved job"
          : "Previously reviewed"
        : m.status === "to apply"
          ? "Saved for later"
          : m.status === "applied"
            ? `Applied on ${m.date}`
            : `Application (${m.status})`;
  const why =
    m.reason === "company-title"
      ? "same company, similar title"
      : m.reason === "url"
        ? "same link"
        : "same job id";
  return `${kind} · ${m.date} · ${m.company} — ${m.role} · ${why}`;
}

/** Warnings link to the stored posting, so a reused title never prevents a new submission. */
export function DuplicateMatches({
  duplicates,
}: {
  duplicates: DuplicateReport;
}) {
  return (
    <ul className="list-disc pl-5">
      {[...duplicates.exact, ...duplicates.possible].map((match, i) => {
        const href =
          match.kind === "application"
            ? `/tracker?application=${encodeURIComponent(match.recordId ?? match.key ?? "")}${match.recordId || match.lineIndex === undefined ? "" : `&lineIndex=${match.lineIndex}`}`
            : match.reviewPath
              ? `/guide/${match.reviewPath}`
              : match.link;
        return (
          <li key={i}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4"
              >
                {duplicateLine(match)} · View posting
              </a>
            ) : (
              duplicateLine(match)
            )}
          </li>
        );
      })}
    </ul>
  );
}
