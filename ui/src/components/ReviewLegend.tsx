import { reviewVerdictColor } from "@/lib/reviewPresentation";

export function ReviewLegend() {
  return (
    <div aria-label="Review ranking legend" className="space-y-4 text-xs">
      {[
        {
          label: "Fit",
          description: "How your experience fits the role.",
          bands: [
            { label: "Skip", range: "0–29", color: reviewVerdictColor(0) },
            {
              label: "Low priority",
              range: "30–44",
              color: reviewVerdictColor(30),
            },
            {
              label: "Possible fit",
              range: "45–59",
              color: reviewVerdictColor(45),
            },
            { label: "Apply", range: "60–79", color: reviewVerdictColor(60) },
            {
              label: "Strong fit",
              range: "80–100",
              color: reviewVerdictColor(80),
            },
          ],
        },
        {
          label: "Resume Match",
          description: "How clearly the reviewed resume shows that fit.",
          bands: [
            { label: "Weak", range: "0–59", color: "var(--warning)" },
            { label: "Moderate", range: "60–79", color: "var(--chart-1)" },
            { label: "Strong", range: "80–100", color: "var(--success)" },
          ],
        },
      ].map((group) => (
        <div key={group.label} className="space-y-2">
          <div>
            <p className="font-semibold">{group.label}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {group.description}
            </p>
          </div>
          <dl className="space-y-1.5">
            {[...group.bands].reverse().map((band) => (
              <div
                key={band.label}
                className="flex items-center justify-between gap-4"
              >
                <dt className="flex items-center gap-2 text-foreground/80">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: band.color }}
                  />
                  {band.label}
                </dt>
                <dd className="text-muted-foreground tabular-nums">
                  {band.range}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
