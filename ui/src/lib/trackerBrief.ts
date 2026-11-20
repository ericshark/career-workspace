import { conciseLocation } from "./location";
import { cleanBriefMarkdown, type JobBrief } from "./jobBrief";

export interface TrackerBrief {
  overview: string;
  location: string;
  workMode: string;
  compensation: string;
  experience: string;
  qualifications: string[];
  responsibilities: string[];
}

/** Read established saved briefs only; never infer qualifications from a raw posting. */
export function trackerBrief(
  structured?: JobBrief,
  markdown?: string | null,
  location = "",
  compensation = "",
  workMode = "",
): TrackerBrief {
  const parsed = {
    overview: "",
    experience: "",
    location,
    compensation,
    qualifications: [] as string[],
    responsibilities: [] as string[],
  };
  let section: "overview" | "qualifications" | "responsibilities" = "overview";
  for (const line of cleanBriefMarkdown(markdown ?? "")
    .replace(/^# [^\n]*(?:\n|$)/, "")
    .split("\n")) {
    const fact = line.match(
      /^\s*[-*]?\s*(Experience|Location\/work mode|Compensation):\s*(.+)$/i,
    );
    if (fact) {
      const key = /^experience$/i.test(fact[1])
        ? "experience"
        : /^compensation$/i.test(fact[1])
          ? "compensation"
          : "location";
      parsed[key] = fact[2];
    } else if (/^(?:#{1,3}\s*)?Responsibilities:\s*$/i.test(line))
      section = "responsibilities";
    else if (/^(?:#{1,3}\s*)?Qualifications:\s*$/i.test(line))
      section = "qualifications";
    else if (line.trim()) {
      if (section === "overview")
        parsed.overview += (parsed.overview ? " " : "") + line.trim();
      else parsed[section].push(line.replace(/^\s*[-*]\s*/, "").trim());
    }
  }
  const brief = { ...parsed, ...structured };
  const clean = (v: string) =>
    /^(unknown|not stated|not listed|no specific qualifications stated\.?|–)$/i.test(
      v.trim(),
    )
      ? ""
      : v.trim();
  const modeText = brief.location.replace(
    /\b(?:not|no)\s+(?:fully\s+)?(?:remote|hybrid|on[- ]site|in[- ]office)\b/gi,
    "",
  );
  const explicit = modeText.match(
    /\b(hybrid|remote|on[- ]site|in[- ]office|in[- ]person|flexible)\b/i,
  )?.[0];
  return {
    ...brief,
    overview: clean(brief.overview),
    experience: clean(brief.experience),
    location:
      conciseLocation(clean(brief.location)) === "Unknown"
        ? clean(location)
        : clean(brief.location),
    compensation: clean(brief.compensation),
    workMode: explicit
      ? /hybrid/i.test(explicit)
        ? "Hybrid"
        : /remote/i.test(explicit)
          ? "Remote"
          : /flexible/i.test(explicit)
            ? "Flexible"
            : "In person"
      : workMode,
    qualifications: brief.qualifications.map(clean).filter(Boolean),
    responsibilities: brief.responsibilities.map(clean).filter(Boolean),
  };
}
