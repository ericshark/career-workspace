"use client";
import { useFetchJson } from "./useFetchJson";

export function HealthDot() {
  const { data, error } = useFetchJson<{ connected: boolean }>("/api/health");
  const label = error
    ? "Setup needs attention"
    : !data
      ? "Checking setup…"
      : data.connected
        ? "AI configured"
        : "AI optional";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      title="Local configuration only. Manage AI connections in Apply → Models."
    >
      <span
        className={`size-2.5 rounded-full ${data?.connected ? "bg-success" : "bg-muted-foreground"}`}
      />
      <span className="hidden md:inline">{label}</span>
    </span>
  );
}
