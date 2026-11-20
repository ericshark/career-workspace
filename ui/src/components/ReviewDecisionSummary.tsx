import type { ScoreResult } from "@/lib/types";
import {
  reviewJudgment,
  reviewTailoring,
  reviewTailoringReason,
  reviewVerdictColor,
} from "@/lib/reviewPresentation";
import { ReviewLegend } from "./ReviewLegend";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function ReviewDecisionSummary({
  result,
  resume,
}: {
  result: ScoreResult;
  resume: string;
}) {
  const tailor = reviewTailoring(result);
  const selected = resume.startsWith("tailored/");
  const fitColor = reviewVerdictColor(result.fit.total);
  const matchColor =
    result.match.total === null
      ? "var(--muted-foreground)"
      : result.match.total >= 80
        ? "var(--success)"
        : result.match.total >= 60
          ? "var(--chart-1)"
          : "var(--warning)";
  const actionColor = selected
    ? "var(--chart-1)"
    : tailor
      ? "var(--warning)"
      : "var(--success)";

  return (
    <div
      aria-label="Decision summary"
      className="overflow-hidden rounded-xl border border-border/60 bg-muted/25"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Verdict</span>
          <span
            data-testid="verdict"
            className="inline-flex items-center gap-1.5 text-sm font-semibold"
            style={{ color: fitColor }}
          >
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-current"
            />
            {result.fit.total >= 80 ? "Strong fit" : reviewJudgment(result)}
          </span>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-1.5 text-[11px] font-normal text-muted-foreground"
            >
              Score guide
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 max-w-[calc(100vw-2rem)] p-4"
          >
            <ReviewLegend />
          </PopoverContent>
        </Popover>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 bg-background/35 py-3">
        {[
          { label: "Fit", value: result.fit.total, color: fitColor },
          {
            label: "Resume Match",
            value: result.match.total,
            color: matchColor,
          },
        ].map((score) => (
          <div key={score.label} className="min-w-0 px-3 sm:px-4">
            <dt className="text-[11px] font-medium text-muted-foreground">
              {score.label}
            </dt>
            <dd
              className="mt-1 text-2xl font-semibold leading-none tracking-tight tabular-nums"
              style={{ color: score.color }}
            >
              {score.value ?? "n/a"}
              {score.value !== null && (
                <span className="ml-0.5 text-[11px] font-normal tracking-normal text-muted-foreground/70">
                  /100
                </span>
              )}
            </dd>
          </div>
        ))}
        <div
          className="min-w-0 px-3 sm:px-4"
          title={
            selected
              ? "A tailored resume is already selected."
              : reviewTailoringReason(result)
          }
        >
          <dt className="text-[11px] font-medium text-muted-foreground">
            Resume action
          </dt>
          <dd
            className="mt-1.5 text-sm font-semibold leading-tight"
            style={{ color: actionColor }}
          >
            {selected
              ? "Tailored selected"
              : tailor
                ? "Tailor"
                : "Use current resume"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
