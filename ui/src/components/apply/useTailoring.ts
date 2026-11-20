"use client";
import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { baseCategory, tailorPassed } from "../applyHelpers";
import type { ResumeCategory, TailorResult } from "@/lib/types";
interface Context {
  resume: string;
  setResume: (r: string) => void;
  tailoredBases: Record<string, ResumeCategory>;
  setTailoredBases: Dispatch<SetStateAction<Record<string, ResumeCategory>>>;
  setToast: (s: string | null) => void;
}
export function useTailoring({
  resume,
  setResume,
  tailoredBases,
  setTailoredBases,
  setToast,
}: Context) {
  // A tailor job still running on the server (reattached after navigation).
  const [tailorJob, setTailorJob] = useState<{
    jobId: string;
    runId: string;
    slug: string;
  } | null>(null);
  const [tailorOpen, setTailorOpen] = useState(false);
  const [tailored, setTailored] = useState<TailorResult | null>(null);

  function useMaster() {
    // Drop any tailored resume so the row logs the master it was reviewed against.
    setTailored(null);
    setTailorOpen(false);
    setResume(baseCategory(resume, tailoredBases));
    setToast(`Using the ${baseCategory(resume, tailoredBases)} master.`);
  }

  /** TailorPanel result: a PASS adds tailored/<slug> to the Resume dropdown and selects it. */
  const onTailorFinished = useCallback(
    (passed: TailorResult | null) => {
      setTailored(passed);
      if (passed && tailorPassed(passed)) {
        const value = `tailored/${passed.slug}`;
        const base = baseCategory(resume, tailoredBases);
        setTailoredBases((b) => ({ ...b, [value]: base }));
        setResume(value);
        setToast(`Tailored resume ready and selected: ${value}`);
      } else if (tailored) {
        // A new run (or a failed one) invalidates the earlier PASS: drop it from the dropdown and
        // fall back to its master if it was selected.
        const value = `tailored/${tailored.slug}`;
        if (resume === value) setResume(baseCategory(resume, tailoredBases));
        setTailoredBases((b) => {
          const next = { ...b };
          delete next[value];
          return next;
        });
      }
    },
    [resume, tailoredBases, tailored],
  );

  return {
    tailorJob,
    setTailorJob,
    tailorOpen,
    setTailorOpen,
    tailored,
    setTailored,
    useMaster,
    onTailorFinished,
  };
}
