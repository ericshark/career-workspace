"use client";
import { useHideQuestions } from "@/components/Settings";
import { useEffect, useId, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { readApiError } from "./applyHelpers";
import type {
  ApplicationExtras,
  CoverLetterResult,
  ModelId,
  QuestionsResult,
} from "@/lib/types";

export interface ExtrasTarget {
  kind: "review" | "quick";
  id: string;
}

export interface ExtrasAsk {
  /** One entry per question box; a box holds one whole question, even a multi-part one. */
  questions: string[];
  coverLetter: boolean;
  /** Optional steer for both the answers and the letter: style, emphasis, things to mention. */
  note: string;
}

export const NO_EXTRAS: ExtrasAsk = {
  questions: [""],
  coverLetter: false,
  note: "",
};

/** The same prompt on every YC (Work at a Startup) application; answer-questions.md has its style rules. */
export const YC_INTRO_QUESTION =
  "YC intro message: Start a conversation with the team. Share something about you, what you're looking for, or why the company interests you. Human-written messages are more likely to get a response.";
const askedQuestions = (a: ExtrasAsk) =>
  a.questions.map((q) => q.trim()).filter(Boolean);

function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("shrink-0", done ? "text-success" : "text-primary")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable (non-secure context); ignore */
        }
      }}
    >
      {done ? (
        <CheckIcon data-icon="inline-start" />
      ) : (
        <CopyIcon data-icon="inline-start" />
      )}
      {done ? "Copied" : label}
    </Button>
  );
}

/**
 * An optional note, then one box per application question (paste the whole question, parts and
 * all) plus the cover-letter switch; shared by the Quick add form and the panel. Add question works like Add job.
 */
