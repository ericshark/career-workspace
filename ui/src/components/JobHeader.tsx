import { salaryLabel } from "@/lib/jobMetadata";
import { conciseLocation } from "@/lib/location";
import { ExternalLinkIcon } from "lucide-react";
import { TintBadge } from "./TintBadge";
import { sourceColor } from "@/lib/sources";

export function JobHeading({
  company,
  role,
  large = false,
}: {
  company: string;
  role: string;
  large?: boolean;
}) {
  const hasCompany =
    company.trim() &&
    !/^(unknown|not stated|not listed)$/i.test(company.trim());
  const hasRole =
    role.trim() && !/^(unknown|not stated|not listed)$/i.test(role.trim());
  return (
    <span className={large ? "text-xl leading-7" : undefined}>
      {hasCompany ? company : !hasRole ? "Saved job" : null}
      {hasRole && (
        <span
          className={`block font-normal text-muted-foreground ${large ? "text-base leading-6" : "text-sm"}`}
        >
          {role}
        </span>
      )}
    </span>
  );
}
export function JobLink({
  link,
  large = false,
}: {
  link: string;
  large?: boolean;
}) {
  return /^https?:\/\//i.test(link) ? (
    <a
      className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 font-medium text-white hover:bg-blue-700 ${large ? "h-8 text-sm" : "h-7 text-xs"}`}
      href={link}
      target="_blank"
      rel="noopener noreferrer"
    >
      <ExternalLinkIcon className="size-3" />
      Link
    </a>
  ) : null;
}
export function JobFacts({
  source,
  facts,
  large = false,
}: {
  source: string;
  large?: boolean;
  facts: { label: string; value: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Job facts">
      {source && !/^(unknown|not stated|not listed)$/i.test(source.trim()) && (
        <TintBadge
          color={sourceColor(source)}
          className={`h-auto rounded-full border-0 py-1 ${large ? "px-3 text-[13px]" : "px-2.5 text-xs"}`}
          title="Source"
        >
          {source}
        </TintBadge>
      )}
      {facts
        .filter(
          (fact) =>
            (fact.label !== "Salary" || !!salaryLabel(fact.value)) &&
            (fact.label !== "Resume" || fact.value.startsWith("tailored/")) &&
            fact.value &&
            !/^(unknown|not stated|not listed|n\/a|–)$/i.test(
              fact.value.trim(),
            ),
        )
        .map((fact) => (
          <span
            key={fact.label}
            title={fact.label}
            aria-label={`${fact.label}: ${fact.value}`}
            className={`inline-flex items-center rounded-full ${fact.label === "Resume" ? "bg-primary/15 text-primary font-bold" : "bg-muted"} py-1 font-medium break-words ${large ? "px-3 text-[13px]" : "px-2.5 text-xs"}`}
          >
            {["Applied", "Saved", "Posted"].includes(fact.label)
              ? `${fact.label} ${fact.value}`
              : fact.label === "Resume"
                ? "Tailored"
                : fact.label === "Salary"
                  ? salaryLabel(fact.value)
                  : fact.value}
          </span>
        ))}
    </div>
  );
}
export const jobSectionClass = "rounded-xl bg-muted/60 p-4 space-y-1";

/** Saved location text may already contain its work mode. */
export function jobLocation(location: string, mode: string) {
  return conciseLocation(location, mode);
}
