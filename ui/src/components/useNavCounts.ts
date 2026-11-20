"use client";
import { useFetchJson } from "./useFetchJson";
import { useRecruiting } from "./Recruiting";
import { activeRecruitingUpdates } from "@/lib/checkSummary";
import { openViewTotal } from "@/lib/recruitingPresentation";
import type { ActionsPayload } from "@/lib/actionTypes";

/** Sidebar badge counts keyed by nav href; 0 (hidden) until data loads. */
export function useNavCounts(): Record<string, number> {
  const recruiting = useRecruiting();
  const actions = useFetchJson<ActionsPayload>("/api/actions", {
    events: true,
  });
  return {
    "/": recruiting.data
      ? activeRecruitingUpdates(
          recruiting.data.events,
          new Set(actions.data?.actions.map((a) => a.id)),
        ).length
      : 0,
    "/actions": actions.data
      ? // Ready tasks only; decisions have their own tab and count.
        openViewTotal(actions.data, recruiting.data)
      : 0,
  };
}
