"use client";
import { conciseLocation } from "@/lib/location";
import { ageLine } from "@/lib/scoring/age";
import type { QuickBatchResult, QuickRecord } from "@/lib/types";
import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SourceDot } from "@/components/SourceDot";
import { DuplicateMatches } from "./DuplicateMatches";

/** What a quick add just did: the jobs logged as applied (resume tech) and the ones skipped. */
export function QuickBatchSummary({
  summary,
  onClose,
}: {
  summary: QuickBatchResult;
  onClose: () => void;
}) {
  const { added, skipped, error } = summary;
  return (
    <Card className="animate-rise">
      <CardHeader>
        <CardTitle asChild className="text-lg font-semibold">
          <h2>
            {added.length
              ? `Added ${added.length} job${added.length === 1 ? "" : "s"}`
              : error
                ? "Save incomplete"
                : "Nothing added"}
          </h2>
        </CardTitle>
        <CardDescription>
          Logged as applied today. Each job brief is kept in History.
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {added.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {added.map((a) => (
              <li key={a.undoId} className="flex flex-wrap items-center gap-2">
                <SourceDot source={a.source} />
                <span className="font-medium">{a.company}</span>
                <span className="text-muted-foreground">·</span>
                <span>{a.role}</span>
                <span className="text-xs text-muted-foreground">
                  {a.source}
                  {a.action === "updated" ? " · updated your saved row" : ""}
                </span>
                {a.note && (
                  <span className="basis-full pl-5 text-xs text-warning">
                    {a.note}
                  </span>
                )}
                {a.duplicates &&
                  (a.duplicates.exact.length > 0 ||
                    a.duplicates.possible.length > 0) && (
                    <details className="basis-full pl-5 text-xs text-warning">
                      <summary className="cursor-pointer">
                        Possible duplicate — compare postings
                      </summary>
                      <DuplicateMatches duplicates={a.duplicates} />
                    </details>
                  )}
              </li>
            ))}
          </ul>
        )}
        {skipped.length > 0 && (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Skipped</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {skipped.map((s, i) => (
                  <li key={i}>
                    {s.company}
                    {s.role ? ` — ${s.role}` : ""}: {s.reason}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>
              Quick Add stopped. {error}. The unfinished cards are still in your
              list. Retry to finish them. A tracker row may already exist if a
              save was interrupted.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/** Read-only view of a quick add opened from the history. */
export function QuickView({
  record,
  status,
  onClose,
}: {
  record: QuickRecord;
  status: string | null;
  onClose: () => void;
}) {
  const e = record.extract;
  return (
    <Card className="animate-rise">
      <CardHeader>
        <CardTitle asChild className="text-lg font-semibold tracking-tight">
          <h2>
            {e.company} <span className="text-muted-foreground">·</span>{" "}
            {e.role}
          </h2>
        </CardTitle>
        <CardDescription>
          Quick add · {record.reviewedAt}
          {status ? ` · ${status}` : ""}
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          {[conciseLocation(e.location, e.workMode), e.level]
            .filter(Boolean)
            .join(" · ")}
          {" · "}Posting: {ageLine(record.age)}
          {record.request.link ? (
            <>
              {" · "}
              <a
                className="text-primary underline-offset-4 hover:underline"
                href={record.request.link}
                target="_blank"
                rel="noreferrer noopener"
              >
                posting
              </a>
            </>
          ) : null}
        </p>
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {record.postFormat === "brief"
              ? "Job description summary"
              : "Original description"}
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
            {record.request.jobPost}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}
