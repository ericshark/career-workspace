"use client";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { ModelSettings } from "./ModelSettings";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
export function Settings() {
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
              <ModelSettings />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
