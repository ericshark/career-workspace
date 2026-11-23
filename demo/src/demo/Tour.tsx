"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { InfoIcon, TerminalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QUICK_POSTS, REVIEW_POST } from "./examples";

const INTRO: Record<string, string> = {
  "/": "This sample workspace is fictional and resets when you reload. In the local edition, counts come from your own tracker and updates come from actions you add or optional read-only Gmail checks.",
  "/tracker":
    "Search, filter, change a status, or open a job. The local edition saves this table as a file on your computer.",
  "/actions":
    "Follow-ups and deadlines linked to each application. Locally, you add them or an optional Gmail check finds them.",
  "/workshop":
    "Project ideas, tasks and notes. Locally, the Dev tab also runs Git and your dev server inside a linked folder.",
  "/docs":
    "Notes you write or import. Locally, they are files that stay on your computer and out of AI requests.",
  "/apply":
    "Load an example post to step through Quick add or Review. Locally, the AI account you connect reads the posts you paste.",
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

async function openTab(name: string) {
  const tab = [
    ...document.querySelectorAll<HTMLElement>("main [role=radio]"),
  ].find((el) => el.textContent?.trim() === name);
  tab?.click();
  await tick();
}

async function loadQuick() {
  await openTab("Quick add");
  const key = "career-ui.quick.drafts";
  const value = JSON.stringify(
    QUICK_POSTS.map((post) => ({
      id: Math.random().toString(36).slice(2, 10),
      url: post.link,
      description: post.text,
    })),
  );
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be blocked */
  }
  // The composer follows edits made in another tab; this is the same signal.
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
}

async function loadReview() {
  await openTab("Review");
  const box = document.querySelector<HTMLTextAreaElement>("#jobpost");
  if (!box) return;
  // Paste, as a visitor would: the form reads the link and the description from one paste.
  const data = new DataTransfer();
  data.setData("text/plain", `${REVIEW_POST.link}\n${REVIEW_POST.text}`);
  box.focus();
  box.select();
  box.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    }),
  );
}

const STEPS = {
  quick:
    "Example loaded. Choose Quick add below to log both jobs, then open the result or find them in Tracker.",
  review:
    "Example loaded. Choose Review below, then read the Fit and Match scores and decide whether to apply.",
};

export function Tour({ children }: { children: React.ReactNode }) {
  const path = (usePathname() ?? "/").replace(/(.)\/$/, "$1");
  const [header, setHeader] = useState<Element | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [step, setStep] = useState<keyof typeof STEPS | null>(null);
  useEffect(() => setHeader(document.querySelector("header.sticky")), []);
  useEffect(() => setStep(null), [path]);
  const intro = INTRO[path];
  return (
    <>
      {header &&
        createPortal(
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-full border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground sm:inline">
              Demo · fictional data
            </span>
            <Button asChild size="sm">
              <Link href="/run-locally">
                <TerminalIcon className="max-sm:hidden" />
                Run locally
              </Link>
            </Button>
          </div>,
          header,
        )}
      {intro && !hidden.has(path) && (
        <aside
          aria-label="About this section"
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2 text-sm"
        >
          <InfoIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <p
            className="min-w-0 flex-1 basis-56 text-muted-foreground"
            aria-live="polite"
          >
            <span className="font-medium text-foreground sm:hidden">
              Demo, fictional data.{" "}
            </span>
            {step ? STEPS[step] : intro}{" "}
            {path === "/apply" && (
              <strong className="font-medium text-foreground">
                Results are prepared examples. No AI runs.
              </strong>
            )}
          </p>
          {path === "/apply" && (
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadQuick().then(() => setStep("quick"))}
              >
                Load Quick add example
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadReview().then(() => setStep("review"))}
              >
                Load Review example
              </Button>
            </span>
          )}
          {/* Apply keeps its label and example buttons. */}
          {path !== "/apply" && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Dismiss explanation"
              onClick={() => setHidden(new Set([...hidden, path]))}
            >
              <XIcon />
            </Button>
          )}
        </aside>
      )}
      {children}
    </>
  );
}
