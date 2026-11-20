"use client";
import { useEffect, useRef, useState } from "react";

import { OverviewCard } from "@/components/today/OverviewCard";
import { Confetti } from "@/components/today/Confetti";
import { ActionsSummary } from "@/components/today/ActionsSummary";
import { AlertCircleIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetchJson } from "@/components/useFetchJson";
import { longDate } from "@/lib/calendar";
import type { ApplicationsPayload, Progress } from "@/lib/types";

// Dashboard application progress and recorded recruiting activity.
// Data from GET /api/progress (application counts and calendar), refetched on window focus.
export default function TodayPage() {
  const { data, error, reload } = useFetchJson<Progress>("/api/progress", {
    events: true,
  });
  // Rows for the calendar's day list + the read-only state (Progress doesn't carry either).
  const apps = useFetchJson<ApplicationsPayload>("/api/applications", {
    events: true,
  });
  const [fire, setFire] = useState(0);
  const prev = useRef<number | null>(null);

  // Celebrate reaching today's application goal, never on the initial load.
  const appliedToday = data ? data.today.tech + data.today.bridge : undefined;
  const target = data?.today.target;
  useEffect(() => {
    if (appliedToday === undefined || target === undefined) return;
    const previous = prev.current;
    prev.current = appliedToday;
    if (previous !== null && previous < target && appliedToday >= target) {
      const timer = setTimeout(() => setFire(Date.now()), 0);
      return () => clearTimeout(timer);
    }
  }, [appliedToday, target]);

  if (error && !data)
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>Couldn&apos;t load progress</AlertTitle>
        <AlertDescription>
          {error}
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!data) return <TodaySkeleton />;

  const readOnly = apps.data?.readOnly;
  return (
    <div className="flex flex-col gap-5">
      <Confetti fire={fire} />
      {data.maintenanceWarning && (
        <p role="alert" className="text-sm text-warning">
          {data.maintenanceWarning}
        </p>
      )}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {longDate(data.today.date)}
          </p>
          <h1>Dashboard</h1>
        </div>
      </header>
      {readOnly && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            applications.md is read-only: {readOnly.reason}. Fix the file by
            hand; counts below still work.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            Couldn&apos;t refresh ({error}); showing the last data.
          </AlertDescription>
        </Alert>
      )}
      <OverviewCard progress={data} rows={apps.data?.rows ?? []} />
      <ActionsSummary />
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-20 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}
