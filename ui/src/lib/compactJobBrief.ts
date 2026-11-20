import { conciseLocation } from "./location";
import { cleanBriefMarkdown } from "./jobBrief";

/** Presentation only: move known facts above the overview without shortening saved content. */
export function compactJobBrief(markdown: string): string {
  const facts: { label: string; value: string }[] = [];
  const body: string[] = [];
  for (const line of cleanBriefMarkdown(markdown)
    .replace(/^# [^\n]*(?:\n|$)/, "")
    .split("\n")) {
    const fact = line.match(
      /^\s*[-*]?\s*(Experience|Location\/work mode|Compensation):\s*(.+)$/i,
    );
    if (fact) {
      facts.push({
        label: /^compensation$/i.test(fact[1])
          ? "Salary"
          : /^experience$/i.test(fact[1])
            ? "Experience"
            : "Location",
        value: /^location/i.test(fact[1]) ? conciseLocation(fact[2]) : fact[2],
      });
    } else if (/^Responsibilities:\s*$/.test(line))
      body.push("### What you’ll do");
    else if (/^Qualifications:\s*$/.test(line))
      body.push("### What they’re looking for");
    else
      body.push(
        line.replace(
          /^(\s*[-*]\s*)(Required|Preferred|Desired|Nice to have):\s*/i,
          "$1**$2:** ",
        ),
      );
  }
  const order = ["Salary", "Experience", "Location"];
  facts.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  const text = body.join("\n").trim();
  const overviewHeading =
    text && !text.startsWith("#") && !/^[-*] /.test(text)
      ? "### About the role\n\n"
      : "";
  return [
    facts.map((f) => `**${f.label}:** ${f.value}`).join("  \n"),
    overviewHeading + text,
  ]
    .filter(Boolean)
    .join("\n\n");
}
