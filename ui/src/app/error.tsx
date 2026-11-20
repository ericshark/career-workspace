"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Shown inside the app shell when a page throws while rendering, so the sidebar and header keep
// working and one broken component no longer blanks the whole app.
export default function RouteError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-3 py-16 text-center">
      <h1 className="text-xl font-semibold">This page hit a problem</h1>
      <p className="text-sm text-muted-foreground">
        Your data is not affected. {message}
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
