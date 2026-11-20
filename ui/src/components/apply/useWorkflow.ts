"use client";
import { useMemo, useRef } from "react";
export type WorkflowKind =
  "idle" | "review" | "quick" | "history" | "tailor" | "submission";
export interface Workflow {
  generation: () => number;
  begin: (kind: WorkflowKind, id?: string) => number;
  current: (generation: number) => boolean;
  is: (kind: WorkflowKind) => boolean;
}
/** A new active item invalidates all earlier response generations without changing cancellation. */
export function useWorkflow(): Workflow {
  const state = useRef({
    generation: 0,
    kind: "idle" as WorkflowKind,
    id: undefined as string | undefined,
  });
  return useMemo(
    () => ({
      generation() {
        return state.current.generation;
      },
      begin(kind: WorkflowKind, id?: string) {
        state.current = { generation: state.current.generation + 1, kind, id };
        return state.current.generation;
      },
      current(generation: number) {
        return generation === state.current.generation;
      },
      is(kind: WorkflowKind) {
        return state.current.kind === kind;
      },
    }),
    [],
  );
}
