"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  OctagonAlertIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { JobEvent, ModelId, TailorResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PROVIDER_LABELS, providerOf } from "@/lib/config";
import {
  tailorValidated,
  bumpSlug,
  formatElapsed,
  initialTailorState,
  isFinished,
  isValidSlugClient,
  readApiError,
  sanitizeSlugInput,
  tailorPassed,
  tailorReducer,
  type TailorState,
} from "./applyHelpers";

interface Props {
  baselineFit?: number;
  baselineMatch?: number | null;
  runId: string;
  suggestedSlug: string;
  model: ModelId;
  /** Called when a tailor run ends: the result if it PASSED (build ok, ATS ok, masters unchanged), else null. */
  onFinished: (passed: TailorResult | null) => void;
  /** "Use master instead": the page drops the tailored resume and selects the master. */
  onSendMaster: () => void;
  /** Start right away with the suggested slug (the "Create tailored resume" button). */
  autoStart?: boolean;
  /** Reattach to a tailor job that is still running (after leaving or refreshing the page). */
  existingJobId?: string;
  existingResult?: TailorResult;
  /** Called once a job starts, so the page can remember it across navigation. */
  onJobStarted?: (jobId: string, slug: string) => void;
}

type Phase = "setup" | "running" | "finished";

const EVENT_TYPES = ["step", "log", "build", "done", "error"] as const;

