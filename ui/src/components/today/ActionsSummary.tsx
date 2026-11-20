"use client";
import { AppSheet } from "../tracker/AppSheet";
import type { ApplicationRow } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";
import { InboxIcon } from "lucide-react";
import { compactAge, type CheckSummary } from "@/lib/checkSummary";
import type { CheckAttemptView } from "@/lib/checkJournal";
import { Button } from "../ui/button";
import { applicationFor } from "@/lib/recruitingTypes";
import { RecruitingUpdates, useRecruiting } from "../Recruiting";
import { useFetchJson } from "../useFetchJson";
import { CategoryChip, MetaSep, NewPill } from "../CategoryChip";
import { PROGRESS_CHANGED } from "../useFetchJson";
import {
  ACTION_CATEGORY_STYLE,
  actionActivityId,
  hasNewActionMarker,
  deadlineLabel,
  isActionOverdue,
  type ActionsPayload,
} from "@/lib/actionTypes";
import {
  deadlineItems,
  outstanding,
  rankedPreview,
} from "@/lib/recruitingPresentation";
import { DeadlineCalendar } from "./DeadlineCalendar";

/**
 * Bottom row of the Dashboard: one
 * "Updates & actions" card, and the Upcoming calendar.
 */
export function ActionsSummary() {
  const { data, error } = useFetchJson<ActionsPayload>("/api/actions", {
    events: true,
  });
  const recruiting = useRecruiting();
  const mail = useFetchJson<{
    checkAttempts?: CheckAttemptView[];
    lastCareerCheck?: {
      runId: string;
      completedAt: string;
      summary?: CheckSummary;
    };
  }>("/api/mail", { events: true });
  const open = data ? outstanding(data, recruiting.data) : [];
  const needsMatching =
    recruiting.data?.pending.filter((p) => !p.processed).length ?? 0;
  const [selected, setSelected] = useState<ApplicationRow | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  // New markers stay for this visit only: they are saved as seen right away, so the next visit
  // (or a refresh) no longer shows them, the same way the Updates dots behave.
  const [visitNew, setVisitNew] = useState<ReadonlySet<string>>(new Set());
  const markers = data
    ? open.filter((a) => hasNewActionMarker(a, data) && !visitNew.has(a.id))
    : [];
  useEffect(() => {
    if (!markers.length) return;
    setVisitNew(
      (current) => new Set([...current, ...markers.map((a) => a.id)]),
    );
    void fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "seen-new",
        items: markers.map((a) => ({
          id: a.id,
          activityId: actionActivityId(a),
        })),
      }),
    })
      .then((r) => {
        if (r.ok) window.dispatchEvent(new Event(PROGRESS_CHANGED));
      })
      .catch(() => {});
  }, [markers]);
  const fresh = open.filter((a) => visitNew.has(a.id));
  const previews = data
    ? [
        ...fresh,
        ...rankedPreview(
          open.filter((a) => !fresh.includes(a)),
          data,
          new Date(),
          5,
        ),
      ]
    : [];
  const full = mail.data?.lastCareerCheck;
  const quick = data?.lastQuickCheck;
  const attempts = (mail.data?.checkAttempts ?? []).filter(
    (attempt) => attempt.mode === "daily" || attempt.mode === "quick",
  );
  const successfulChecks = [full, quick];
  const latest = successfulChecks
    .filter((check) => check !== undefined)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
  const lastAttempt = attempts.at(-1);
  const running =
    lastAttempt?.status === "running" &&
    Date.parse(lastAttempt.expiresAt) > now.getTime();
  const failed = lastAttempt
    ? lastAttempt.status !== "succeeded" &&
      (!latest ||
        Date.parse(lastAttempt.attemptedAt) >=
          Date.parse(latest.completedAt)) &&
      (lastAttempt.status !== "running" ||
        Date.parse(lastAttempt.expiresAt) <= now.getTime())
    : false;
  return (
    <div className="space-y-4">
      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <section
          aria-labelledby="updates-actions-title"
          className="min-w-0 rounded-xl border bg-card p-5 shadow-xs"
        >
          {/* Last check sits in the card header, covering both sections. */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b pb-3">
            <h2
              id="updates-actions-title"
              className="flex items-center gap-2 text-base"
            >
              <span className="grid size-7 place-items-center rounded-lg bg-muted text-muted-foreground">
                <InboxIcon aria-hidden className="size-4" />
              </span>
              Updates &amp; actions
            </h2>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
              <p className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-neutral-800">
                {latest && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-success"
                  />
                )}
                Last check{" "}
                {latest ? (
                  <time dateTime={latest.completedAt}>
                    {compactAge(latest.completedAt, now)}
                  </time>
                ) : mail.error ? (
                  "· Unavailable"
                ) : mail.data ? (
                  "· Not recorded"
                ) : (
                  "· Loading…"
                )}
              </p>
              {running && (
                <p role="status" className="text-xs text-muted-foreground">
                  Check running.
                </p>
              )}
              {failed && (
                <p role="status" className="text-xs text-warning">
                  Latest check incomplete.
                </p>
              )}
              {(error || mail.error) && (
                <p role="alert" className="text-xs text-warning">
                  Could not refresh check information.
                </p>
              )}
            </div>
          </div>
          <RecruitingUpdates bare limit={5} onSummary={setSelected} />
          <section aria-label="Actions overview" className="mt-4 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm">
                <Link
                  className="rounded-md px-2 py-1 -ml-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  href="/actions"
                >
                  Actions
                </Link>
              </h3>
              <NewPill count={fresh.length} label="New actions" />
            </div>
            {(open.length > 0 || needsMatching > 0) && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {[
                  [open.length, "open actions"],
                  [open.filter((a) => isActionOverdue(a)).length, "overdue"],
                  [
                    open.filter((a) => a.deadline && !isActionOverdue(a))
                      .length,
                    "upcoming deadlines",
                  ],
                ]
                  .filter(([n]) => Number(n) > 0)
                  .map(([n, label]) => (
                    <span
                      key={label}
                      className="rounded-md bg-muted/60 px-2 py-1"
                    >
                      <strong>{n}</strong> {label}
                    </span>
                  ))}
                {needsMatching > 0 && (
                  <Link
                    href="/actions?filter=decisions"
                    className="rounded-md bg-muted/60 px-2 py-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <strong>{needsMatching}</strong> need matching
                  </Link>
                )}
              </div>
            )}
            {!data ? (
              <p role="status" className="mt-3 text-xs text-muted-foreground">
                {error ? "Actions are unavailable." : "Loading actions…"}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border/60">
                {previews.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2"
                  >
                    <Link
                      href={`/actions?action=${encodeURIComponent(a.id)}#action-${a.id}`}
                      className="flex min-w-0 flex-1 basis-48 flex-wrap items-center justify-between gap-3 rounded-md py-1 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium leading-5">
                          {fresh.includes(a) && (
                            <span
                              aria-label="New action"
                              className="mr-2 inline-block size-1.5 rounded-full bg-chart-1 align-middle"
                            />
                          )}
                          {a.text}
                          {a.category && (
                            <CategoryChip
                              {...ACTION_CATEGORY_STYLE[a.category]}
                            />
                          )}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-y-1 text-xs text-muted-foreground">
                          {a.company}
                          <MetaSep />
                          {a.roleOverride ?? a.role}
                          <MetaSep />
                          <time dateTime={a.email?.receivedAt ?? a.createdAt}>
                            {compactAge(
                              a.email?.receivedAt ?? a.createdAt,
                              now,
                            )}
                          </time>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 text-[11px] text-muted-foreground">
                        {a.deadline && (
                          <span
                            className={`rounded-md bg-neutral-200/70 px-1.5 py-0.5 font-medium dark:bg-neutral-700/60 ${
                              isActionOverdue(a)
                                ? "text-destructive"
                                : "text-warning"
                            }`}
                          >
                            {isActionOverdue(a) ? "Overdue" : "Due"}{" "}
                            {deadlineLabel(a.deadline)}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        className="px-2 text-[11px]"
                        disabled={!a.email}
                        asChild={!!a.email}
                      >
                        {a.email ? (
                          <a
                            href={a.email.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View Email
                          </a>
                        ) : (
                          "View Email"
                        )}
                      </Button>
                      {(() => {
                        const row = a.application
                          ? applicationFor(
                              a.application,
                              recruiting.data?.rows ?? [],
                            )
                          : null;
                        return (
                          <Button
                            size="xs"
                            variant="outline"
                            className="px-2 text-[11px]"
                            disabled={!row}
                            onClick={() => setSelected(row)}
                          >
                            Job Summary
                          </Button>
                        );
                      })()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data && !open.length && (
              <p className="mt-3 text-sm text-muted-foreground">
                {needsMatching > 0
                  ? "No tasks to complete yet. Some requests need your decision on Actions."
                  : "No outstanding actions."}
              </p>
            )}
          </section>
        </section>
        <DeadlineCalendar
          items={data ? deadlineItems(data, recruiting.data, now) : []}
          now={now}
          // Real failures only; recruiting data is still loading for a moment.
          unavailable={!!error || !!recruiting.error}
        />
      </div>
      {selected && (
        <AppSheet
          row={selected}
          readOnly
          disabled={false}
          onClose={() => setSelected(null)}
          onEdited={setSelected}
          onMove={() => {}}
          onRemove={() => {}}
        />
      )}
    </div>
  );
}
