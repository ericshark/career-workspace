"use client";
import { useState } from "react";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

export function ReviewSaveNotice({
  runId,
  warning,
}: {
  runId: string;
  warning?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!warning || saved) return null;
  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Could not save review");
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Alert variant="warning">
      <AlertDescription>
        <p>{error ?? warning}</p>
        <Button variant="outline" disabled={busy} onClick={() => void retry()}>
          {busy ? "Saving…" : "Retry saving"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
