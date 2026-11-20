import { z } from "zod";

export const JobBriefSchema = z
  .object({
    overview: z.string().trim().min(20).max(400),
    experience: z.string().trim().max(200),
    responsibilities: z.array(z.string().trim().min(1).max(220)).max(5),
    qualifications: z.array(z.string().trim().min(1).max(220)).max(6),
    location: z.string().trim().max(160),
    compensation: z.string().trim().max(160),
  })
  .refine(
    (brief) => brief.responsibilities.length + brief.qualifications.length > 0,
    {
      message: "A job brief needs responsibilities or qualifications",
    },
  );

export type JobBrief = z.infer<typeof JobBriefSchema>;

/** The one compact post stored after extraction; empty sections are omitted. */
export function formatJobBrief(
  company: string,
  role: string,
  brief: JobBrief,
): string {
  const lines = [`# ${company} — ${role}`, "", brief.overview];
  const details = [
    brief.experience ? `Experience: ${brief.experience}` : "",
    brief.location ? `Location/work mode: ${brief.location}` : "",
    brief.compensation ? `Compensation: ${brief.compensation}` : "",
  ].filter(Boolean);
  if (details.length) lines.push("", ...details.map((detail) => `- ${detail}`));
  if (brief.responsibilities.length)
    lines.push(
      "",
      "Responsibilities:",
      ...brief.responsibilities.map((item) => `- ${item}`),
    );
  if (brief.qualifications.length)
    lines.push(
      "",
      "Qualifications:",
      ...brief.qualifications.map((item) => `- ${item}`),
    );
  return cleanBriefMarkdown(lines.join("\n"));
}

/** Clean legacy briefs without inventing facts or treating a partial unknown as a missing field. */
export function cleanBriefMarkdown(markdown: string): string {
  const placeholder =
    /^(?:unknown|not stated(?: in (?:the )?post)?|not specified|not provided|n\/a|none|[–—-])\.?$/i;
  const lines = markdown
    .split("\n")
    .filter((line) => {
      const value = line
        .replace(/^[-*]\s*/, "")
        .replace(/^[^:]+:\s*/, "")
        .trim();
      return !placeholder.test(value);
    })
    .map((line) => line.replace(/;?\s*work mode not stated\.?/gi, ""));
  return lines
    .filter(
      (line, i) =>
        !/^(Responsibilities|Qualifications):$/.test(line) ||
        lines
          .slice(i + 1)
          .find((l) => l.trim())
          ?.startsWith("- "),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
