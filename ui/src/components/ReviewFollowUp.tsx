"use client";
import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { readApiError } from "./applyHelpers";
import { Markdown } from "./Markdown";
import type { ModelId } from "@/lib/types";

interface Turn {
  q: string;
  a: string;
  generation?: {
    model: string;
    effort: string;
    contextMode: string;
    durationMs: number;
  };
}

/** Turns sent back with each question; matches the route's MAX_FOLLOWUP_HISTORY. */
const HISTORY_SENT = 6;

/**
 * Ask follow-up questions about the review on screen. The thread lives only in this component:
 * nothing is saved, and it clears when the review changes or the page is left.
 */
export default function ReviewFollowUp({
  runId,
  model,
}: {
  runId: string;
  model: ModelId;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q || pending) return;
    setPending(q);
    setError(null);
    try {
      const res = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          question: q,
          history: turns.slice(-HISTORY_SENT).map(({ q, a }) => ({ q, a })),
          model,
        }),
      });
      if (!res.ok) {
        setError((await readApiError(res)).message);
        return;
      }
      const { answer, generation } = (await res.json()) as {
        answer: string;
        generation?: Turn["generation"];
      };
      setTurns((t) => [...t, { q, a: answer, generation }]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card aria-label="Ask about this review" role="region">
      <CardHeader>
        <CardTitle asChild className="text-lg font-semibold">
          <h2>Ask about this review</h2>
        </CardTitle>
        <CardDescription>
          Follow-up questions about the scores, gaps or resume. Not saved —
          clears when you leave.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-2">
            <p className="text-sm font-semibold whitespace-pre-wrap">{t.q}</p>
            <div className="rounded-lg bg-muted p-3 text-sm">
              <Markdown>{t.a}</Markdown>
              {t.generation && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.generation.model} · {t.generation.effort} ·{" "}
                  {t.generation.contextMode === "original"
                    ? "Full description"
                    : "Compact brief"}{" "}
                  · {(t.generation.durationMs / 1000).toFixed(1)}s
                </p>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold whitespace-pre-wrap">
              {pending}
            </p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              <span className="shimmer">Thinking…</span>
            </p>
          </div>
        )}
        <div className="flex flex-col items-start gap-2">
          <Textarea
            rows={2}
            aria-label="Follow-up question"
            className="min-h-16 resize-y leading-relaxed"
            placeholder="e.g. How big a gap is the Kubernetes requirement?"
            value={question}
            disabled={!!pending}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void ask();
              }
            }}
          />
          <Button
            disabled={!!pending || !question.trim()}
            onClick={() => void ask()}
          >
            Ask
          </Button>
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
