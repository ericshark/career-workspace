"use client";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { ModelSettings } from "./ModelSettings";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
const key = "career-ui.hideQuestions";
const subscribe = (fn: () => void) => {
  window.addEventListener("storage", fn);
  window.addEventListener("settings-changed", fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener("settings-changed", fn);
  };
};
export function readHideQuestions() {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}
export function useHideQuestions() {
  return useSyncExternalStore(subscribe, readHideQuestions, () => true);
}
const reviewKey = "career-ui.hideReview";
// On by default; only an explicit saved "false" shows the Review button.
export function readHideReview() {
  try {
    return localStorage.getItem(reviewKey) !== "false";
  } catch {
    return true;
  }
}
export function useHideReview() {
  return useSyncExternalStore(subscribe, readHideReview, () => true);
}
export function Settings() {
  const hidden = useHideQuestions();
  const reviewHidden = useHideReview();
  const { resolvedTheme, setTheme } = useTheme();
  const [modelsOpen, setModelsOpen] = useState(false);
  // Beside the sidebar button on wide screens; below the header button on phones.
  const narrow = useSyncExternalStore(
    (fn) => {
      const query = window.matchMedia("(max-width: 767px)");
      query.addEventListener("change", fn);
      return () => query.removeEventListener("change", fn);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="w-full justify-start">
          <SettingsIcon />
          Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="block max-h-[85vh] w-80 max-w-[calc(100vw-1rem)] space-y-4 overflow-y-auto"
        side={narrow ? "bottom" : "right"}
        align="end"
        collisionPadding={8}
      >
        <h2 className="font-semibold">Settings</h2>
        <label className="flex justify-between gap-4 text-sm">
          Night mode
          <input
            type="checkbox"
            checked={resolvedTheme === "dark"}
            onChange={(e) => setTheme(e.target.checked ? "dark" : "light")}
          />
        </label>
        <label
          className="flex justify-between gap-4 text-sm"
          title="Hide application questions and cover letters together"
        >
          Hide questions
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => {
              try {
                localStorage.setItem(key, String(e.target.checked));
              } catch {}
              window.dispatchEvent(new Event("settings-changed"));
            }}
          />
        </label>
        <label
          className="flex justify-between gap-4 text-sm"
          title="Hide the Review button on the Apply page"
        >
          Hide review
          <input
            type="checkbox"
            checked={reviewHidden}
            onChange={(e) => {
              try {
                localStorage.setItem(reviewKey, String(e.target.checked));
              } catch {}
              window.dispatchEvent(new Event("settings-changed"));
            }}
          />
        </label>
        <div className="border-t pt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-sm font-medium"
            aria-expanded={modelsOpen}
            onClick={() => setModelsOpen((open) => !open)}
          >
            AI models
            <ChevronDownIcon
              className={`size-4 transition-transform ${modelsOpen ? "rotate-180" : ""}`}
            />
          </button>
          {modelsOpen && (
            <div className="pt-3">
              <ModelSettings hideQuestions={hidden} />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
