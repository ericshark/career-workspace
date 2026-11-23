"use client";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "./ui/button";

const subscribe = () => () => {};

export function NightModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The saved theme is unknown during server rendering.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-label="Night mode"
      aria-pressed={dark}
      title={dark ? "Turn night mode off" : "Turn night mode on"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