export function ExtrasFields({
  value,
  onChange,
  disabled,
}: {
  value: ExtrasAsk;
  onChange: (v: ExtrasAsk) => void;
  disabled?: boolean;
}) {
  const hideQuestions = useHideQuestions();
  const boxes = value.questions.length ? value.questions : [""];
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const inputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  useEffect(() => {
    if (focusIndex === null) return;
    inputs.current[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex, boxes.length]);
  const setBoxes = (questions: string[]) => onChange({ ...value, questions });
  const noteId = useId();
  const coverLetterId = useId();
  if (hideQuestions) return null;
  return (
    <div className="flex flex-col gap-2">
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Note for the writer (optional)
        </summary>
        <Field className="gap-1">
          <FieldLabel
            htmlFor={noteId}
            className="text-xs text-muted-foreground"
          >
            Note for the writer (optional)
          </FieldLabel>
          <Textarea
            id={noteId}
            rows={2}
            className="min-h-16 resize-y leading-relaxed"
            placeholder="Style or things to mention, e.g. keep it casual, mention my homelab"
            value={value.note ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
          />
        </Field>
      </details>
      {!hideQuestions && (
        <>
          <div className="pt-1 text-xs font-medium text-muted-foreground">
            Application questions (optional, one per box)
          </div>
          <ol className="flex flex-col gap-2">
            {boxes.map((q, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-6 shrink-0 pt-2 text-xs font-semibold text-muted-foreground">
                  Q{i + 1}
                </span>
                <Textarea
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  rows={2}
                  aria-label={`Question ${i + 1}`}
                  className="min-h-16 min-w-0 flex-1 resize-y leading-relaxed"
                  placeholder={
                    i === 0
                      ? "Paste the whole question, e.g. Why do you want to work here?"
                      : "Paste the next question"
                  }
                  value={q}
                  disabled={disabled}
                  onChange={(e) =>
                    setBoxes(
                      boxes.map((b, j) => (j === i ? e.target.value : b)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mt-1 text-muted-foreground"
                  onClick={() => {
                    const rest = boxes.filter((_, j) => j !== i);
                    setBoxes(rest.length ? rest : [""]);
                  }}
                  disabled={disabled || (boxes.length === 1 && !q.trim())}
                  aria-label={`Remove question ${i + 1}`}
                  title="Remove this question"
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-primary"
              disabled={disabled}
              onClick={() => {
                setBoxes([...boxes, ""]);
                setFocusIndex(boxes.length);
              }}
            >
              <PlusIcon data-icon="inline-start" />
              Add question
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-primary"
              disabled={disabled || boxes.includes(YC_INTRO_QUESTION)}
              title="Add the Y Combinator 'Start a conversation with the team' message"
              onClick={() => {
                const empty = boxes.findIndex((b) => !b.trim());
                setBoxes(
                  empty === -1
                    ? [...boxes, YC_INTRO_QUESTION]
                    : boxes.map((b, j) =>
                        j === empty ? YC_INTRO_QUESTION : b,
                      ),
                );
              }}
            >
              <PlusIcon data-icon="inline-start" />
              YC intro message
            </Button>
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id={coverLetterId}
          checked={value.coverLetter}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...value, coverLetter: checked === true })
          }
        />
        <Label htmlFor={coverLetterId} className="font-normal">
          Cover letter
        </Label>
      </div>
    </div>
  );
}

export const wantsExtras = (a: ExtrasAsk) =>
  askedQuestions(a).length > 0 || a.coverLetter;

function QuestionsView({ set }: { set: QuestionsResult }) {
  return (
    <div className="flex flex-col gap-4">
      {set.company.whatTheyDo && (
        <p className="text-sm">
          <span className="font-semibold">What they do: </span>
          {set.company.whatTheyDo}
        </p>
      )}
      {set.answers.map((a, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="text-sm font-semibold">{a.question}</div>
          <ol className="flex flex-col gap-2">
            {a.options.map((o, j) => (
              <li
                key={j}
                className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm"
              >
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{o}</span>
                <CopyButton text={o} />
              </li>
            ))}
          </ol>
          {a.needsUser && (
            <p className="text-xs text-warning">Needs you: {a.needsUser}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function SavedNote({ note }: { note: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold">Note: </span>
      {note}
    </p>
  );
}

function LetterView({
  letter,
  resume,
  note,
}: {
  letter: CoverLetterResult;
  resume: string;
  note?: string;
}) {
  const words = letter.letter.trim().split(/\s+/).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Cover letter</h3>
        <span className="text-xs text-muted-foreground">
          {words} words · from the {resume} resume
        </span>
        <span className="ml-auto">
          <CopyButton text={letter.letter.trim()} label="Copy letter" />
        </span>
      </div>
      {note && <SavedNote note={note} />}
      <div className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm leading-relaxed">
        {letter.letter.trim()}
      </div>
      {letter.namedFacts.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Check these are right: {letter.namedFacts.join(" · ")}
        </p>
      )}
    </div>
  );
}

/**
 * Questions and cover letter for one saved review or quick add. Loads what was saved before,
 * generates more on request (one call each), and shows paste-ready results.
 * `autoStart` runs once on mount (Quick add with Extras filled in).
 */
export default function ExtrasPanel({
  target,
  resume,
  model,
  autoStart,
}: {
  target: ExtrasTarget;
  /** Resume being sent (reviews only); the letter is written from it. */
  resume?: string;
  model: ModelId;
  autoStart?: ExtrasAsk;
}) {
  const hideQuestions = useHideQuestions();
  const [ask, setAsk] = useState<ExtrasAsk>(autoStart ?? NO_EXTRAS);
  const [extras, setExtras] = useState<ApplicationExtras | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${encodeURIComponent(target.id)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((p) => {
        if (!live || !p) return;
        const saved = (p.kind === "quick" ? p.record?.extras : p.extras) as
          ApplicationExtras | null | undefined;
        // A generate that finished first already holds the newest copy.
        if (saved) setExtras((current) => current ?? saved);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [target.id]);

  async function generate(request: ExtrasAsk) {
    if (hideQuestions || busy || !wantsExtras(request)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          ...(!hideQuestions && askedQuestions(request).length
            ? { questions: askedQuestions(request) }
            : {}),
          ...(request.coverLetter ? { coverLetter: true } : {}),
          ...(request.note?.trim() ? { note: request.note.trim() } : {}),
          ...(target.kind === "review" && resume ? { resume } : {}),
          model,
        }),
      });
      if (!res.ok) {
        setError((await readApiError(res)).message);
        return;
      }
      const body = (await res.json()) as { extras: ApplicationExtras };
      setExtras(body.extras);
      setAsk(NO_EXTRAS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  // Strict mode mounts twice in development; the ref keeps this to one call.
  useEffect(() => {
    if (
      !hideQuestions &&
      autoStart &&
      wantsExtras(autoStart) &&
      !started.current
    ) {
      started.current = true;
      void generate(autoStart);
    }
  }, []);

  if (hideQuestions) return null;
  const sets = [...(extras?.questions ?? [])].reverse();
  const hasResults = sets.length > 0 || !!extras?.coverLetter;
  return (
    <Card className="animate-rise" role="region" aria-label="Extras">
      <CardHeader>
        <CardTitle asChild className="text-lg font-semibold">
          <h2>Questions &amp; cover letter</h2>
        </CardTitle>
        <CardDescription>
          Paste each question in its own box. Answers are saved with this job.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Results first: right after a Quick add they are what the workspace owner came for. */}
        {sets.map((set, i) => (
          <details key={set.at} open={i === 0}>
            <summary className="cursor-pointer text-sm font-semibold">
              Answers · {new Date(set.at).toLocaleString()} ·{" "}
              {set.result.answers.length} question
              {set.result.answers.length === 1 ? "" : "s"}
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              {set.generation && (
                <p className="text-xs text-muted-foreground">
                  {set.model} · {set.generation.effort} ·{" "}
                  {set.generation.contextMode === "original"
                    ? "Full description"
                    : "Compact brief"}{" "}
                  · {(set.generation.durationMs / 1000).toFixed(1)}s
                </p>
              )}
              {set.note && <SavedNote note={set.note} />}
              <QuestionsView set={set.result} />
            </div>
          </details>
        ))}
        {extras?.coverLetter?.generation && (
          <p className="text-xs text-muted-foreground">
            {extras.coverLetter.model} · {extras.coverLetter.generation.effort}{" "}
            ·{" "}
            {extras.coverLetter.generation.contextMode === "original"
              ? "Full description"
              : "Compact brief"}{" "}
            · {(extras.coverLetter.generation.durationMs / 1000).toFixed(1)}s
          </p>
        )}
        {extras?.coverLetter && (
          <LetterView
            letter={extras.coverLetter.result}
            resume={extras.coverLetter.resume}
            note={extras.coverLetter.note}
          />
        )}
        {hasResults && <Separator />}
        <ExtrasFields value={ask} onChange={setAsk} disabled={busy} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy || !wantsExtras(ask)}
            onClick={() => void generate(ask)}
          >
            {busy ? (
              <>
                <Spinner data-icon="inline-start" aria-hidden />
                Writing…
              </>
            ) : hasResults ? (
              "Submit more"
            ) : (
              "Submit"
            )}
          </Button>
          {busy && (
            <span className="text-xs text-muted-foreground">
              Usually under a minute.
            </span>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>
              {error}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setError(null)}
              >
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