export default function TailorPanel({
  runId,
  baselineFit,
  baselineMatch,
  suggestedSlug,
  model,
  onFinished,
  onSendMaster,
  autoStart,
  existingJobId,
  existingResult,
  onJobStarted,
}: Props) {
  const [slug, setSlug] = useState(suggestedSlug);
  const [phase, setPhase] = useState<Phase>(
    existingResult ? "finished" : "setup",
  );
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [state, setState] = useState<TailorState>(
    existingResult
      ? {
          ...initialTailorState,
          result: existingResult,
          build: existingResult.build,
          ok: tailorValidated(existingResult),
        }
      : initialTailorState,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [slugExists, setSlugExists] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [starting, setStarting] = useState(false);
  const startPending = useRef(false);
  const jobId = useRef<string | null>(null);
  const source = useRef<EventSource | null>(null);
  const activeSlug = useRef(slug);

  useEffect(() => {
    return () => source.current?.close();
  }, []);

  // Reattach: the job kept running on the server; replay its events from the SSE buffer.
  const reattached = useRef(false);
  useEffect(() => {
    if (!existingJobId || reattached.current) return;
    const t = setTimeout(() => {
      if (reattached.current) return;
      reattached.current = true;
      autoStarted.current = true; // never start a second run on top of it
      jobId.current = existingJobId;
      activeSlug.current = suggestedSlug;
      setState(initialTailorState);
      setStartedAt(Date.now());
      setNow(Date.now());
      setPhase("running");
      openStream(existingJobId);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingJobId]);

  // One automatic start per panel. The guard is set inside the timer, so React's dev double-mount
  // (mount → cleanup clears the timer → mount again) still starts exactly once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || existingJobId || existingResult || autoStarted.current)
      return;
    const t = setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      start(false);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  // Elapsed-time ticker while running.
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const finish = useCallback(
    (s: TailorState) => {
      source.current?.close();
      source.current = null;
      setPhase("finished");
      onFinished(s.result && tailorValidated(s.result) ? s.result : null);
    },
    [onFinished],
  );

  const handleEvent = useCallback((ev: JobEvent) => {
    setState((prev) => tailorReducer(prev, ev));
  }, []);

  // A terminal event (done/error) ends the run and closes the stream so EventSource doesn't auto-reconnect.
  useEffect(() => {
    if (phase === "running" && isFinished(state)) finish(state);
  }, [phase, state, finish]);

  function openStream(id: string) {
    const es = new EventSource(`/api/jobs/${id}/events`);
    source.current = es;
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (e) => {
        // The native connection "error" event shares its name with our named "error" event;
        // ours carries a JSON string payload.
        const data = (e as MessageEvent).data;
        if (typeof data !== "string") return;
        try {
          handleEvent(JSON.parse(data) as JobEvent);
        } catch {
          /* ignore malformed frame */
        }
      });
    }
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && source.current === es) {
        source.current = null;
        setMessage("Lost the connection to the job stream.");
      }
    };
  }

  async function start(overwrite = false, useSlug = slug) {
    if (startPending.current) return;
    onFinished(null); // a new run invalidates any earlier PASS result held by the page
    setMessage(null);
    setSlugExists(false);
    if (!isValidSlugClient(useSlug)) {
      setMessage("Slug must be lowercase letters, digits and hyphens.");
      return;
    }
    activeSlug.current = useSlug;
    startPending.current = true;
    setStarting(true);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, slug: useSlug, overwrite, model }),
      });
      if (!res.ok) {
        const err = await readApiError(res);
        if (
          res.status === 409 &&
          err.details &&
          typeof err.details === "object"
        )
          setSlugExists(true); // slug-exists carries {slug} details; job-running does not
        else setMessage(err.message);
        return;
      }
      const { jobId: id } = (await res.json()) as { jobId: string };
      jobId.current = id;
      onJobStarted?.(id, useSlug);
      setState(initialTailorState);
      const t = Date.now();
      setStartedAt(t);
      setNow(t);
      setPhase("running");
      openStream(id);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not start tailoring. Try again.",
      );
    } finally {
      startPending.current = false;
      setStarting(false);
    }
  }

  async function cancel() {
    try {
      if (jobId.current) {
        const res = await fetch(`/api/jobs/${jobId.current}/cancel`, {
          method: "POST",
        });
        if (!res.ok) setMessage((await readApiError(res)).message);
      }
    } catch {
      setMessage(
        "Could not cancel tailoring. Check your connection and try again.",
      );
    }
  }

  const elapsed = phase === "running" ? Math.max(0, now - startedAt) : 0;
  const result = state.result;
  const build = state.build;
  const failed = phase === "finished" && (state.ok === false || !!state.error);
  const buildFailed =
    !!build && (!build.ok || build.ats === "FAIL" || build.pages !== 1);
  const mastersChanged =
    (result && !result.mastersUnchanged) ||
    state.error?.kind === "master-changed";
  return (
    <Card className="animate-rise">
      <CardHeader>
        <CardTitle asChild className="text-lg font-semibold">
          <h3>Tailor</h3>
        </CardTitle>
        <CardDescription className="min-w-0">
          <span className="block text-xs">
            Targeted changes for this job, preserving your resume&apos;s
            structure.
          </span>
          <span className="block truncate font-mono text-xs">
            source/tailored/
            {phase === "setup" ? slug || "…" : activeSlug.current}/
          </span>
        </CardDescription>
        {phase === "running" && (
          <CardAction>
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {phase === "setup" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {PROVIDER_LABELS[providerOf(model)]} adjusts wording, emphasis and
              supported content as needed, then checks the rendered page and
              reading order. A validated copy is selected automatically; inspect
              the result and switch back to the master whenever you prefer.
            </p>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Folder
              <Input
                className="min-w-0 flex-1 font-mono sm:max-w-80"
                value={slug}
                onChange={(e) => setSlug(sanitizeSlugInput(e.target.value))}
                aria-label="Tailored folder slug"
              />
              <Button onClick={() => start(false)} disabled={!slug || starting}>
                {starting ? "Starting…" : "Start tailoring"}
              </Button>
            </label>
            {slugExists && (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertDescription>
                  <p>
                    <code>source/tailored/{slug}/</code> already exists.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const alt = bumpSlug(slug);
                        setSlug(alt);
                        start(false, alt);
                      }}
                    >
                      Use {bumpSlug(slug)}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => start(true)}
                    >
                      Overwrite
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {phase !== "setup" && (
          <>
            <ul className="flex flex-col gap-2 text-sm">
              {state.steps.map((s, i) => {
                const last = i === state.steps.length - 1;
                const running = phase === "running" && last;
                return (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-2">
                      {running ? (
                        <Spinner className="shrink-0 text-primary" />
                      ) : (
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-background">
                          <CheckIcon className="size-3" strokeWidth={3} />
                        </span>
                      )}
                      {s.text}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatElapsed(Math.max(0, s.at - startedAt))}
                    </span>
                  </li>
                );
              })}
              {state.steps.length === 0 && phase === "running" && (
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="text-primary" />
                  Starting
                </li>
              )}
            </ul>
            {phase === "running" && (
              <div>
                {/* The server bounds candidate submissions and enforces its six-minute limit. */}
                <div className="text-xs text-muted-foreground tabular-nums">
                  Elapsed {formatElapsed(elapsed)}
                </div>
              </div>
            )}
          </>
        )}

        {mastersChanged && (
          <Alert variant="destructive" className="bg-destructive/10">
            <OctagonAlertIcon />
            <AlertTitle>A master resume changed during tailoring.</AlertTitle>
            <AlertDescription>
              Check git diff before doing anything else; do not log this
              application until it is resolved.
            </AlertDescription>
          </Alert>
        )}

        {phase === "finished" && state.error && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-destructive">
              {state.error.kind === "cancelled"
                ? "Cancelled."
                : `Tailoring failed (${state.error.kind}): ${state.error.message}`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPhase("setup");
                  setState(initialTailorState);
                }}
              >
                Retry
              </Button>
              <Button variant="outline" onClick={onSendMaster}>
                Use master instead
              </Button>
            </div>
          </div>
        )}

        {phase === "finished" && result && (
          <div className="flex flex-col gap-4 sm:flex-row">
            {result.pngUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.pngUrl}
                alt="Tailored resume preview"
                className="w-full shrink-0 self-start rounded-lg shadow-lg ring-1 ring-foreground/10 sm:w-72"
              />
            )}
            <div className="flex min-w-0 flex-col gap-2 text-sm">
              <div className="flex flex-wrap gap-1.5">
                {[
                  `ATS ${result.build.ats ?? "unknown"}`,
                  `${result.build.pages ?? "?"} page${result.build.pages === 1 ? "" : "s"}`,
                  `fill ${result.build.fillPct ?? "?"}%`,
                ].map((t) => (
                  <Badge
                    key={t}
                    variant={buildFailed ? "destructive" : "success"}
                  >
                    {t}
                  </Badge>
                ))}
              </div>
              {result.pdfPath && (
                <p className="flex flex-wrap items-center gap-2 break-all">
                  <code className="text-xs">{result.pdfPath}</code>
                  <Button asChild size="sm">
                    <a
                      href={`/api/files?path=${encodeURIComponent(result.pdfPath)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open PDF
                      <ExternalLinkIcon data-icon="inline-end" />
                    </a>
                  </Button>
                </p>
              )}
              {result.mastersUnchanged && (
                <p className="text-success">masters unchanged ✓</p>
              )}
              <p>
                Fit {baselineFit ?? "unavailable"} · Resume Match{" "}
                {baselineMatch ?? "unavailable"} →{" "}
                {result.actualMatch ?? "unavailable"}
                {result.actualMatch !== null && baselineMatch != null
                  ? ` (${result.actualMatch - baselineMatch >= 0 ? "+" : ""}${result.actualMatch - baselineMatch})`
                  : ""}
              </p>
              {result.actualMatch === null && (
                <Button
                  variant="outline"
                  disabled={assessing}
                  onClick={async () => {
                    setAssessing(true);
                    try {
                      const response = await fetch("/api/tailor/match", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ runId: runId }),
                      });
                      if (!response.ok)
                        throw new Error("Could not assess Match");
                      const updated = await response.json();
                      setState((s) => ({ ...s, result: updated }));
                      onFinished(updated);
                    } catch (e) {
                      setMessage(String(e));
                    } finally {
                      setAssessing(false);
                    }
                  }}
                >
                  Retry Resume Match
                </Button>
              )}
              {(result.estimate || result.actualMatch !== null) && (
                <p>
                  Resume Match
                  {result.estimate
                    ? `: ${result.estimate.current} → estimated ${result.estimate.low}–${result.estimate.high}`
                    : ""}
                  {result.actualMatch !== null
                    ? ` · actual ${result.actualMatch}`
                    : ""}
                </p>
              )}
              {result.validationMethod === "controlled" &&
                tailorValidated(result) && (
                  <p>
                    Evidence, report and visual checks passed ·{" "}
                    {result.repairCount ?? 0} repairs
                  </p>
                )}
              <details open>
                <summary className="cursor-pointer">Full content diff</summary>
                <ul className="mt-1 flex flex-col gap-2 rounded-lg bg-muted p-3 font-mono text-xs">
                  {result.contentDiff?.removed.map((text, i) => (
                    <li key={`old-${i}`} className="text-destructive">
                      − {text}
                    </li>
                  ))}
                  {result.contentDiff?.added.map((text, i) => (
                    <li key={`new-${i}`} className="text-success">
                      + {text}
                    </li>
                  ))}
                </ul>
              </details>
              {tailorPassed(result) && (
                <p>
                  Selected for this application. Switch back with the Resume
                  dropdown or Use master.
                </p>
              )}
              {result.changes.length > 0 && (
                <details open>
                  <summary className="cursor-pointer text-muted-foreground">
                    {result.changes.length} change
                    {result.changes.length === 1 ? "" : "s"} ·{" "}
                    {
                      result.changes.filter(
                        (c) => c.afterVerified && c.careerVerified,
                      ).length
                    }{" "}
                    evidence matched
                  </summary>
                  <ul className="mt-1 flex flex-col gap-1">
                    {result.changes.map((c, i) => {
                      const ok = c.afterVerified && c.careerVerified;
                      return (
                        <li key={i} className="flex gap-2 text-xs">
                          <span
                            className={cn(ok ? "text-success" : "text-warning")}
                            title={
                              ok
                                ? "On the tailored resume and backed by career.md"
                                : !c.afterVerified
                                  ? "Not found on the tailored resume"
                                  : "Supporting quote not found in career.md: check it"
                            }
                          >
                            {ok ? "✓" : "⚠"}
                          </span>
                          <span>
                            {c.after}
                            <blockquote className="mt-1 text-muted-foreground">
                              Career quotation: {c.careerQuote}
                            </blockquote>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {result.deniedToolCalls.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Guard blocked {result.deniedToolCalls.length} tool call(s).
                </p>
              )}
              {buildFailed && (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>Build or ATS check failed</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-5">
                      {(build?.failures.length
                        ? build.failures
                        : ["See build output."]
                      ).map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                    <Button variant="outline" size="sm" onClick={onSendMaster}>
                      Use master instead
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {build && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    build output
                  </summary>
                  <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs">
                    {build.raw}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        {phase === "finished" && failed && !state.error && !result && (
          <p className="text-sm text-destructive">
            Tailoring did not complete.
          </p>
        )}

        {message && <p className="text-sm text-destructive">{message}</p>}
      </CardContent>
    </Card>
  );
}
