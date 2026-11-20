import type { TrackerBrief } from "@/lib/trackerBrief";
import { jobSectionClass } from "./JobHeader";

/** The same saved summary in Tracker and the Apply review pop-up. */
export function JobSummary({
  brief,
  loading = false,
}: {
  brief?: TrackerBrief;
  loading?: boolean;
}) {
  return (
    <section
      id="job-summary"
      aria-label="Job summary"
      className={`${jobSectionClass} space-y-3`}
    >
      {loading && (
        <p className="text-sm text-muted-foreground">Loading saved job…</p>
      )}
      {brief?.overview && (
        <div className="space-y-1">
          <h2 className="text-sm font-semibold mb-1">Role overview</h2>
          <p className="text-sm leading-5">{brief.overview}</p>
        </div>
      )}
      {brief?.experience && (
        <section className="space-y-1">
          <h2 className="mb-1 text-sm font-semibold">Experience</h2>
          <p className="text-sm leading-5">{brief.experience}</p>
        </section>
      )}
      {!!brief?.qualifications.length && (
        <section className="space-y-1">
          <h2 className="mb-1 text-sm font-semibold">Key requirements</h2>
          <ul className="list-disc space-y-0.5 pl-4 text-sm leading-5">
            {brief.qualifications.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {!!brief?.responsibilities.length && (
        <section className="text-sm space-y-1">
          <h2 className="mb-1 text-sm font-semibold">
            Responsibilities and details
          </h2>
          <ul className="list-disc space-y-0.5 pl-4 text-sm leading-5">
            {brief.responsibilities.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
