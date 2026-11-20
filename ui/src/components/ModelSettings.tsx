"use client";
import { useEffect, useRef, useState } from "react";
import { AiConnection } from "./AiConnection";
import { SegmentedControl } from "@/components/SegmentedControl";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "@/lib/config";
import {
  MODEL_OPERATIONS,
  operationModels,
  operationEffort,
  operationModel,
  withOperationEffort,
  withOperationModel,
  withProvider,
  type Effort,
  type ModelOperation,
} from "@/lib/modelSettings";
import type { Preferences } from "@/lib/preferences";

/** Fired after a save so open pages (Apply) re-read the stored preferences. */
export const PREFERENCES_CHANGED = "preferences-changed";

/**
 * Every AI choice in one place: one provider, then a model and effort for each
 * operation. Each change re-reads the stored preferences before saving, one at
 * a time, so quick successive changes never overwrite each other.
 */
export function ModelSettings({ hideQuestions }: { hideQuestions: boolean }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState("");
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void fetch("/api/preferences", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<Preferences>;
      })
      .then(setPrefs)
      .catch(() => setError("Could not load model settings."));
  }, []);

  function update(change: (latest: Preferences) => Preferences) {
    // Show the change immediately; the queued save reconciles with the file.
    setPrefs((current) => (current ? change(current) : current));
    queue.current = queue.current.then(async () => {
      try {
        const latest = await fetch("/api/preferences", { cache: "no-store" });
        if (!latest.ok) throw new Error();
        const next = change((await latest.json()) as Preferences);
        const saved = await fetch("/api/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!saved.ok) throw new Error();
        setPrefs(next);
        setError("");
        window.dispatchEvent(new Event(PREFERENCES_CHANGED));
      } catch {
        setError("Could not save model settings.");
      }
    });
  }

  if (!prefs)
    return (
      <p className="text-xs text-muted-foreground">{error || "Loading…"}</p>
    );

  const operations = MODEL_OPERATIONS.filter(
    (entry) => entry.id !== "extras" || !hideQuestions,
  );
  return (
    <div className="flex flex-col gap-3 text-xs font-medium text-muted-foreground">
      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-semibold text-foreground">Provider</div>
        <SegmentedControl
          size="sm"
          stretch
          ariaLabel="Provider"
          value={prefs.provider}
          onChange={(provider: Provider) =>
            update((latest) => withProvider(latest, provider))
          }
          options={PROVIDERS.map((provider) => ({
            value: provider,
            label: PROVIDER_LABELS[provider],
          }))}
        />
        <AiConnection provider={prefs.provider} />
      </div>

      {operations.map((entry) => (
        <OperationSection
          key={entry.id}
          id={entry.id}
          label={entry.label}
          hint={entry.hint}
          prefs={prefs}
          update={update}
        />
      ))}

      <div className="flex flex-col gap-1.5 border-t pt-3">
        <label className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">
            Saved job context
          </span>
          <select
            aria-label="Saved job context"
            className="rounded-md border bg-background px-2 py-1 font-normal text-foreground"
            value={prefs.contextMode}
            onChange={(event) =>
              update((latest) => ({
                ...latest,
                contextMode: event.target.value as "original" | "brief",
              }))
            }
          >
            <option value="original">Full description</option>
            <option value="brief">Compact brief</option>
          </select>
        </label>
        <p className="font-normal">
          What Tailor and Questions read when a job has both.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function OperationSection({
  id,
  label,
  hint,
  prefs,
  update,
}: {
  id: ModelOperation;
  label: string;
  hint: string;
  prefs: Preferences;
  update: (change: (latest: Preferences) => Preferences) => void;
}) {
  const models = operationModels(prefs, id);
  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      <div>
        <div className="text-sm font-semibold text-foreground">{label}</div>
        <div className="font-normal">{hint}</div>
      </div>
      {models.length > 1 ? (
        <SegmentedControl
          size="sm"
          stretch
          ariaLabel={`${label} model`}
          value={operationModel(prefs, id)}
          onChange={(model) =>
            update((latest) => withOperationModel(latest, id, model))
          }
          options={models.map((model) => ({
            value: model.id,
            label: model.label,
          }))}
        />
      ) : (
        // One model is offered, so there is nothing to choose; only the effort changes.
        <div
          aria-label={`${label} model`}
          className="rounded-md border bg-muted/50 px-2 py-1 font-normal text-foreground"
        >
          {models[0].label}
        </div>
      )}
      <label className="flex items-center justify-between gap-2">
        Effort
        <select
          aria-label={`${label} effort`}
          className="rounded-md border bg-background px-2 py-1 font-normal text-foreground"
          value={operationEffort(prefs, id)}
          onChange={(event) =>
            update((latest) =>
              withOperationEffort(latest, id, event.target.value as Effort),
            )
          }
        >
          {(["low", "medium", "high"] as const).map((effort) => (
            <option key={effort}>{effort}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
